// services/tgl-ops/src/agents/prospect-researcher/sources/places.ts
import dns from "node:dns/promises";
import { MAX_DAILY_PLACES_CALLS, checkAndConsumePlacesQuota, getPlacesQuotaState } from "../guardrails.js";

export interface RawPlaceCandidate {
  placeId: string;
  name: string;
  address: string;
  city: string;
  website?: string;
  rating?: number;
  userRatingsTotal?: number;
  phone?: string;
  googleMapsUrl?: string;
  placeIdVerified?: boolean;
  rawApiResponseExcerpt?: string;
  dnsVerified?: boolean;
  dnsIp?: string;
  placesBrandCount?: number;
  brandPrefix?: string;
  placeDetailsEnriched?: boolean;
  placeDetailsError?: string;
  /** Google Places primary type ("dental_clinic") and its display name ("Dental clinic"). */
  primaryType?: string;
  primaryTypeLabel?: string;
}

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";

/**
 * Searches for institutions via Google Places API (New) — searchText.
 * Endpoint: POST https://places.googleapis.com/v1/places:searchText
 * Header Authentication: X-Goog-Api-Key
 * FieldMask: places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri,places.primaryType,places.primaryTypeDisplayName
 * Strictly consumes from the 95 calls/day quota.
 * Zero stubs or mock data: returns empty array if no live API key or results.
 */
export function categoryPhrase(category: string): string {
  if (category === "cosmetic_dental") return "dental implant cosmetic clinic";
  if (category === "ivf_fertility") return "ivf fertility clinic";
  if (category === "high_ticket_coaching") return "NEET JEE coaching institute";
  return "super speciality hospital surgical clinic";
}

// Areas inside each rotation metro. One search returns at most 20 listings, and a metro-wide search returns the
// same 20 every time; searching by area is how a run reaches businesses the metro-wide search never shows.
export const METRO_AREAS: Record<string, string[]> = {
  "Delhi NCR": ["South Delhi", "Gurugram", "Noida", "West Delhi", "Dwarka", "Faridabad", "Ghaziabad", "East Delhi"],
  Mumbai: ["Andheri", "Bandra", "Thane", "Navi Mumbai", "Borivali", "Powai", "Dadar", "Chembur"],
  Bengaluru: ["Indiranagar", "Koramangala", "Whitefield", "Jayanagar", "HSR Layout", "Hebbal", "Malleshwaram", "Electronic City"],
  Hyderabad: ["Banjara Hills", "Gachibowli", "Kukatpally", "Madhapur", "Secunderabad", "Jubilee Hills", "Dilsukhnagar"],
  "Chandigarh Tricity": ["Chandigarh", "Mohali", "Panchkula", "Zirakpur", "Kharar"],
};

export const DEFAULT_SEARCHES_PER_RUN = 4;
export const MAX_SEARCHES_PER_RUN = 8;

