// services/tgl-ops/src/lib/aeo-lead.ts
// /aeo audit request: validation, phone normalisation and the GoHighLevel write (contact upsert, note,
// opportunity in the "AEO" pipeline). Pure functions plus an injectable fetch so it is unit-testable
// without network access.
//
// Two entry points share this module:
//   - the /aeo landing form: name, institute, website, WhatsApp, email and consent (all required);
//   - the Home hero form (source = "home_hero", task 147): two fields only, business (website or name) and
//     WhatsApp number, as site/pages/home.md section 1 specifies. No other source gets the lighter rules.
//
// GHL pipelines cannot be created through the API, so the pipeline and its stages are created once in the
// GHL UI (see products/aeo/ghl-aeo-pipeline.md) and referenced here by id from the environment:
//   GHL_API_KEY            Private Integration token (scopes: contacts.write, opportunities.write)
//   GHL_LOCATION_ID        Sub-account (location) id
//   GHL_AEO_PIPELINE_ID    id of the pipeline named "AEO"
//   GHL_AEO_STAGE_NEW_ID   id of the first stage, "New request"

export const HOME_HERO_SOURCE = "home_hero";

export interface AeoLeadInput {
  name: string;
  institute: string;
  website: string;
  phone: string;
  email: string;
  question: string;
  consent: boolean;
  utm: Record<string, string>;
  pagePath: string;
}

export interface AeoLeadClean extends AeoLeadInput {
  /** E.164, e.g. +919876543210 */
  phoneE164: string;
  firstName: string;
  lastName: string;
  /** Host only, lowercase, no scheme or path. Empty when the visitor gave a business name, not a website. */
  domain: string;
  /** Which form the lead came from. Absent for the /aeo landing form. */
  source?: string;
}

export type ValidationResult =
  | { ok: true; lead: AeoLeadClean }
  | { ok: false; errors: Record<string, string> };

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "src"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]+/g, " ").trim().slice(0, max) : "";
}

/** Indian mobile numbers (10 digits starting 6-9, optional 91 or 0 prefix) or any +E.164 number. */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
  }
  let national = digits;
  if (national.length === 12 && national.startsWith("91")) national = national.slice(2);
  else if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}

