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
  /**
   * Rubric v2 (issue #184): false when the email failed the Dimension 5 check (free-mail domain, generic local part,
   * or a domain that does not match the prospect's website root domain). Absent on rows stored before the check.
   */
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
  /** Issue #184: why is_large_org is true (category, name hint, review volume, or a real multi-branch signal). */
  is_large_org_reason?: string;
  /** Issue #184: set when a real multi-branch signal capped the fit score below the qualified threshold. */
  large_org_cap_reason?: string;
  brand_prefix?: string;
  /** Issue #184: Google Places primaryType of the prospect (e.g. "hospital", "maternity_hospital"). */
  primary_place_type?: string;
  /** Issue #184: Google Places primaryTypeDisplayName (e.g. "Maternity hospital"). */
  primary_place_type_label?: string;
  root_domain_hosts_other_branches?: boolean;
  registered_hq_metro?: string;
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

export type RotationCity =
  | "Delhi NCR"
  | "Mumbai"
  | "Bengaluru"
  | "Hyderabad"
  | "Chandigarh Tricity";

export type RotationCategory =
  | "hospitals"
  | "cosmetic_dental"
  | "ivf_fertility"
  | "high_ticket_coaching";

export interface RotationState {
  version: number;
  currentCityIndex: number;
  currentCategoryIndex: number;
  completedRunsCount: number;
  lastRunAt: string;
}

export interface ResearchRunOptions {
  city?: RotationCity | string;
  category?: RotationCategory | string;
  targetCount?: number;
  testMode?: boolean;
  postToSlack?: boolean;
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
  rejectionPatternProposal?: string;
  standupLines: {
    did: string;
    blocked: string;
    need: string;
    tomorrow: string;
  };
}