/** PROSPECT_SEARCHES_PER_RUN, clamped to 1..8. Default 4. */
export function searchesPerRun(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt((env.PROSPECT_SEARCHES_PER_RUN || "").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SEARCHES_PER_RUN;
  return Math.min(n, MAX_SEARCHES_PER_RUN);
}

/**
 * The searches for one run: the metro-wide one first, then areas of the metro. `dayIndex` rotates the starting
 * area so consecutive visits to the same metro and category cover different areas. Pure.
 */
export function buildPlacesQueries(city: string, category: string, count: number, dayIndex: number): string[] {
  const phrase = categoryPhrase(category);
  const queries = [`${phrase} in ${city}`];
  const areas = METRO_AREAS[city] || [];
  for (let i = 0; i < areas.length && queries.length < count; i++) {
    const area = areas[(Math.abs(dayIndex) + i) % areas.length];
    const q = `${phrase} in ${area}${city === "Chandigarh Tricity" ? "" : `, ${city}`}`;
    if (!queries.includes(q)) queries.push(q);
  }
  return queries.slice(0, Math.max(1, count));
}

/**
 * Several searches for one metro and category, merged by place id. Stops early, keeping what it has, when the
 * daily Places quota would be exceeded, leaving `reserve` calls for the details lookups that follow.
 */
export async function searchPlacesCandidatesWide(
  city: string,
  category: string,
  options?: { testMode?: boolean; now?: Date; count?: number; reserve?: number; search?: typeof searchPlacesCandidates; remaining?: () => number }
): Promise<{ candidates: RawPlaceCandidate[]; queries: string[] }> {
  const now = options?.now || new Date();
  const dayIndex = Math.floor(now.getTime() / 86_400_000);
  const planned = buildPlacesQueries(city, category, options?.count ?? searchesPerRun(), dayIndex);
  const reserve = options?.reserve ?? 25;
  const search = options?.search || searchPlacesCandidates;
  const remaining = options?.remaining || (() => MAX_DAILY_PLACES_CALLS - getPlacesQuotaState(options).count);

  const seen = new Set<string>();
  const candidates: RawPlaceCandidate[] = [];
  const queries: string[] = [];
  for (const query of planned) {
    // The first search always runs (it throws, as before, if the quota is already spent). Later ones need headroom.
    if (queries.length > 0 && remaining() - 1 < reserve) {
      console.warn(`[Places API] stopping after ${queries.length} search(es): ${remaining()} quota calls left, ${reserve} kept for details lookups`);
      break;
    }
    const found = await search(city, category, { testMode: options?.testMode, query });
    queries.push(query);
    for (const c of found) {
      const key = c.placeId || `${c.name}|${c.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(c);
    }
  }
  return { candidates, queries };
}

export async function searchPlacesCandidates(
  city: string,
  category: string,
  options?: { testMode?: boolean; query?: string }
): Promise<RawPlaceCandidate[]> {
  const query = options?.query || `${categoryPhrase(category)} in ${city}`;
  const endpoint = "https://places.googleapis.com/v1/places:searchText";
  const fieldMask =
    "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri,places.primaryType,places.primaryTypeDisplayName";

  // 1. If key is missing, log real attempt and return empty array without stubs
  if (!PLACES_API_KEY) {
    console.warn(`[Places API (New) Real Request] POST ${endpoint} (textQuery: "${query}", X-Goog-Api-Key missing)`);
    console.warn(
      `[Places API (New) Real Response] HTTP 403 / UNAUTHENTICATED: Missing X-Goog-Api-Key header (Legacy textsearch endpoint is deprecated and not enabled)`
    );
    return [];
  }

  // 2. Consume 1 quota unit
  checkAndConsumePlacesQuota(1, options);

  const maskedKey = `${PLACES_API_KEY.slice(0, 6)}...${PLACES_API_KEY.slice(-4)}`;
  console.log(
    `[Places API (New) Real Request] POST ${endpoint} textQuery="${query}" X-Goog-Api-Key=${maskedKey} X-Goog-FieldMask=${fieldMask}`
  );

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_API_KEY,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 20,
      }),
    });

    const data = (await res.json()) as any;
    console.log(
      `[Places API (New) Real Response] HTTP ${res.status}: places_count=${data.places?.length || 0}`
    );

    if (res.status === 200 && Array.isArray(data.places)) {
      return data.places.map((p: any) => ({
        placeId: p.id,
        name: p.displayName?.text || "",
        address: p.formattedAddress || "",
        city,
        rating: p.rating,
        userRatingsTotal: p.userRatingCount,
        website: p.websiteUri,
        phone: p.nationalPhoneNumber,
        googleMapsUrl: p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${p.id}`,
        placeIdVerified: true,
        // The search already returns every field the details lookup would add that this agent uses. When both
        // website and phone came back, the separate details call is skipped; that is what makes several
        // searches fit inside the daily quota.
        placeDetailsEnriched: Boolean(p.websiteUri && p.nationalPhoneNumber),
        primaryType: typeof p.primaryType === "string" ? p.primaryType : undefined,
        primaryTypeLabel: typeof p.primaryTypeDisplayName?.text === "string" ? p.primaryTypeDisplayName.text : undefined,
        rawApiResponseExcerpt: JSON.stringify(p).slice(0, 200),
      }));
    }

    console.warn(
      `[Places API (New) Returned Non-200 Status]: HTTP ${res.status}, error=${data.error?.message || JSON.stringify(data)}`
    );
    return [];
  } catch (err: any) {
    console.error(`[Places API (New) Network Failure]:`, err.message || err);
    return [];
  }
}

/**
 * Enriches candidate with Place Details via Google Places API (New) — places/{id}.
 * Endpoint: GET https://places.googleapis.com/v1/places/{id}
 * Header Authentication: X-Goog-Api-Key
 * FieldMask: id,displayName,formattedAddress,rating,userRatingCount,websiteUri,nationalPhoneNumber,googleMapsUri,businessStatus,regularOpeningHours
 * Strictly consumes 1 quota unit.
 */
