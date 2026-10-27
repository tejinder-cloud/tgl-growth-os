// services/tgl-ops/src/agents/prospect-researcher/sources/website-scraper.ts
/**
 * Scrapes clinic website for mailto: addresses and doctor/owner names
 * on Homepage, /about, /doctors, /team, and /contact pages (Playbook D).
 */

export interface ScrapedWebsiteResult {
  emails: string[];
  doctorNames: string[];
  primaryDoctorName?: string;
  doctorRole?: string;
  pagesScraped: string[];
}

const GENERIC_EMAIL_PREFIXES = new Set([
  "info", "contact", "support", "admin", "sales", "help",
  "billing", "office", "hello", "enquiry", "enquiries", "mail",
  "care", "reception", "desk", "feedback", "careers", "jobs"
]);

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * Scrapes the clinic's public website for mailto: emails and doctor/owner names.
 */
export async function scrapeClinicWebsite(
  websiteUrl: string,
  companyName: string
): Promise<ScrapedWebsiteResult> {
  const result: ScrapedWebsiteResult = {
    emails: [],
    doctorNames: [],
    pagesScraped: [],
  };

  if (!websiteUrl) {
    return result;
  }

  let baseUrl: URL;
  try {
    let clean = websiteUrl.trim();
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = `https://${clean}`;
    }
    baseUrl = new URL(clean);
  } catch {
    return result;
  }

  // 1. Check clinic company name for doctor name (e.g. "Dr. Kathuria's Dental Clinic")
  const nameFromCompany = extractDoctorName(companyName);
  if (nameFromCompany) {
    result.doctorNames.push(nameFromCompany);
  }

  // 2. Fetch Homepage HTML
  const homeHtml = await fetchHtmlWithTimeout(baseUrl.toString(), 5000);
  if (!homeHtml) {
    return result;
  }
  result.pagesScraped.push(baseUrl.toString());

  // Extract from homepage
  extractEmailsFromHtml(homeHtml, result.emails);
  extractDoctorNamesFromHtml(homeHtml, result.doctorNames);

  // 3. Find subpage links matching /about, /doctors, /team, /contact
  const subpageUrls = findCandidateSubpages(homeHtml, baseUrl);

  // Fetch up to 3 candidate subpages in parallel
  if (subpageUrls.length > 0) {
    const promises = subpageUrls.slice(0, 3).map(async (url) => {
      const html = await fetchHtmlWithTimeout(url, 5000);
      if (html) {
        result.pagesScraped.push(url);
        extractEmailsFromHtml(html, result.emails);
        extractDoctorNamesFromHtml(html, result.doctorNames);
      }
    });
    await Promise.allSettled(promises);
  }

  // Deduplicate emails and doctor names
  result.emails = Array.from(new Set(result.emails.map((e) => e.toLowerCase())));
  result.doctorNames = deduplicateNames(result.doctorNames);

  if (result.doctorNames.length > 0) {
    result.primaryDoctorName = result.doctorNames[0];
    result.doctorRole = determineDoctorRole(result.primaryDoctorName, homeHtml);
  }

  return result;
}

/**
 * Safely fetches HTML text with strict timeout.
 */
async function fetchHtmlWithTimeout(url: string, timeoutMs: number): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return "";
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return "";
    }

    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Extracts non-generic email addresses from HTML (mailto: and text regex).
 */
export function extractEmailsFromHtml(html: string, targetArray: string[]): void {
  if (!html) return;

  // 1. mailto: links
  const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  let match: RegExpExecArray | null;
  while ((match = mailtoRegex.exec(html)) !== null) {
    const email = cleanEmail(match[1]);
    if (isValidNonGenericEmail(email)) {
      targetArray.push(email);
    }
  }

  // 2. Body email regex
  const textEmailRegex = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
  while ((match = textEmailRegex.exec(html)) !== null) {
    const email = cleanEmail(match[1]);
    if (isValidNonGenericEmail(email)) {
      targetArray.push(email);
    }
  }
}

