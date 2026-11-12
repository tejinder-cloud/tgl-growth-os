// services/tgl-ops/src/agents/prospect-researcher/contact-rules.ts
// Rubric v2 fixes (issue #184): what counts as a decision maker's work email, and who is an individual practitioner.
// Pure: no network, no clock.
//
// A "deliverable" verdict from an email verifier only says the inbox exists. It does not say the inbox belongs to
// the prospect. An email counts toward Dimension 5 only when all three hold:
//   1. its domain is the prospect's own website domain (same registrable domain),
//   2. it is not on a free-mail provider,
//   3. its local part is not a shared inbox (info@, contact@, writetous@ ...).
// Personal data stays limited to work contact details (DPDP): an address that fails is never stored.

export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "ymail.com", "rocketmail.com",
  "outlook.com", "outlook.in", "hotmail.com", "live.com", "live.in", "msn.com", "rediffmail.com", "rediff.com",
  "icloud.com", "me.com", "aol.com", "protonmail.com", "proton.me", "zoho.com", "zohomail.in", "mail.com", "gmx.com",
]);

export const GENERIC_LOCAL_PARTS = new Set([
  "info", "contact", "contactus", "writetous", "write2us", "admin", "administrator", "support", "hello", "hi",
  "sales", "help", "helpdesk", "billing", "accounts", "office", "enquiry", "enquiries", "inquiry", "inquiries",
  "query", "queries", "mail", "email", "care", "customercare", "reception", "frontdesk", "desk", "feedback",
  "appointment", "appointments", "booking", "bookings", "marketing", "hr", "careers", "jobs", "team", "noreply",
  "no-reply", "webmaster", "connect", "reach", "reachus", "service", "services",
]);

// Second-level labels that sit under a two-letter country TLD (co.in, org.in, ac.in, com.au ...).
const COUNTRY_SECOND_LEVELS = new Set(["co", "com", "org", "net", "ac", "edu", "gov", "res", "gen", "firm", "ind"]);

/** Hostname of a URL or bare domain, lower-cased, without "www.". Empty string when unreadable. */
export function hostOf(urlOrDomain: string): string {
  try {
    let clean = (urlOrDomain || "").trim();
    if (!clean) return "";
    if (!/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
    return new URL(clean).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Registrable domain of a URL, hostname or bare domain: "mail.clinic.co.in" -> "clinic.co.in". */
export function rootDomainOf(urlOrDomain: string): string {
  const host = hostOf(urlOrDomain);
  if (!host) return "";
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && COUNTRY_SECOND_LEVELS.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

export type WorkEmailRejection = "missing" | "malformed" | "free_mail" | "generic_inbox" | "domain_mismatch" | "no_website";

export interface WorkEmailAssessment {
  ok: boolean;
  rejection?: WorkEmailRejection;
  /** Plain-English reason, safe for fit_reasons and logs. Never contains the address itself. */
  reason: string;
}

/** Decides whether an email may count as the prospect's verified work email. */
export function assessWorkEmail(email: string | undefined | null, website: string | undefined | null): WorkEmailAssessment {
  const value = (email || "").trim().toLowerCase();
  if (!value) return { ok: false, rejection: "missing", reason: "no email on record" };
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return { ok: false, rejection: "malformed", reason: "email is malformed" };
  const local = value.slice(0, at);
  const emailHost = value.slice(at + 1);
  const emailRoot = rootDomainOf(emailHost);

  if (FREE_MAIL_DOMAINS.has(emailHost) || FREE_MAIL_DOMAINS.has(emailRoot)) {
    return { ok: false, rejection: "free_mail", reason: `email is on a free-mail provider (${emailRoot}), not the prospect's own domain` };
  }
  const localBase = local.split("+")[0].replace(/[._-]/g, "");
  if (GENERIC_LOCAL_PARTS.has(local) || GENERIC_LOCAL_PARTS.has(localBase)) {
    return { ok: false, rejection: "generic_inbox", reason: "email is a shared inbox, not a named person" };
  }
  const siteRoot = rootDomainOf(website || "");
  if (!siteRoot) {
    return { ok: false, rejection: "no_website", reason: "prospect has no website domain to match the email against" };
  }
  if (emailRoot !== siteRoot) {
    return { ok: false, rejection: "domain_mismatch", reason: `email domain (${emailRoot}) does not match the prospect's website (${siteRoot})` };
  }
  return { ok: true, reason: `email is on the prospect's own domain (${siteRoot})` };
}

const HONORIFIC = /^\s*(?:dr|doctor|prof|professor|adv|advocate|ca)\b\.?\s+/i;
const ORGANISATION_WORDS = /\b(?:hospitals?|institutes?|medical (?:centre|center|college)|super\s*special(?:i)?ty|multi\s*special(?:i)?ty|nursing home|healthcare|group|chain|academy|classes|university|college|pvt|ltd|llp)\b/i;

/**
 * True when a Places name is a person's own practice ("Dr. A Sharma | Laparoscopic Surgeon"), not an organisation.
 * A name that opens with an honorific but also carries an organisation word ("Dr. Sharma's Hospital") is an organisation.
 */
export function isIndividualPractitionerName(name: string): boolean {
  const n = (name || "").trim();
  if (!HONORIFIC.test(n)) return false;
  return !ORGANISATION_WORDS.test(n);
}

/** Strips a leading honorific: "Dr. Harsh Aggarwal | Laparoscopic Surgeon" -> "Harsh Aggarwal | Laparoscopic Surgeon". */
export function stripHonorific(name: string): string {
  return (name || "").replace(HONORIFIC, "").trim();
}

// Words that can never stand alone as a brand: they describe what a business is, not which one it is.
export const GENERIC_BRAND_TOKENS = new Set([
  "dr", "doctor", "prof", "professor", "the", "new", "sri", "shri", "shree", "city", "best", "top", "care", "health",
  "healthcare", "life", "medical", "medicare", "hospital", "hospitals", "clinic", "clinics", "centre", "center",
  "dental", "dentist", "eye", "ivf", "fertility", "institute", "academy", "classes", "coaching", "super", "multi",
  "speciality", "specialty", "advanced", "modern", "global", "india", "indian", "national", "international",
]);

/** A brand token usable for matching: lower-case letters and digits only, at least four characters, not generic. */
export function usableBrandToken(brand: string | undefined | null): string | null {
  const t = (brand || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t.length < 4 || GENERIC_BRAND_TOKENS.has(t)) return null;
  return t;
}