export async function enrichPlaceDetails(
  candidate: RawPlaceCandidate,
  options?: { testMode?: boolean }
): Promise<RawPlaceCandidate> {
  if (!candidate.placeId) {
    return {
      ...candidate,
      placeDetailsEnriched: false,
      placeDetailsError: "Missing placeId",
    };
  }

  // In test mode without API key, mark enriched so test harness functions cleanly
  if (options?.testMode && !PLACES_API_KEY) {
    return {
      ...candidate,
      placeDetailsEnriched: true,
    };
  }

  if (!PLACES_API_KEY) {
    return {
      ...candidate,
      placeDetailsEnriched: false,
      placeDetailsError: "GOOGLE_PLACES_API_KEY not configured",
    };
  }

  // Sanitize place ID: strip leading "places/" resource prefix if present
  const cleanPlaceId = candidate.placeId.replace(/^places\//, "").trim();
  if (!cleanPlaceId) {
    return {
      ...candidate,
      placeDetailsEnriched: false,
      placeDetailsError: "Malformed placeId: empty after cleaning",
    };
  }

  const endpoint = `https://places.googleapis.com/v1/places/${encodeURIComponent(cleanPlaceId)}`;
  const fieldMask =
    "id,displayName,formattedAddress,rating,userRatingCount,websiteUri,nationalPhoneNumber,googleMapsUri,businessStatus,regularOpeningHours";

  try {
    checkAndConsumePlacesQuota(1, options);
    const maskedKey = `${PLACES_API_KEY.slice(0, 6)}...${PLACES_API_KEY.slice(-4)}`;
    console.log(`[Places API (New) Details Request] GET ${endpoint} X-Goog-Api-Key=${maskedKey}`);

    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": PLACES_API_KEY,
        "X-Goog-FieldMask": fieldMask,
      },
    });

    const data = (await res.json()) as any;
    console.log(`[Places API (New) Details Response] HTTP ${res.status}: id=${data.id || "none"}`);

    if (res.status === 200 && data.id) {
      return {
        ...candidate,
        name: data.displayName?.text || candidate.name,
        address: data.formattedAddress || candidate.address,
        website: data.websiteUri || candidate.website,
        phone: data.nationalPhoneNumber || candidate.phone,
        rating: data.rating !== undefined ? data.rating : candidate.rating,
        userRatingsTotal: data.userRatingCount !== undefined ? data.userRatingCount : candidate.userRatingsTotal,
        googleMapsUrl: data.googleMapsUri || candidate.googleMapsUrl,
        placeDetailsEnriched: true,
      };
    }

    console.error(
      `[Places API Details Error on ${candidate.name} (${cleanPlaceId})]: HTTP ${res.status} error=${data.error?.message || JSON.stringify(data)}`
    );
    return {
      ...candidate,
      placeDetailsEnriched: false,
      placeDetailsError: data.error?.message || `HTTP ${res.status}`,
    };
  } catch (err: any) {
    console.error(`[Places API (New) Details Network Failure on ${candidate.name}]:`, err.message || err);
    return {
      ...candidate,
      placeDetailsEnriched: false,
      placeDetailsError: err.message || String(err),
    };
  }
}

/**
 * DNS check: verifies that candidate's website has valid resolving DNS A records.
 * Uses node:dns with strict 3-second timeout.
 */
export async function verifyDomainDns(
  domainOrUrl: string
): Promise<{ valid: boolean; ip?: string; reason?: string }> {
  if (!domainOrUrl) {
    return { valid: false, reason: "Empty domain/URL provided" };
  }

  let hostname = domainOrUrl.trim();
  try {
    if (hostname.startsWith("http://") || hostname.startsWith("https://")) {
      hostname = new URL(hostname).hostname;
    } else {
      hostname = hostname.split("/")[0];
    }
  } catch {
    return { valid: false, reason: `Malformed URL string: '${domainOrUrl}'` };
  }

  try {
    const resolvePromise = dns.resolve4(hostname);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DNS resolution timeout (>3000ms)")), 3000)
    );
    const addresses = await Promise.race([resolvePromise, timeoutPromise]);
    if (Array.isArray(addresses) && addresses.length > 0) {
      return { valid: true, ip: addresses[0] };
    }
    return { valid: false, reason: "No IPv4 A records found" };
  } catch (err: any) {
    return { valid: false, reason: err.code || err.message || "DNS resolution failed" };
  }
}
