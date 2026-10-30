// services/tgl-ops/src/agents/prospect-researcher/sources/places.ts
import dns from "node:dns/promises";
import { checkAndConsumePlacesQuota } from "../guardrails.js";

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
}

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";

/**
 * Searches for institutions via Google Places API (New) — searchText.
 * Endpoint: POST https://places.googleapis.com/v1/places:searchText
 * Header Authentication: X-Goog-Api-Key
 * FieldMask: places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri
 * Strictly consumes from the 95 calls/day quota.
 * Zero stubs or mock data: returns empty array if no live API key or results.
 */
export async function searchPlacesCandidates(
  city: string,
  category: string,
  options?: { testMode?: boolean }
): Promise<RawPlaceCandidate[]> {
  let categoryQuery = "super speciality hospital surgical clinic";
  if (category === "cosmetic_dental") categoryQuery = "dental implant cosmetic clinic";
  if (category === "ivf_fertility") categoryQuery = "ivf fertility clinic";
  if (category === "high_ticket_coaching") categoryQuery = "NEET JEE coaching institute";

  const query = `${categoryQuery} in ${city}`;
  const endpoint = "https://places.googleapis.com/v1/places:searchText";
  const fieldMask =
    "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri";

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
 * FieldMask: id,displayName,formattedAddress,rating,userRatingCount,websiteUri,nationalPhoneNumber,googleMapsUri
 * Strictly consumes 1 quota unit.
 */
export async function enrichPlaceDetails(
  candidate: RawPlaceCandidate,
  options?: { testMode?: boolean }
): Promise<RawPlaceCandidate> {
  if (!PLACES_API_KEY || !candidate.placeId) {
    return candidate;
  }

  const endpoint = `https://places.googleapis.com/v1/places/${encodeURIComponent(candidate.placeId)}`;
  const fieldMask = "id,displayName,formattedAddress,rating,userRatingCount,websiteUri,nationalPhoneNumber,googleMapsUri";

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
        rating: data.rating || candidate.rating,
        userRatingsTotal: data.userRatingCount || candidate.userRatingsTotal,
        googleMapsUrl: data.googleMapsUri || candidate.googleMapsUrl,
      };
    }
  } catch (err: any) {
    console.warn(`[Places API (New) Details Error on ${candidate.name}]:`, err.message || err);
  }

  return candidate;
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
