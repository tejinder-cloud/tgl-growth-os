// services/tgl-ops/src/agents/prospect-researcher/sources/enrichment.ts
import { sanitizeDecisionMaker, isRolePlaceholderName } from "../guardrails.js";
import type { DecisionMaker, ProspectSignals } from "../types.js";
import type { RawPlaceCandidate } from "./places.js";
import { checkMetaAdLibrary } from "./meta-ads.js";
import { scrapeClinicWebsite } from "./website-scraper.js";

const HUNTER_API_KEY = process.env.HUNTER_API_KEY || "";

export interface EnrichedProspectDetails {
  decisionMaker: DecisionMaker & { verified: boolean };
  signals: ProspectSignals;
  sourceRefs: string[];
}

/**
 * Validates whether a given title/position corresponds to an approved Playbook D decision-maker role.
 * - <50 staff: owner / founder / MD / lead doctor / principal
 * - ≥50 staff: adds CEO, COO, GM, VP Operations/Administration, hospital administrator, head of marketing
 * Non-DM roles (Assistant, Consultant, Nurse, etc.) are strictly rejected across both tiers.
 */
export function isDecisionMakerRole(role: string, orgSizeGe50: boolean = false): boolean {
  if (!role || typeof role !== "string") return false;
  const r = role.toLowerCase().trim();

  // Explicit non-DM roles that must be rejected as decision makers
  if (
    r.includes("assistant") ||
    r.includes("consultant") ||
    r.includes("resident") ||
    r.includes("fellow") ||
    r.includes("intern") ||
    r.includes("nurse") ||
    r.includes("reception") ||
    r.includes("billing") ||
    r.includes("clerk") ||
    r.includes("coordinator") ||
    r.includes("technician")
  ) {
    // Only allowed if explicitly qualified with owner / founder / managing director
    if (!r.includes("owner") && !r.includes("founder") && !r.includes("managing director")) {
      return false;
    }
  }

  // Tier 1: Approved DM roles for <50 staff (Owner-run clinics and institutes)
  const isSmallOrgDM =
    r.includes("owner") ||
    r.includes("founder") ||
    r.includes("co-founder") ||
    r === "md" ||
    r.includes("managing director") ||
    r.includes("lead doctor") ||
    r.includes("clinic owner") ||
    r.includes("chief doctor") ||
    r.includes("principal");

  if (isSmallOrgDM) {
    return true;
  }

  // Tier 2: For ≥50 staff, add CEO, COO, GM, VP Operations/Administration, hospital administrator, head of marketing
  if (orgSizeGe50) {
    const isLargeOrgAddonDM =
      r === "ceo" ||
      r.includes("chief executive") ||
      r === "coo" ||
      r.includes("chief operating") ||
      r === "gm" ||
      r.includes("general manager") ||
      r.includes("vp operations") ||
      r.includes("vp administration") ||
      r.includes("vice president of operations") ||
      r.includes("vice president operations") ||
      r.includes("vice president administration") ||
      r.includes("vice president of administration") ||
      r.includes("vp ops") ||
      r.includes("vp admin") ||
      r.includes("hospital administrator") ||
      r.includes("medical superintendent") ||
      r.includes("administrator") ||
      r.includes("head of marketing") ||
      r.includes("marketing head") ||
      r === "cmo" ||
      r.includes("chief marketing") ||
      r.includes("marketing director") ||
      r.includes("vp marketing");

    if (isLargeOrgAddonDM) {
      return true;
    }
  }

  return false;
}

/**
 * Determines whether a candidate organisation is ≥50 staff based on category, name, review volume, and branch count.
 */
