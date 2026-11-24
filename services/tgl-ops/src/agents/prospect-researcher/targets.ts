// services/tgl-ops/src/agents/prospect-researcher/targets.ts
// Who the prospect researcher looks for, and where (Architect decision, 24 Nov 2026).
// To add an industry: add one entry to INDUSTRIES. To add a city: add it to the right tier.
// The rotation picks tiers in the pattern 1, 2, 1, 2, 3 (40% Tier 1, 40% Tier 2, 20% Tier 3) and moves to the
// next industry on every run, so each tier sees every industry over time.

export interface Industry {
  /** Stored as prospects.category; also used by the rubric, the AI probe and the outreach wording. */
  key: string;
  /** What is typed into Google Maps, before " in <city>". */
  searchPhrase: string;
}

export const INDUSTRIES: Industry[] = [
  { key: "hospitals", searchPhrase: "super speciality hospital surgical clinic" },
  { key: "cosmetic_dental", searchPhrase: "dental implant cosmetic clinic" },
  { key: "ivf_fertility", searchPhrase: "ivf fertility clinic" },
  { key: "high_ticket_coaching", searchPhrase: "NEET JEE coaching institute" },
  { key: "hotels", searchPhrase: "boutique hotel" },
  { key: "real_estate", searchPhrase: "real estate developer builder" },
];

export type Tier = 1 | 2 | 3;

export interface CityTarget {
  name: string;
  tier: Tier;
  /** Areas searched after the city-wide search, so repeat visits reach businesses the first search never shows. */
  areas?: string[];
}

export const CITIES: CityTarget[] = [
  // Tier 1
  { name: "Delhi NCR", tier: 1, areas: ["South Delhi", "Gurugram", "Noida", "West Delhi", "Dwarka", "Faridabad", "Ghaziabad", "East Delhi"] },
  { name: "Mumbai", tier: 1, areas: ["Andheri", "Bandra", "Thane", "Navi Mumbai", "Borivali", "Powai", "Dadar", "Chembur"] },
  { name: "Bengaluru", tier: 1, areas: ["Indiranagar", "Koramangala", "Whitefield", "Jayanagar", "HSR Layout", "Hebbal", "Malleshwaram", "Electronic City"] },
  { name: "Hyderabad", tier: 1, areas: ["Banjara Hills", "Gachibowli", "Kukatpally", "Madhapur", "Secunderabad", "Jubilee Hills", "Dilsukhnagar"] },
  { name: "Pune", tier: 1, areas: ["Kothrud", "Baner", "Viman Nagar", "Hadapsar", "Wakad", "Shivaji Nagar"] },
  { name: "Chennai", tier: 1, areas: ["Anna Nagar", "T Nagar", "Adyar", "Velachery", "OMR", "Porur"] },
  { name: "Ahmedabad", tier: 1, areas: ["Satellite", "Navrangpura", "Bodakdev", "Maninagar", "SG Highway"] },
  { name: "Kolkata", tier: 1, areas: ["Salt Lake", "Park Street", "Ballygunge", "New Town", "Howrah"] },
  // Tier 2
  { name: "Chandigarh Tricity", tier: 2, areas: ["Chandigarh", "Mohali", "Panchkula", "Zirakpur", "Kharar"] },
  { name: "Ludhiana", tier: 2 },
  { name: "Jaipur", tier: 2 },
  { name: "Lucknow", tier: 2 },
  { name: "Indore", tier: 2 },
  { name: "Kochi", tier: 2 },
  { name: "Nagpur", tier: 2 },
  { name: "Coimbatore", tier: 2 },
  { name: "Surat", tier: 2 },
  { name: "Dehradun", tier: 2 },
  // Tier 3
  { name: "Patiala", tier: 3 },
  { name: "Amritsar", tier: 3 },
  { name: "Jalandhar", tier: 3 },
  { name: "Bathinda", tier: 3 },
  { name: "Ambala", tier: 3 },
  { name: "Karnal", tier: 3 },
  { name: "Hisar", tier: 3 },
  { name: "Shimla", tier: 3 },
];

/** 2 of 5 runs Tier 1, 2 of 5 Tier 2, 1 of 5 Tier 3. */
export const TIER_PATTERN: Tier[] = [1, 2, 1, 2, 3];

export function citiesInTier(tier: Tier): CityTarget[] {
  return CITIES.filter((c) => c.tier === tier);
}

export function findIndustry(key: string): Industry | undefined {
  const k = (key || "").trim().toLowerCase();
  return INDUSTRIES.find((i) => i.key === k);
}

export function findCity(name: string): CityTarget | undefined {
  const n = (name || "").trim().toLowerCase();
  return CITIES.find((c) => c.name.toLowerCase() === n);
}

/** Every city and area name, for code that needs to recognise place words (for example in competitor names). */
export function allPlaceNames(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of CITIES) out[c.name] = c.areas || [];
  return out;
}

export const DEFAULT_RUNS_PER_DAY = 3;
export const MAX_RUNS_PER_DAY = 6;

/** PROSPECT_RUNS_PER_DAY, clamped to 1..6. Default 3. */
export function runsPerDay(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt((env.PROSPECT_RUNS_PER_DAY || "").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RUNS_PER_DAY;
  return Math.min(n, MAX_RUNS_PER_DAY);
}
