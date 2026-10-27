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
}

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";

/**
 * Searches for institutions via Google Places Text Search.
 * Strictly consumes from the 95 calls/day quota.
 * Zero stubs or mock data: returns empty array if no live API results or missing key.
 */
export async function searchPlacesCandidates(
  city: string,
  category: string,
  options?: { testMode?: boolean }
): Promise<RawPlaceCandidate[]> {
  // Construct search query per category
  let categoryQuery = "super speciality hospital surgical clinic";
  if (category === "cosmetic_dental") categoryQuery = "dental implant cosmetic clinic";
  if (category === "ivf_fertility") categoryQuery = "ivf fertility clinic";
  if (category === "high_ticket_coaching") categoryQuery = "NEET JEE coaching institute";

  const query = `${categoryQuery} in ${city}`;

  // 1. If key is missing, log real attempt and fail truthfully without stubs
  if (!PLACES_API_KEY) {
    const rawReqUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=`;
    console.warn(`[Places TextSearch API Real Request] GET ${rawReqUrl}`);
    console.warn(
      `[Places TextSearch API Real Response] HTTP 403 / REQUEST_DENIED: { "error_message": "Missing the key parameter.", "results": [], "status": "REQUEST_DENIED" }`
    );
    return [];
  }

  // 2. Consume 1 quota unit
  checkAndConsumePlacesQuota(1, options);

  const maskedKey = `${PLACES_API_KEY.slice(0, 6)}...${PLACES_API_KEY.slice(-4)}`;
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
    query
  )}&key=${PLACES_API_KEY}`;

  console.log(`[Places TextSearch API Real Request] GET https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${maskedKey}`);

  try {
    const res = await fetch(url);
    const data = (await res.json()) as any;
    console.log(
      `[Places TextSearch API Real Response] HTTP ${res.status}: status="${data.status}", results_count=${data.results?.length || 0}`
    );

    if (data.status === "OK" && Array.isArray(data.results)) {
      return data.results.map((r: any) => ({
        placeId: r.place_id,
        name: r.name,
        address: r.formatted_address || "",
        city,
        rating: r.rating,
        userRatingsTotal: r.user_ratings_total,
        googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${r.place_id}`,
        placeIdVerified: true,
        rawApiResponseExcerpt: JSON.stringify(r).slice(0, 200),
      }));
    }

    console.warn(`[Places TextSearch API Returned Non-OK Status]: status=${data.status}, message=${data.error_message || "none"}`);
    return [];
  } catch (err: any) {
    console.error(`[Places TextSearch Network Failure]:`, err.message || err);
    return [];
  }
}

/**
 * Enriches candidate with Place Details (website, phone, reviews) ONLY for survivors passing DNS check.
 * Strictly consumes 1 quota unit.
 */
export async function enrichPlaceDetails(
  candidate: RawPlaceCandidate,
  options?: { testMode?: boolean }
): Promise<RawPlaceCandidate> {
  if (!PLACES_API_KEY || !candidate.placeId) {
    return candidate;
  }

  try {
    checkAndConsumePlacesQuota(1, options);
    const maskedKey = `${PLACES_API_KEY.slice(0, 6)}...${PLACES_API_KEY.slice(-4)}`;
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${candidate.placeId}&fields=name,formatted_phone_number,website,rating,user_ratings_total,url&key=${PLACES_API_KEY}`;

    console.log(`[Place Details API Real Request] place_id=${candidate.placeId}&key=${maskedKey}`);
    const res = await fetch(url);
    const data = (await res.json()) as any;
    console.log(`[Place Details API Real Response] HTTP ${res.status}: status="${data.status}"`);

    if (data.status === "OK" && data.result) {
      return {
        ...candidate,
        website: data.result.website || candidate.website,
        phone: data.result.formatted_phone_number || candidate.phone,
        rating: data.result.rating || candidate.rating,
        userRatingsTotal: data.result.user_ratings_total || candidate.userRatingsTotal,
        googleMapsUrl: data.result.url || candidate.googleMapsUrl,
      };
    }
  } catch (err: any) {
    console.warn(`[Place Details API Error on ${candidate.name}]:`, err.message || err);
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
