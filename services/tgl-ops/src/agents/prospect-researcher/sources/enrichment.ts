// services/tgl-ops/src/agents/prospect-researcher/sources/enrichment.ts
import { sanitizeDecisionMaker, isRolePlaceholderName } from "../guardrails.js";
import type { DecisionMaker, ProspectSignals } from "../types.js";
import type { RawPlaceCandidate } from "./places.js";
import { checkMetaAdLibrary } from "./meta-ads.js";
import { scrapeClinicWebsite } from "./website-scraper.js";
import { isSubBranchUrl } from "../rubric.js";
import { assessLargeOrg } from "../brand.js";
import { assessDecisionMakerEmail } from "../contact-verify.js";

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
 * Issue #184: a generic brand prefix such as "dr." never counts as a multi-branch signal (see brand.ts assessLargeOrg).
 */
export function isCandidateOrgSizeGe50(
  candidate: { name: string; userRatingsTotal?: number; placesBrandCount?: number; brandPrefix?: string },
  category?: string,
  signals?: { branch_count?: number; brand_prefix?: string }
): boolean {
  return assessLargeOrg({
    name: candidate.name,
    category,
    userRatingsTotal: candidate.userRatingsTotal,
    placesBrandCount: candidate.placesBrandCount,
    brandPrefix: candidate.brandPrefix ?? signals?.brand_prefix,
    signals: signals as ProspectSignals | undefined,
  }).isLarge;
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

  if (candidate.website && isSubBranchUrl(candidate.website)) {
    chainEvidence.push(`Root domain hosts other branches via subpath ${candidate.website}`);
  }

  // Check Places brand count signal (>1 places under same brand)
  if (candidate.placesBrandCount && candidate.placesBrandCount > 1) {
    chainEvidence.push(
      `Found ${candidate.placesBrandCount} Places results sharing brand '${candidate.brandPrefix || candidate.name}'`
    );
  }

  const rootDomainHostsOtherBranches = Boolean(
    (candidate.website && isSubBranchUrl(candidate.website)) ||
    chainEvidence.some((e) => /locations?\/centres?|hospital-network|other branches/i.test(e))
  );

  // Issue #184: is_large_org comes from category, name, review volume or a REAL multi-branch signal.
  // A generic brand prefix ("dr.") is never a multi-branch signal.
  const largeOrg = assessLargeOrg({
    name: candidate.name,
    category,
    userRatingsTotal: candidate.userRatingsTotal,
    placesBrandCount: candidate.placesBrandCount,
    brandPrefix: candidate.brandPrefix,
    signals: {
      chain_evidence: chainEvidence.length > 0 ? chainEvidence : undefined,
      root_domain_hosts_other_branches: rootDomainHostsOtherBranches,
    } as ProspectSignals,
  });
  const orgSizeGe50 = largeOrg.isLarge;

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
    is_large_org_reason: largeOrg.reason,
    brand_prefix: candidate.brandPrefix,
    primary_place_type: candidate.primaryType,
    primary_place_type_label: candidate.primaryTypeLabel,
    root_domain_hosts_other_branches: rootDomainHostsOtherBranches,
  };

  return {
    decisionMaker,
    signals,
    sourceRefs,
  };
}