function cleanEmail(email: string): string {
  return email.trim().toLowerCase().replace(/[>,\"'`\s]+$/, "");
}

function isValidNonGenericEmail(email: string): boolean {
  if (!email || !email.includes("@")) return false;
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return false;

  // Ignore image or script extensions
  if (/\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$/i.test(email)) {
    return false;
  }

  // Ignore known telemetry / tracking domains
  if (
    domain.includes("sentry") ||
    domain.includes("wixpress") ||
    domain.includes("wordpress") ||
    domain.includes("schema.org") ||
    domain.includes("google") ||
    domain.includes("facebook")
  ) {
    return false;
  }

  // Filter generic mailboxes
  const lowerLocal = localPart.toLowerCase();
  for (const prefix of GENERIC_EMAIL_PREFIXES) {
    if (lowerLocal === prefix || lowerLocal.startsWith(`${prefix}.`) || lowerLocal.startsWith(`${prefix}_`)) {
      return false;
    }
  }

  return true;
}

/**
 * Extracts doctor and owner names from HTML headings, doctor cards, and text.
 */
export function extractDoctorNamesFromHtml(html: string, targetArray: string[]): void {
  if (!html) return;

  // Look for Dr. [First] [Last] patterns in HTML
  // Examples: Dr. Raman Sharma, Dr. Ankit Gupta, Dr. (Prof.) Rajesh
  const doctorRegex = /\b(Dr\.?\s+(?:\[?[A-Z][a-z]+\]?\.?\s*){1,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = doctorRegex.exec(html)) !== null) {
    const raw = match[1].replace(/[\[\]]/g, "").trim();
    const cleaned = cleanDoctorName(raw);
    if (cleaned && !isJunkDoctorName(cleaned)) {
      targetArray.push(cleaned);
    }
  }
}

function cleanDoctorName(name: string): string {
  let cleaned = name.replace(/\s+/g, " ").trim();
  if (!cleaned.startsWith("Dr.") && cleaned.startsWith("Dr")) {
    cleaned = cleaned.replace(/^Dr\b/, "Dr.");
  }
  // Strip trailing 's or '
  cleaned = cleaned.replace(/'s\b/gi, "").replace(/'\b/g, "");

  // Strip trailing organizational words (e.g. "Dental", "Clinic", "Hospital")
  const orgWords = [
    "dental", "clinic", "hospital", "centre", "center", "care", "team",
    "implant", "orthodontics", "multispeciality", "speciality", "surgery", "institute"
  ];
  const parts = cleaned.split(" ");
  while (parts.length > 2) {
    const last = parts[parts.length - 1].toLowerCase();
    if (orgWords.includes(last)) {
      parts.pop();
    } else {
      break;
    }
  }
  // If 2 parts and second is an org word (e.g. "Dr. Dental"), return empty
  if (parts.length === 2 && orgWords.includes(parts[1].toLowerCase())) {
    return "";
  }

  return parts.join(" ").trim();
}

function isJunkDoctorName(name: string): boolean {
  if (!name || name.length < 4) return true;
  const lower = name.toLowerCase();
  const junkWords = ["clinic", "hospital", "centre", "center", "care", "team", "google", "appointment", "review"];
  return junkWords.some((w) => lower.includes(w));
}

export function extractDoctorName(text: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/\b(Dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (match) {
    const cleaned = cleanDoctorName(match[1]);
    if (cleaned && !isJunkDoctorName(cleaned)) {
      return cleaned;
    }
  }
  return undefined;
}

function deduplicateNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const norm = n.toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(n);
    }
  }
  return out;
}

function determineDoctorRole(doctorName: string, html: string): string {
  const lowerHtml = html.toLowerCase();
  const lowerName = doctorName.toLowerCase().replace(/^dr\.?\s*/, "");

  if (lowerHtml.includes("founder") || lowerHtml.includes("co-founder")) {
    return "Founder & Lead Doctor";
  }
  if (lowerHtml.includes("managing director") || lowerHtml.includes("medical director")) {
    return "Medical Director";
  }
  if (lowerHtml.includes("implantologist")) {
    return "Chief Implantologist";
  }
  if (lowerHtml.includes("chief dentist") || lowerHtml.includes("lead dentist")) {
    return "Lead Dentist";
  }
  return "Owner / Lead Doctor";
}

/**
 * Finds candidate subpage URLs on the website.
 */
function findCandidateSubpages(html: string, baseUrl: URL): string[] {
  const candidateUrls: string[] = [];
  const hrefRegex = /<a\s+[^>]*href=["']([^"'#\s>]+)["']/gi;
  let match: RegExpExecArray | null;

  const priorityKeywords = ["about", "doctor", "team", "dentist", "specialist", "founder", "contact"];

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1].trim();
    if (href.startsWith("tel:") || href.startsWith("mailto:") || href.startsWith("javascript:")) {
      continue;
    }

    try {
      const resolved = new URL(href, baseUrl);
      // Ensure same hostname
      if (resolved.hostname !== baseUrl.hostname) {
        continue;
      }

      const pathLower = resolved.pathname.toLowerCase();
      if (priorityKeywords.some((kw) => pathLower.includes(kw))) {
        if (!candidateUrls.includes(resolved.toString())) {
          candidateUrls.push(resolved.toString());
        }
      }
    } catch {
      // invalid URL, continue
    }
  }

  // Fallback paths to try if no links found in HTML
  if (candidateUrls.length === 0) {
    const fallbacks = ["/about", "/about-us", "/doctors", "/our-doctors", "/our-team", "/contact"];
    for (const fb of fallbacks) {
      candidateUrls.push(new URL(fb, baseUrl).toString());
    }
  }

  return candidateUrls;
}
