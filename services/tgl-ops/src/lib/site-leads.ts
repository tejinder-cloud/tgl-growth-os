// services/tgl-ops/src/lib/site-leads.ts
// The two website lead forms (11 Nov 2026 launch package): POST /aeo/lead and POST /automation/lead.
// Validation, storage in the company database (site_leads), the GoHighLevel write, and the Slack card.
// Order of operations, decided 11 Nov: save first; "ok": true only after the row exists; GHL second and
// never fatal; a #revenue card either way. Pure functions plus injectable store, fetch and notifiers so the
// whole path is unit-testable without network access.
//
// Personal data stored (DPDP minimum): name, business, work email, work phone, and what the visitor typed.
import { normaliseDomain, normalisePhone, type FetchLike, type GhlConfig } from "./aeo-lead.js";

export type SiteLeadKind = "aeo" | "automation";

export const INDUSTRIES = ["healthcare", "education", "hospitality", "realestate", "ecommerce", "saas", "other"] as const;
export const JOBS = ["enquiries", "followup", "qualify", "booking", "reports", "other"] as const;
/** Old /aeo?for= slugs still accepted in the body and mapped to the new industry values. */
export const LEGACY_FOR: Record<string, (typeof INDUSTRIES)[number]> = {
  clinic: "healthcare",
  hospital: "healthcare",
  coaching: "education",
  institute: "education",
  hotel: "hospitality",
  d2c: "ecommerce",
};
export const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "src"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface SiteLead {
  kind: SiteLeadKind;
  business_name: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  /** E.164 or null when the visitor left it blank. */
  phone: string | null;
  /** aeo only */
  website: string | null;
  domain: string | null;
  industry: (typeof INDUSTRIES)[number] | null;
  city: string | null;
  for: string | null;
  /** automation only */
  job: (typeof JOBS)[number] | null;
  message: string | null;
  consent: true;
  source: string;
  page: string;
  campaign: Record<string, string>;
}

export type SiteLeadValidation = { ok: true; lead: SiteLead } | { ok: false; errors: Record<string, string> };

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]+/g, " ").trim().slice(0, max) : "";
}
function truthy(v: unknown): boolean {
  return v === true || v === "true" || v === "on" || v === "1" || v === 1;
}

