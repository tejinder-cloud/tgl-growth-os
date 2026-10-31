// services/tgl-ops/src/agents/aeo-strategist/types.ts — Setup-verification queue (plan Day 19)

export type Journey = "awareness" | "consideration" | "decision";

/** Everything a reviewer needs to judge one brand's setup, as the customer entered it. */
export interface SetupSnapshot {
  brandId: string;
  tenantId: string;
  tenantName: string;
  name: string;
  domain: string | null;
  platform: string | null;
  languages: string[];
  variants: string[];
  market: { id: string; product: string; icp: string; location: string } | null;
  competitors: { id: string; name: string; domain: string | null }[];
  prompts: { id: string; text: string; language: string; journey_phase: Journey }[];
  plan: string;           // trial | internal | truevisible | …
  promptLimit: number;
  submittedAt: string;    // brands.updated_at
}

export interface SiteSnapshot {
  url: string;
  ok: boolean;
  title?: string;
  description?: string;
  headings: string[];
  text: string;           // visible text, truncated
  error?: string;
}

export interface Evidence {
  site: SiteSnapshot | null;
  /** One AI answer to "who leads this market here?" — the same kind of answer the tracker will record. */
  aiQuestion: string | null;
  aiAnswer: string | null;
  aiEngine: string | null;
  aiError?: string;
}

export interface Proposal {
  summary: string;
  market: { product?: string; icp?: string; location?: string; reason: string } | null;
  competitorsAdd: { name: string; domain: string | null; evidence: string }[];
  competitorsRemove: { id: string; name: string; reason: string }[];
  promptsRetire: { id: string; text: string; reason: string }[];
  promptsAdd: { text: string; language: string; journey_phase: Journey; reason: string }[];
  /** Suggestions the model made that failed validation (e.g. a competitor not found in the evidence). Shown, never applied. */
  dropped: string[];
}

/** A reviewer's selection, by option value: mk:0, ca:<i>, cr:<i>, pr:<i>, pa:<i>. */
export type Selection = Set<string>;