/** Accepts "example.com", "https://www.example.com/path"; returns the host or null. */
export function normaliseDomain(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  const withScheme = /^https?:\/\//.test(t) ? t : `https://${t}`;
  try {
    const host = new URL(withScheme).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

function cleanUtm(b: Record<string, unknown>): Record<string, string> {
  const utm: Record<string, string> = {};
  const rawUtm = (b.utm && typeof b.utm === "object" ? b.utm : {}) as Record<string, unknown>;
  for (const k of UTM_KEYS) {
    const v = clip(rawUtm[k], 150);
    if (v) utm[k] = v;
  }
  return utm;
}

/**
 * Home hero (source = home_hero): "Your website or business name" and a WhatsApp number. Nothing else is
 * required. The business value is stored as the institute/company name; if it parses as a website, the host
 * is also stored as the domain. Consent is not collected on this form, so it is recorded as false and the
 * GHL note says so rather than claiming a tick that never happened.
 */
function validateHomeHeroLead(b: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  const business = clip(b.business, 200) || clip(b.website, 200);
  const phone = clip(b.phone, 30);

  if (business.length < 2) errors.business = "Tell us your website or business name.";
  const phoneE164 = normalisePhone(phone);
  if (!phoneE164) errors.phone = "Enter a WhatsApp number we can reach, 10 digits or +country code.";
  if (Object.keys(errors).length > 0 || !phoneE164) return { ok: false, errors };

  // A bare word such as "Sharma" is a name, not a domain: normaliseDomain demands a dot.
  const looksLikeSite = /^https?:\/\//i.test(business) || (/^\S+\.\S+$/.test(business) && !/\s/.test(business));
  const domain = looksLikeSite ? normaliseDomain(business) || "" : "";
  const label = (domain || business).slice(0, 120);
  const parts = label.split(/\s+/);

  return {
    ok: true,
    lead: {
      name: label,
      institute: label,
      website: domain ? business : "",
      phone,
      email: "",
      question: "",
      consent: false,
      utm: cleanUtm(b),
      pagePath: clip(b.pagePath, 120) || "/",
      phoneE164,
      firstName: parts[0],
      lastName: parts.slice(1).join(" "),
      domain,
      source: HOME_HERO_SOURCE,
    },
  };
}

export function validateLead(body: unknown): ValidationResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (clip(b.source, 40) === HOME_HERO_SOURCE) return validateHomeHeroLead(b);
  const errors: Record<string, string> = {};

  const name = clip(b.name, 80);
  const institute = clip(b.institute, 120);
  const website = clip(b.website, 200);
  const phone = clip(b.phone, 30);
  const email = clip(b.email, 120).toLowerCase();
  const question = clip(b.question, 300);
  const consent = b.consent === true || b.consent === "true" || b.consent === "on" || b.consent === "1";

  if (name.length < 2) errors.name = "Tell us your name.";
  if (institute.length < 2) errors.institute = "Tell us the institute name.";
  const domain = normaliseDomain(website);
  if (!domain) errors.website = "Enter your website, for example yourinstitute.com.";
  const phoneE164 = normalisePhone(phone);
  if (!phoneE164) errors.phone = "Enter a WhatsApp number we can reach, 10 digits.";
  if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";
  if (!consent) errors.consent = "We need your OK to message you on WhatsApp and email.";

  if (Object.keys(errors).length > 0 || !domain || !phoneE164) return { ok: false, errors };

  const parts = name.split(/\s+/);
  return {
    ok: true,
    lead: {
      name,
      institute,
      website,
      phone,
      email,
      question,
      consent,
      utm: cleanUtm(b),
      pagePath: clip(b.pagePath, 120) || "/aeo",
      phoneE164,
      firstName: parts[0],
      lastName: parts.slice(1).join(" "),
      domain,
    },
  };
}

/** Human-readable source label, e.g. "meta / aeo-audit". Falls back to "direct" with no UTM. */
export function sourceLabel(lead: Pick<AeoLeadClean, "utm">): string {
  const s = lead.utm.utm_source || lead.utm.src;
  const c = lead.utm.utm_campaign;
  if (s && c) return `${s} / ${c}`;
  return s || c || "direct";
}

export function buildNote(lead: AeoLeadClean): string {
  const isHero = lead.source === HOME_HERO_SOURCE;
  const lines = isHero
    ? [
        "AEO audit request from thegrowthlab.co.in" + lead.pagePath + " (Home hero form, two fields)",
        `Business: ${lead.institute}`,
        `Website: ${lead.domain || "(a business name was given, not a website)"}`,
        `Contact: ${lead.phoneE164} (WhatsApp)`,
        "Consent checkbox: not on this form. The form states the one-page audit is sent to WhatsApp.",
        `Source: ${sourceLabel(lead)}`,
      ]
    : [
        "AEO audit request from thegrowthlab.co.in" + lead.pagePath,
        `Institute: ${lead.institute}`,
        `Website: ${lead.domain}`,
        `Contact: ${lead.name}, ${lead.phoneE164}, ${lead.email}`,
        `Question to include in the audit: ${lead.question || "(none given)"}`,
        `Consent to WhatsApp and email: yes`,
        `Source: ${sourceLabel(lead)}`,
      ];
  for (const [k, v] of Object.entries(lead.utm)) lines.push(`${k}: ${v}`);
  return lines.join("\n");
}

export interface GhlConfig {
  apiKey: string;
  locationId: string;
  pipelineId: string;
  stageNewId: string;
  baseUrl?: string;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;

export function ghlConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GhlConfig | null {
  const cfg = {
    apiKey: (env.GHL_API_KEY || "").trim(),
    locationId: (env.GHL_LOCATION_ID || "").trim(),
    pipelineId: (env.GHL_AEO_PIPELINE_ID || "").trim(),
    stageNewId: (env.GHL_AEO_STAGE_NEW_ID || "").trim(),
  };
  return Object.values(cfg).every(Boolean) ? cfg : null;
}

export interface GhlWriteResult {
  contactId: string;
  opportunityId: string;
}

async function ghlPost(cfg: GhlConfig, fetchFn: FetchLike, path: string, payload: unknown): Promise<any> {
  const res = await fetchFn(`${cfg.baseUrl || "https://services.leadconnectorhq.com"}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GHL ${path} failed with ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Upsert the contact (GHL dedupes on phone/email), attach the request as a note, and open an opportunity
 * at the first stage of the AEO pipeline. The stage entry is what triggers the WhatsApp workflows.
 * Home hero leads carry no email and may carry no website; those keys are left out of the payload.
 */
export async function writeLeadToGhl(
  lead: AeoLeadClean,
  cfg: GhlConfig,
  fetchFn: FetchLike,
): Promise<GhlWriteResult> {
  const isHero = lead.source === HOME_HERO_SOURCE;
  const sourceName = isHero ? `home-hero / ${sourceLabel(lead)}` : `aeo-landing / ${sourceLabel(lead)}`;
  const upsert = await ghlPost(cfg, fetchFn, "/contacts/upsert", {
    locationId: cfg.locationId,
    firstName: lead.firstName,
    lastName: lead.lastName,
    name: lead.name,
    ...(lead.email ? { email: lead.email } : {}),
    phone: lead.phoneE164,
    companyName: lead.institute,
    ...(lead.domain ? { website: lead.domain } : {}),
    source: sourceName,
    tags: isHero ? ["aeo-audit-request", "source:home-hero"] : ["aeo-audit-request", "source:aeo-page"],
  });
  const contactId: string | undefined = upsert?.contact?.id;
  if (!contactId) throw new Error("GHL contact upsert returned no contact id");

  await ghlPost(cfg, fetchFn, `/contacts/${encodeURIComponent(contactId)}/notes`, { body: buildNote(lead) });

  const opp = await ghlPost(cfg, fetchFn, "/opportunities/", {
    pipelineId: cfg.pipelineId,
    locationId: cfg.locationId,
    pipelineStageId: cfg.stageNewId,
    contactId,
    name: `AEO audit - ${lead.institute}`,
    status: "open",
    source: sourceName,
  });
  const opportunityId: string | undefined = opp?.opportunity?.id ?? opp?.id;
  if (!opportunityId) throw new Error("GHL opportunity create returned no opportunity id");

  return { contactId, opportunityId };
}
