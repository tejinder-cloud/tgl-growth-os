// services/tgl-ops/src/agents/prospect-researcher/sources/website-scraper.ts
/**
 * Scrapes clinic website for mailto: addresses and doctor/owner names
 * on Homepage, /about, /doctors, /team, and /contact pages (Playbook D),
 * and detects chain signals (5+ cities, locations/centres pages, funding).
 * Uses Apify cheerio-scraper when APIFY_API_TOKEN is present, falling back to direct fetch.
 */

export interface ChainSignals {
  citiesFound: string[];
  hasLocationsPage: boolean;
  locationsUrl?: string;
  fundingMatches: string[];
  evidence: string[];
}

export interface ScrapedWebsiteResult {
  emails: string[];
  doctorNames: string[];
  primaryDoctorName?: string;
  doctorRole?: string;
  pagesScraped: string[];
  chainSignals: ChainSignals;
}

const GENERIC_EMAIL_PREFIXES = new Set([
  "info", "contact", "support", "admin", "sales", "help",
  "billing", "office", "hello", "enquiry", "enquiries", "mail",
  "care", "reception", "desk", "feedback", "careers", "jobs"
]);

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export const MAJOR_INDIAN_CITIES = [
  "delhi", "new delhi", "gurgaon", "gurugram", "noida", "greater noida", "faridabad", "ghaziabad",
  "mumbai", "navi mumbai", "thane", "pune", "nagpur", "nashik", "aurangabad",
  "bengaluru", "bangalore", "mysore", "mangalore", "hyderabad", "secunderabad",
  "chennai", "coimbatore", "madurai", "kolkata", "howrah", "ahmedabad", "surat",
  "vadodara", "rajkot", "chandigarh", "mohali", "panchkula", "jaipur", "jodhpur",
  "udaipur", "lucknow", "kanpur", "agra", "varanasi", "prayagraj", "indore",
  "bhopal", "patna", "bhubaneswar", "cuttack", "kochi", "cochin", "thiruvananthapuram",
  "visakhapatnam", "vijayawada", "guwahati", "dehradun", "ludhiana", "amritsar", "jalandhar", "ranchi", "raipur"
];

export const FUNDING_PATTERNS = [
  /\bseries\s+[a-f]\b/i,
  /\bfunded\s+by\b/i,
  /\bventure\s+capital\b/i,
  /\bventure[- ]backed\b/i,
  /\braised\s+(?:\$|usd|inr|rs\.?|₹)\s*\d+/i,
  /\b(?:sequoia|tiger\s+global|elevation\s+capital|matrix\s+partners|accel|softbank|chiratae|nexus\s+venture|lightspeed|peak\s+xv)\b/i,
  /\bunicorn\b/i,
];

/**
 * Extracts chain signals from accumulated HTML across scraped pages.
 */
