// services/tgl-ops/src/agents/prospect-researcher/types.ts

export type ProspectDoor = "aeo" | "truelead" | "ai";
// "nurture" and "bench" are the Playbook F hold states (score 50 to below the qualified threshold).
export type ProspectStatus = "new" | "reviewed" | "rejected" | "handed_to_outreach" | "nurture" | "bench";

export interface DecisionMaker {
  name: string;
  role: string;
  email: string;
  phone?: string;
  source: string;
  /** False when no contact route passed the work-contact rules (contact-rules.ts). Absent on rows written before #184. */
  verified?: boolean;
}

export interface ProspectSignals {
  meta_ads_active: boolean;
  meta_ad_count: number;
  gbp_reviews: number;
  gbp_owner_replies: boolean;
  /** Retired from scoring under rubric v2 (hiring criterion removed). Kept so stored v1 rows still parse. */
  hiring_marketing: boolean;
  /** Retired from scoring under rubric v2 (v1 Dimension 4 scale signal). Kept so stored v1 rows still parse. */
  review_surge: boolean;
  branch_count: number;
  ad_library_url?: string;
  /** Rubric v2 Dimension 2: Google Ads observed for the prospect. */
  google_ads_active?: boolean;
  /** Rubric v2 Dimension 2: paid directory listings observed (e.g. "Practo", "Justdial", "MakeMyTrip"). */
  paid_directory_listings?: string[];
  /** Rubric v2 Dimension 2: website rebuilt in the last 12 months. */
  site_rebuilt_last_12m?: boolean;
  chain_evidence?: string[];
  places_brand_count?: number;
  is_large_org?: boolean;
  brand_prefix?: string;
  root_domain_hosts_other_branches?: boolean;
  registered_hq_metro?: string;
  /** Google Places primary type ("dental_clinic") and its display name, used to phrase the Dimension 4 question. */
  place_primary_type?: string;
  place_primary_type_label?: string;
  raw_signals?: Record<string, any>;
}

export interface ProspectRecord {
  id?: string;
  tenant_id: string; // Always 'tgl'
  company: string;
  category: string;
  city: string;
  website: string;
  door: ProspectDoor;
  fit_score: number; // 0–100
  fit_reasons: string[];
  decision_maker: DecisionMaker;
  signals: ProspectSignals;
  status: ProspectStatus;
  source_refs: string[];
  created_at: string;
  rescored_at: string;
  deleted_at?: string | null;
}

/** A city name from targets.ts CITIES. */
export type RotationCity = string;

/** An industry key from targets.ts INDUSTRIES. */
export type RotationCategory = string;

export interface RotationState {
  version: number;
  /** v1 only: index into the old 5-metro list. Kept so an old state file still parses. */
  currentCityIndex: number;
  /** Next industry in targets.ts INDUSTRIES. */
  currentCategoryIndex: number;
  completedRunsCount: number;
  lastRunAt: string;
  /** v2: position in TIER_PATTERN. */
  tierStep?: number;
  /** v2: next city per tier. */
  cityIndexByTier?: { "1": number; "2": number; "3": number };
}

export interface ResearchRunOptions {
  city?: RotationCity | string;
  category?: RotationCategory | string;
  targetCount?: number;
  testMode?: boolean;
  postToSlack?: boolean;
  /** Skip this run's own review card; the caller posts one daily card for all runs (24 Nov 2026). */
  dailyCard?: boolean;
}

export interface ResearchRunResult {
  city: string;
  category: string;
  discoveredCount: number;
  qualifiedCount: number;
  /** Candidates scored 50 to below the qualified threshold this run and saved with status "bench". Not part of `prospects`. */
  benchedCount?: number;
  dedupedCount: number;
  prospects: ProspectRecord[];
  placesCallsUsed: number;
  playwrightSearches: number;
  tokens: {
    input: number;
    output: number;
    costUsd: number;
  };
  cardTs?: string;
  csvPath?: string;
  /** Rows saved and read back this run. */
  savedCount?: number;
  /** The rows a review card lists for this run (empty when nothing was saved). */
  cardRows?: ProspectRecord[];
  rejectionPatternProposal?: string;
  standupLines: {
    did: string;
    blocked: string;
    need: string;
    tomorrow: string;
  };
}