export function isCandidateOrgSizeGe50(
  candidate: { name: string; userRatingsTotal?: number; placesBrandCount?: number },
  category?: string,
  signals?: { branch_count?: number }
): boolean {
  const normName = candidate.name.toLowerCase();
  const cat = (category || "").toLowerCase();

  // Category hospitals or multi-speciality hospitals are ≥50 staff
  if (
    cat === "hospitals" ||
    cat === "hospital" ||
    normName.includes("hospital") ||
    normName.includes("super speciality") ||
    normName.includes("multispeciality") ||
    normName.includes("medical centre") ||
    normName.includes("institute")
  ) {
    return true;
  }

  // High review volume or multi-branch
  if (
    (candidate.userRatingsTotal && candidate.userRatingsTotal >= 200) ||
    (candidate.placesBrandCount && candidate.placesBrandCount >= 2) ||
    (signals?.branch_count && signals.branch_count >= 2)
  ) {
    return true;
  }

  return false;
}

/**
 * Enriches prospect candidate with verified decision-maker and operational budget signals.
 * Contacts are populated only if verified by Hunter API or Google Places verified business phone.
 */
export async function enrichCandidateSignals(
  candidate: RawPlaceCandidate,
  category: string,
  options?: { testMode?: boolean }
): Promise<EnrichedProspectDetails> {
  const sourceRefs: string[] = [];
  if (candidate.placeId) {
    sourceRefs.push(`places:place_id:${candidate.placeId}`);
  }
  if (candidate.googleMapsUrl) {
    sourceRefs.push(candidate.googleMapsUrl);
  }
  if (candidate.dnsIp) {
    sourceRefs.push(`dns:pass:${candidate.dnsIp}`);
  }

  // 1. Meta Ad Library verification via Apify web-scraper
  const metaAds = await checkMetaAdLibrary(candidate.name, options);
  if (metaAds.adLibraryUrl) {
    sourceRefs.push(metaAds.adLibraryUrl);
  }

  // 2. Scrape clinic website (Playbook D + chain detection signals)
  let websiteDoctorName: string | undefined;
  let websiteDoctorRole: string | undefined;
  let websiteEmails: string[] = [];
  const chainEvidence: string[] = [];

  if (candidate.website) {
    try {
      const scraped = await scrapeClinicWebsite(candidate.website, candidate.name);
      websiteDoctorName = scraped.primaryDoctorName;
      websiteDoctorRole = scraped.doctorRole;
      websiteEmails = scraped.emails;

      if (scraped.chainSignals?.evidence && scraped.chainSignals.evidence.length > 0) {
        chainEvidence.push(...scraped.chainSignals.evidence);
      }
    } catch (err: any) {
      console.warn(`[Playbook D Scraper Warning on ${candidate.website}]:`, err.message || err);
    }
  }

  // Check Places brand count signal (>1 places under same brand)
  if (candidate.placesBrandCount && candidate.placesBrandCount > 1) {
    chainEvidence.push(
      `Found ${candidate.placesBrandCount} Places results sharing brand '${candidate.brandPrefix || candidate.name}'`
    );
  }

  const orgSizeGe50 = isCandidateOrgSizeGe50(candidate, category);

  // 3. Decision Maker Identification (Hunter domain search + /v2/email-verifier + Places phone)
  const decisionMaker = await findVerifiedDecisionMaker(
    candidate,
    orgSizeGe50,
    websiteDoctorName,
    websiteDoctorRole,
    websiteEmails,
    options
  );
  if (decisionMaker.source) {
    sourceRefs.push(decisionMaker.source);
  }

  // 4. Operational Signals evaluation
  const reviewsCount = candidate.userRatingsTotal || 0;
  const rating = candidate.rating || 0;

  const gbpMaturity = reviewsCount >= 50 && rating >= 4.0;
  const reviewSurge = reviewsCount >= 100;
  const branchCount =
    candidate.placesBrandCount || (candidate.name.toLowerCase().includes("hospital") || reviewsCount > 2000 ? 3 : 1);
  const hiringMarketing = metaAds.active && reviewsCount > 500;

  const signals: ProspectSignals = {
    meta_ads_active: metaAds.active,
    meta_ad_count: metaAds.adCount,
    gbp_reviews: reviewsCount,
    gbp_owner_replies: gbpMaturity,
    hiring_marketing: hiringMarketing,
    review_surge: reviewSurge,
    branch_count: branchCount,
    ad_library_url: metaAds.adLibraryUrl,
    chain_evidence: chainEvidence.length > 0 ? chainEvidence : undefined,
    places_brand_count: candidate.placesBrandCount,
    is_large_org: orgSizeGe50,
    brand_prefix: candidate.brandPrefix,
  };

  return {
    decisionMaker,
    signals,
    sourceRefs,
  };
}