export function extractChainSignalsFromHtml(
  html: string,
  urlsScraped: string[]
): ChainSignals {
  const lowerText = html.toLowerCase().replace(/<[^>]+>/g, " ");

  // 1. Detect Indian cities
  const matchedCities = new Set<string>();
  for (const city of MAJOR_INDIAN_CITIES) {
    const cityRegex = new RegExp(`\\b${city}\\b`, "i");
    if (cityRegex.test(lowerText)) {
      matchedCities.add(city);
    }
  }
  const citiesFound = Array.from(matchedCities);

  // 2. Detect Locations pages from scraped URLs or HTML links
  let hasLocationsPage = false;
  let locationsUrl: string | undefined;

  for (const u of urlsScraped) {
    const pathLower = u.toLowerCase();
    if (
      pathLower.includes("/location") ||
      pathLower.includes("/centre") ||
      pathLower.includes("/center") ||
      pathLower.includes("/branch") ||
      pathLower.includes("/clinic") ||
      pathLower.includes("/find-a-") ||
      pathLower.includes("/cities")
    ) {
      hasLocationsPage = true;
      locationsUrl = u;
      break;
    }
  }

  if (!hasLocationsPage) {
    const linkMatch = html.match(/href=["']([^"'#\s>]+(?:locations?|centres?|centers?|branches?)[^"'#\s>]*)["']/i);
    if (linkMatch) {
      hasLocationsPage = true;
      locationsUrl = linkMatch[1];
    }
  }

  // 3. Detect Funding mentions
  const fundingMatches: string[] = [];
  for (const pattern of FUNDING_PATTERNS) {
    const match = lowerText.match(pattern);
    if (match) {
      fundingMatches.push(match[0].trim());
    }
  }

  const evidence: string[] = [];
  if (citiesFound.length >= 5) {
    evidence.push(`Website lists ${citiesFound.length} cities: ${citiesFound.slice(0, 8).join(", ")}`);
  }
  if (hasLocationsPage && locationsUrl) {
    evidence.push(`Locations/centres page found: ${locationsUrl}`);
  }
  if (fundingMatches.length > 0) {
    evidence.push(`Funding mentions detected: ${fundingMatches.join(", ")}`);
  }

  return {
    citiesFound,
    hasLocationsPage,
    locationsUrl,
    fundingMatches,
    evidence,
  };
}

/**
 * Scrapes the clinic's public website for mailto: emails, doctor/owner names,
 * and chain signals. Uses Apify cheerio-scraper if APIFY_API_TOKEN is set,
 * otherwise falls back to direct fetch.
 */
export async function scrapeClinicWebsite(
  websiteUrl: string,
  companyName: string
): Promise<ScrapedWebsiteResult> {
  const result: ScrapedWebsiteResult = {
    emails: [],
    doctorNames: [],
    pagesScraped: [],
    chainSignals: {
      citiesFound: [],
      hasLocationsPage: false,
      fundingMatches: [],
      evidence: [],
    },
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

  let combinedHtml = "";
  const apifyToken = process.env.APIFY_API_TOKEN;

  // 2. Try Apify cheerio-scraper if token is present
  if (apifyToken) {
    try {
      console.log(`[Apify Scraper] Running apify~cheerio-scraper for ${baseUrl.toString()}`);
      const targetSubpages = [
        baseUrl.toString(),
        new URL("/about", baseUrl).toString(),
        new URL("/contact", baseUrl).toString(),
        new URL("/doctors", baseUrl).toString(),
        new URL("/locations", baseUrl).toString(),
      ];

      const apifyRes = await fetch(
        `https://api.apify.com/v2/acts/apify~cheerio-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=30`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startUrls: targetSubpages.map((u) => ({ url: u })),
            maxRequestsPerCrawl: 5,
            pageFunction:
              "async function pageFunction(context) { const { $, request } = context; return { url: request.url, html: $.html() || '', text: $('body').text() || '' }; }",
          }),
          signal: AbortSignal.timeout(35000),
        }
      );

      if (apifyRes.ok) {
        const items = (await apifyRes.json()) as any;
        if (Array.isArray(items) && items.length > 0) {
          for (const item of items) {
            if (item.url && !result.pagesScraped.includes(item.url)) {
              result.pagesScraped.push(item.url);
            }
            if (item.html) {
              combinedHtml += " " + item.html;
              extractEmailsFromHtml(item.html, result.emails);
              extractDoctorNamesFromHtml(item.html, result.doctorNames);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Apify Cheerio Scraper Warning for ${baseUrl.hostname}]:`, err.message || err);
    }
  }

  // 3. Fallback to direct fetch if Apify returned 0 pages or no token
  if (result.pagesScraped.length === 0) {
    const homeHtml = await fetchHtmlWithTimeout(baseUrl.toString(), 5000);
    if (homeHtml) {
      result.pagesScraped.push(baseUrl.toString());
      combinedHtml += " " + homeHtml;
      extractEmailsFromHtml(homeHtml, result.emails);
      extractDoctorNamesFromHtml(homeHtml, result.doctorNames);

      const subpageUrls = findCandidateSubpages(homeHtml, baseUrl);
      if (subpageUrls.length > 0) {
        const promises = subpageUrls.slice(0, 4).map(async (url) => {
          const html = await fetchHtmlWithTimeout(url, 5000);
          if (html) {
            result.pagesScraped.push(url);
            combinedHtml += " " + html;
            extractEmailsFromHtml(html, result.emails);
            extractDoctorNamesFromHtml(html, result.doctorNames);
          }
        });
        await Promise.allSettled(promises);
      }
    }
  }

  // Deduplicate emails and doctor names
  result.emails = Array.from(new Set(result.emails.map((e) => e.toLowerCase())));
  result.doctorNames = deduplicateNames(result.doctorNames);

  if (result.doctorNames.length > 0) {
    result.primaryDoctorName = result.doctorNames[0];
    result.doctorRole = determineDoctorRole(result.primaryDoctorName, combinedHtml);
  }

  // Extract chain signals from combined HTML and visited pages
  result.chainSignals = extractChainSignalsFromHtml(combinedHtml, result.pagesScraped);

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

function cleanDoctorName(raw: string): string {
  if (!raw) return "";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return "";

  const orgWords = [
    "clinic", "hospital", "centre", "center", "care", "dental", "team",
    "healthcare", "institute", "health", "speciality", "surgery"
  ];

  // Strip trailing org words (e.g. "Dr. Kathuria Dental" -> "Dr. Kathuria")
  while (parts.length > 2 && orgWords.includes(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }

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

  const priorityKeywords = [
    "about", "doctor", "team", "dentist", "specialist", "founder", "contact",
    "locations", "centres", "centers", "branches", "clinics"
  ];

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1].trim();
    if (href.startsWith("tel:") || href.startsWith("mailto:") || href.startsWith("javascript:")) {
      continue;
    }

    try {
      const resolved = new URL(href, baseUrl);
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
      // ignore
    }
  }

  if (candidateUrls.length === 0) {
    const fallbacks = ["/about", "/about-us", "/doctors", "/our-doctors", "/our-team", "/contact", "/locations"];
    for (const fb of fallbacks) {
      candidateUrls.push(new URL(fb, baseUrl).toString());
    }
  }

  return candidateUrls;
}
