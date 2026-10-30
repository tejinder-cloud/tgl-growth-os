// services/tgl-ops/src/agents/prospect-researcher/types.ts

export type ProspectDoor = "aeo" | "truelead" | "ai";
export type ProspectStatus = "new" | "reviewed" | "rejected" | "handed_to_outreach";

export interface DecisionMaker {
  name: string;
  role: string;
  email: string;
  phone?: string;
  source: string;
}

export interface ProspectSignals {
  meta_ads_active: boolean;
  meta_ad_count: number;
  gbp_reviews: number;
  gbp_owner_replies: boolean;
  hiring_marketing: boolean;
  review_surge: boolean;
  branch_count: number;
  ad_library_url?: string;
  chain_evidence?: string[];
  places_brand_count?: number;
  is_large_org?: boolean;
  brand_prefix?: string;
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