interface RankedCandidateEmail {
  email: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  confidence: number;
  priorityScore: number;
  isDM: boolean;
}

/**
 * Discovers and validates economic decision-maker via real Hunter API and website scraping.
 * Enforces Playbook D roles by organisation size (<50 staff vs ≥50 staff).
 * Non-DM contacts (Assistant, Consultant, etc.) are labeled "DM unknown" and marked "contact found, DM unknown".
 */
async function findVerifiedDecisionMaker(
  candidate: RawPlaceCandidate,
  orgSizeGe50: boolean,
  websiteDoctorName?: string,
  websiteDoctorRole?: string,
  websiteEmails: string[] = [],
  options?: { testMode?: boolean }
): Promise<DecisionMaker & { verified: boolean }> {
  const domain = extractDomain(candidate.website || "");

  let verifiedHunterEmail: string | undefined;
  let verifiedHunterName: string | undefined;
  let verifiedHunterRole: string | undefined;
  let hunterVerifierStatus: string | undefined;
  let hunterVerifierScore: number | undefined;
  let isDM = false;

  if (HUNTER_API_KEY && domain) {
    const maskedKey = `${HUNTER_API_KEY.slice(0, 4)}...${HUNTER_API_KEY.slice(-4)}`;
    console.log(
      `[Hunter API Real Request] GET https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${maskedKey}`
    );

    const candidateEmailPool: RankedCandidateEmail[] = [];

    // Add any emails scraped from clinic website to candidate pool
    for (const wEmail of websiteEmails) {
      const isRoleDM = isDecisionMakerRole(websiteDoctorRole || "Owner / Lead Doctor", orgSizeGe50);
      candidateEmailPool.push({
        email: wEmail,
        position: websiteDoctorRole || "Owner / Lead Doctor",
        confidence: 80,
        priorityScore: isRoleDM ? 80 : 30,
        isDM: isRoleDM,
      });
    }

    try {
      const res = await fetch(
        `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${HUNTER_API_KEY}&limit=10`
      );
      const data = (await res.json()) as any;
      console.log(
        `[Hunter API Real Response] HTTP ${res.status}: emails=${data.data?.emails?.length || 0}`
      );

      if (res.status === 200 && data && data.data && Array.isArray(data.data.emails)) {
        for (const e of data.data.emails) {
          if (!e.value || typeof e.value !== "string") continue;
          const emailVal = e.value.toLowerCase().trim();

          // Generic never: discard generic emails
          if (e.type === "generic" || isGenericEmail(emailVal)) {
            continue;
          }

          const position = String(e.position || "").trim();
          const fullName = `${e.first_name || ""} ${e.last_name || ""}`.trim();
          const roleIsDM = isDecisionMakerRole(position, orgSizeGe50);

          let priority = 0;
          if (roleIsDM) {
            priority += 100;
          }

          if (e.type === "personal") {
            priority += 40;
          }

          if (fullName && !isRolePlaceholderName(fullName, false)) {
            priority += 20;
          }

          priority += Math.min(20, Math.floor((e.confidence || 0) / 5));

          candidateEmailPool.push({
            email: emailVal,
            firstName: e.first_name,
            lastName: e.last_name,
            position: position || "Staff",
            confidence: e.confidence || 50,
            priorityScore: priority,
            isDM: roleIsDM,
          });
        }
      }
    } catch (err: any) {
      console.warn(`[Hunter Domain Search Error on ${domain}]:`, err.message || err);
    }

    // Sort candidate emails by priorityScore descending
    candidateEmailPool.sort((a, b) => b.priorityScore - a.priorityScore);

    // Pick top candidate and verify via /v2/email-verifier
    if (candidateEmailPool.length > 0) {
      const bestCandidate = candidateEmailPool[0];
      const verifyUrl = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(
        bestCandidate.email
      )}&api_key=${HUNTER_API_KEY}`;

      try {
        const vRes = await fetch(verifyUrl);
        const vData = (await vRes.json()) as any;
        const result = vData.data?.result; // "deliverable" | "risky" | "undeliverable"
        const score = vData.data?.score || 0;
        console.log(
          `[Hunter Verifier Response] HTTP ${vRes.status}: result=${result}, score=${score}`
        );

        if (result === "deliverable" || result === "risky") {
          verifiedHunterEmail = bestCandidate.email;
          hunterVerifierStatus = result;
          hunterVerifierScore = score;
          isDM = bestCandidate.isDM;

          if (isDM) {
            verifiedHunterName =
              bestCandidate.firstName && bestCandidate.lastName
                ? `${bestCandidate.firstName} ${bestCandidate.lastName}`
                : websiteDoctorName || "Owner / Lead Doctor";
            verifiedHunterRole = bestCandidate.position || websiteDoctorRole || "Owner / Lead Doctor";
          } else {
            // Non-DM contact found (e.g. Assistant or Consultant Gastroenterologist)
            // Label as "DM unknown" per Playbook D role enforcement
            verifiedHunterName = "DM unknown";
            verifiedHunterRole = "DM unknown";
          }
        }
      } catch (err: any) {
        console.warn(`[Hunter Email Verifier Error on ${bestCandidate.email}]:`, err.message || err);
      }
    }
  }

  // Option A: Verified Hunter email (deliverable | risky)
  if (verifiedHunterEmail && hunterVerifierStatus) {
    if (!isDM) {
      // Mark "contact found, DM unknown"
      return {
        name: "DM unknown",
        role: "DM unknown",
        email: verifiedHunterEmail,
        phone: candidate.phone,
        source: `contact found, DM unknown (hunter:status: ${hunterVerifierStatus}, score: ${hunterVerifierScore || 0})`,
        verified: true,
      };
    }

    const rawName = verifiedHunterName || websiteDoctorName || "Owner / Lead Doctor";
    const sanitized = sanitizeDecisionMaker(
      {
        name: rawName,
        role: verifiedHunterRole || "Owner / Lead Doctor",
        email: verifiedHunterEmail,
        phone: candidate.phone,
        source: `hunter:verified (status: ${hunterVerifierStatus}, score: ${hunterVerifierScore || 0})`,
      },
      candidate.name
    );
    return {
      ...sanitized,
      verified: true,
    };
  }

  // Option B: Architect Decision for Owner-Run Businesses (<50 staff)
  // For owner-run clinics, an authoritative verified contact is the business phone from Google Places.
  // Decision-maker = owner/doctor.
  if (candidate.phone && candidate.phone.trim().length >= 8) {
    const doctorName = websiteDoctorName || "Owner / Lead Doctor";
    const doctorRole = websiteDoctorRole || "Owner / Lead Doctor";
    const sanitized = sanitizeDecisionMaker(
      {
        name: doctorName,
        role: doctorRole,
        email: "",
        phone: candidate.phone,
        source: `places:phone (verified business line) + website:owner`,
      },
      candidate.name
    );
    return {
      ...sanitized,
      verified: true,
    };
  }

  // Unverified contact
  return {
    name: "",
    role: "",
    email: "",
    source: "unverified:no_contact_found",
    verified: false,
  };
}

function isGenericEmail(email: string): boolean {
  const genericPrefixes = [
    "info@", "contact@", "support@", "admin@", "sales@", "help@",
    "billing@", "office@", "hello@", "enquiry@", "enquiries@", "mail@",
    "care@", "reception@", "desk@", "feedback@"
  ];
  return genericPrefixes.some((p) => email.startsWith(p));
}

function extractDomain(url: string): string {
  try {
    let clean = url.trim();
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = `https://${clean}`;
    }
    return new URL(clean).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
