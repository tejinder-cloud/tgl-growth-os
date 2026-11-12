// services/tgl-ops/src/agents/prospect-researcher/contact-verify.ts
// Rubric v2 fixes (issue #184), Dimension 5: an email counts as verified only when its domain matches the
// prospect's website root domain. Free-mail domains and generic local parts never count.
// Pure module: no network, no clock.

/** Root labels of free-mail providers. gmail.com, gmail.co.in, yahoo.co.in, outlook.in all resolve to these labels. */
export const FREE_MAIL_ROOT_LABELS = new Set([
  "gmail", "googlemail", "yahoo", "ymail", "outlook", "hotmail", "live", "msn", "rediffmail", "rediff",
  "icloud", "me", "protonmail", "proton", "aol", "zoho",
]);

/** Local parts that reach a shared inbox, not a decision maker. */
export const GENERIC_LOCAL_PARTS = new Set([
  "info", "contact", "writetous", "admin", "support", "hello",
  "sales", "help", "billing", "office", "enquiry", "enquiries", "mail", "care", "reception", "desk", "feedback",
  "contactus", "appointments", "appointment", "booking", "bookings", "hr", "careers", "marketing",
]);

// Second-level public suffixes under which the registrable domain has three labels (example.co.in).
const SECOND_LEVEL_SUFFIXES = new Set(["co", "com", "org", "net", "ac", "edu", "gov", "nic", "res", "in", "ltd", "plc"]);

/** Hostname of a URL or bare domain, lowercased, without www. Returns "" when unreadable. */
export function hostnameOf(urlOrDomain: string): string {
  try {
    let clean = (urlOrDomain || "").trim();
    if (!clean) return "";
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(clean)) clean = `https://${clean}`;
    return new URL(clean).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Registrable root domain of a URL, domain or email domain: "www.clinic.co.in/path" -> "clinic.co.in". */
export function rootDomainOf(urlOrDomain: string): string {
  const host = hostnameOf(urlOrDomain);
  if (!host) return "";
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  if (tld.length === 2 && SECOND_LEVEL_SUFFIXES.has(sld)) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

export function emailDomainOf(email: string): string {
  const at = (email || "").trim().toLowerCase().lastIndexOf("@");
  return at >= 0 ? (email || "").trim().toLowerCase().slice(at + 1) : "";
}

export function emailLocalPartOf(email: string): string {
  const e = (email || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return (at >= 0 ? e.slice(0, at) : e).split("+")[0];
}

export function isFreeMailDomain(domain: string): boolean {
  const root = rootDomainOf(domain);
  if (!root) return false;
  return FREE_MAIL_ROOT_LABELS.has(root.split(".")[0]);
}

export function isGenericLocalPart(email: string): boolean {
  return GENERIC_LOCAL_PARTS.has(emailLocalPartOf(email));
}

export interface EmailAssessment {
  ok: boolean;
  /** Plain-text reason when not ok. */
  reason?: string;
}

/** Decides whether an email can count as a verified decision-maker email for a prospect with this website. */
export function assessDecisionMakerEmail(email: string | undefined | null, website: string | undefined | null): EmailAssessment {
  const e = (email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return { ok: false, reason: "no email" };
  const domain = emailDomainOf(e);
  if (!domain) return { ok: false, reason: `email '${e}' has no domain` };
  if (isFreeMailDomain(domain)) return { ok: false, reason: `free-mail domain '${domain}'` };
  if (isGenericLocalPart(e)) return { ok: false, reason: `generic local part '${emailLocalPartOf(e)}@'` };
  const siteRoot = rootDomainOf(website || "");
  if (!siteRoot) return { ok: false, reason: "prospect website root domain unknown" };
  const mailRoot = rootDomainOf(domain);
  if (mailRoot !== siteRoot) return { ok: false, reason: `email domain '${mailRoot}' does not match website root domain '${siteRoot}'` };
  return { ok: true };
}