export function validateSiteLead(kind: SiteLeadKind, body: unknown): SiteLeadValidation {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const name = clip(b.name, 80);
  const business_name = clip(b.business_name, 120) || clip(b.institute, 120); // institute: Day 11 alias, one release
  const email = clip(b.email, 120).toLowerCase();
  const phoneRaw = clip(b.phone, 30);
  const consent = truthy(b.consent);

  if (name.length < 2) errors.name = "Tell us your name.";
  if (business_name.length < 2) errors.business_name = "Tell us the business name.";
  if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";
  let phone: string | null = null;
  if (phoneRaw) {
    phone = normalisePhone(phoneRaw);
    if (!phone) errors.phone = "Enter a WhatsApp number we can reach, 10 digits, or leave it blank.";
  }
  if (!consent) errors.consent = "We need your OK to email you.";

  let website: string | null = null;
  let domain: string | null = null;
  let industry: SiteLead["industry"] = null;
  let city: string | null = null;
  let forSlug: string | null = null;
  let job: SiteLead["job"] = null;
  let message: string | null = null;

  if (kind === "aeo") {
    website = clip(b.website, 200) || null;
    domain = website ? normaliseDomain(website) : null;
    if (!domain) errors.website = "Enter your website, for example yourbusiness.com.";
    const rawInd = clip(b.industry, 40).toLowerCase();
    const mapped = (INDUSTRIES as readonly string[]).includes(rawInd) ? rawInd : LEGACY_FOR[rawInd];
    if (!mapped) errors.industry = "Choose your industry.";
    else industry = mapped as SiteLead["industry"];
    city = clip(b.city, 80) || null;
    forSlug = clip(b.for, 40).toLowerCase() || null;
  } else {
    const rawJob = clip(b.job, 40).toLowerCase();
    if (!(JOBS as readonly string[]).includes(rawJob)) errors.job = "Tell us what you want to automate.";
    else job = rawJob as SiteLead["job"];
    message = clip(b.message, 1000) || null;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const campaign: Record<string, string> = {};
  const rawUtm = (b.utm && typeof b.utm === "object" ? b.utm : {}) as Record<string, unknown>;
  for (const k of CAMPAIGN_KEYS) {
    const v = clip(b[k], 150) || clip(rawUtm[k], 150);
    if (v) campaign[k] = v;
  }
  const parts = name.split(/\s+/);
  return {
    ok: true,
    lead: {
      kind,
      business_name,
      name,
      first_name: parts[0],
      last_name: parts.slice(1).join(" "),
      email,
      phone,
      website,
      domain,
      industry,
      city,
      for: forSlug,
      job,
      message,
      consent: true,
      source: clip(b.source, 60) || (kind === "aeo" ? "aeo_page" : "ai_automation_page"),
      page: clip(b.page, 120) || clip(b.pagePath, 120) || (kind === "aeo" ? "/aeo" : "/ai-automation"),
      campaign,
    },
  };
}

/** Human-readable source label, e.g. "meta / aeo-audit". Falls back to the page source with no campaign. */
export function campaignLabel(lead: Pick<SiteLead, "campaign" | "source">): string {
  const s = lead.campaign.utm_source || lead.campaign.src;
  const c = lead.campaign.utm_campaign;
  if (s && c) return `${s} / ${c}`;
  return s || c || lead.source;
}

export function buildSiteLeadNote(lead: SiteLead): string {
  const lines =
    lead.kind === "aeo"
      ? [
          `AI visibility audit request from thegrowthlab.co.in${lead.page}`,
          `Business: ${lead.business_name} (${lead.domain})`,
          `Industry: ${lead.industry}${lead.city ? `; market: ${lead.city}` : ""}`,
        ]
      : [
          `AI automation enquiry from thegrowthlab.co.in${lead.page}`,
          `Business: ${lead.business_name}`,
          `Wants to automate: ${lead.job}`,
          `Message: ${lead.message || "(none)"}`,
        ];
  lines.push(`Contact: ${lead.name}, ${lead.email}${lead.phone ? `, ${lead.phone}` : ""}`);
  lines.push(`Consent to email${lead.phone ? " and WhatsApp" : ""}: yes`);
  lines.push(`Source: ${campaignLabel(lead)}`);
  for (const [k, v] of Object.entries(lead.campaign)) lines.push(`${k}: ${v}`);
  return lines.join("\n");
}

// ---------- storage ----------

export interface SiteLeadStore {
  /** Inserts the lead; resolves to the new row id. Throws on failure. */
  insert(lead: SiteLead, meta: { ipHash: string | null; userAgent: string | null }): Promise<string>;
  /** Records the GHL outcome on the row; never throws. */
  markGhl(id: string, outcome: { contactId: string | null; opportunityId: string | null; error: string | null }): Promise<void>;
}

export function supabaseSiteLeadStore(sb: any): SiteLeadStore {
  return {
    async insert(lead, meta) {
      const row = {
        kind: lead.kind,
        business_name: lead.business_name,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        website: lead.domain,
        industry: lead.industry,
        city: lead.city,
        for_slug: lead.for,
        job: lead.job,
        message: lead.message,
        consent: true,
        source: lead.source,
        page: lead.page,
        campaign: lead.campaign,
        ip_hash: meta.ipHash,
        user_agent: meta.userAgent,
      };
      const { data, error } = await sb.from("site_leads").insert(row).select("id").single();
      if (error) throw new Error(`site_leads insert: ${error.message}`);
      return String(data.id);
    },
    async markGhl(id, o) {
      const { error } = await sb
        .from("site_leads")
        .update({ ghl_contact_id: o.contactId, ghl_opportunity_id: o.opportunityId, ghl_error: o.error, ghl_at: new Date().toISOString() })
        .eq("id", id);
      if (error) console.warn("[Site Leads] markGhl failed:", error.message);
    },
  };
}

// ---------- GoHighLevel ----------

export interface SiteGhlConfig extends Omit<GhlConfig, "pipelineId" | "stageNewId"> {
  /** AEO pipeline (required for an opportunity on audit leads). */
  aeoPipelineId?: string;
  aeoStageNewId?: string;
  /** Automation pipeline (optional; without it the enquiry is a contact plus note). */
  automationPipelineId?: string;
  automationStageNewId?: string;
}

export function siteGhlConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SiteGhlConfig | null {
  const apiKey = (env.GHL_API_KEY || "").trim();
  const locationId = (env.GHL_LOCATION_ID || "").trim();
  if (!apiKey || !locationId) return null;
  return {
    apiKey,
    locationId,
    aeoPipelineId: (env.GHL_AEO_PIPELINE_ID || "").trim() || undefined,
    aeoStageNewId: (env.GHL_AEO_STAGE_NEW_ID || "").trim() || undefined,
    automationPipelineId: (env.GHL_AUTOMATION_PIPELINE_ID || "").trim() || undefined,
    automationStageNewId: (env.GHL_AUTOMATION_STAGE_NEW_ID || "").trim() || undefined,
    baseUrl: (env.GHL_API_BASE || "").trim() || undefined,
  };
}

async function ghlPost(cfg: SiteGhlConfig, fetchFn: FetchLike, path: string, payload: unknown): Promise<any> {
  const res = await fetchFn(`${cfg.baseUrl || "https://services.leadconnectorhq.com"}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GHL ${path} failed with ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export interface SiteGhlResult {
  contactId: string;
  opportunityId: string | null;
}

/** Contact upsert + note always; an opportunity when the kind's pipeline is configured. */
export async function writeSiteLeadToGhl(lead: SiteLead, cfg: SiteGhlConfig, fetchFn: FetchLike): Promise<SiteGhlResult> {
  const upsert = await ghlPost(cfg, fetchFn, "/contacts/upsert", {
    locationId: cfg.locationId,
    firstName: lead.first_name,
    lastName: lead.last_name,
    name: lead.name,
    email: lead.email,
    ...(lead.phone ? { phone: lead.phone } : {}),
    companyName: lead.business_name,
    ...(lead.domain ? { website: lead.domain } : {}),
    ...(lead.city ? { city: lead.city } : {}),
    source: `${lead.kind === "aeo" ? "aeo-page" : "automation-page"} / ${campaignLabel(lead)}`,
    tags: lead.kind === "aeo" ? ["aeo-audit-request", `industry:${lead.industry}`] : ["automation-enquiry", `job:${lead.job}`],
  });
  const contactId: string | undefined = upsert?.contact?.id;
  if (!contactId) throw new Error("GHL contact upsert returned no contact id");

  await ghlPost(cfg, fetchFn, `/contacts/${encodeURIComponent(contactId)}/notes`, { body: buildSiteLeadNote(lead) });

  const pipelineId = lead.kind === "aeo" ? cfg.aeoPipelineId : cfg.automationPipelineId;
  const stageId = lead.kind === "aeo" ? cfg.aeoStageNewId : cfg.automationStageNewId;
  if (!pipelineId || !stageId) return { contactId, opportunityId: null };

  const opp = await ghlPost(cfg, fetchFn, "/opportunities/", {
    pipelineId,
    locationId: cfg.locationId,
    pipelineStageId: stageId,
    contactId,
    name: lead.kind === "aeo" ? `AEO audit - ${lead.business_name}` : `AI automation - ${lead.business_name}`,
    status: "open",
    source: campaignLabel(lead),
  });
  const opportunityId: string | undefined = opp?.opportunity?.id ?? opp?.id;
  if (!opportunityId) throw new Error("GHL opportunity create returned no opportunity id");
  return { contactId, opportunityId };
}

// ---------- the card ----------

export function siteLeadCard(lead: SiteLead, ghl: SiteGhlResult | null, ghlError: string | null): { title: string; summary: string } {
  const title = lead.kind === "aeo" ? `Audit request: ${lead.business_name}` : `Automation enquiry: ${lead.business_name}`;
  const lines =
    lead.kind === "aeo"
      ? [`*${lead.business_name}* (${lead.domain}), ${lead.industry}${lead.city ? `, ${lead.city}` : ""}`]
      : [`*${lead.business_name}* wants to automate: ${lead.job}${lead.message ? `\n"${lead.message.slice(0, 280)}"` : ""}`];
  lines.push(`Contact: ${lead.name}, ${lead.email}${lead.phone ? `, ${lead.phone}` : ""}`);
  lines.push(`Source: ${campaignLabel(lead)} (${lead.page})`);
  lines.push(
    ghl
      ? `GoHighLevel: contact ${ghl.contactId}${ghl.opportunityId ? `, opportunity ${ghl.opportunityId}` : ", no pipeline configured"}`
      : ghlError
        ? `GoHighLevel: not written (${ghlError.slice(0, 120)}). Saved in the company database; follow up by hand.`
        : "GoHighLevel: not configured. Saved in the company database; follow up by hand.",
  );
  lines.push(lead.kind === "aeo" ? "Promise on the site: one-page report by email within 24 hours." : "Promise on the site: reply by email within one working day.");
  return { title, summary: lines.join("\n") };
}
