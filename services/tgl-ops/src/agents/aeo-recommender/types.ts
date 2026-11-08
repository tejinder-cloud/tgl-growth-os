// Recommendations (plan Day 22). Code gathers evidence from stored runs and computes every number;
// the model proposes actions and drafts assets, referring to evidence only by id (P1…, S1…).
import type { SiteSnapshot } from "../aeo-strategist/types.js";

export type PromptEvidence = {
  ref: string; id: string; text: string; language: string; stage: string; branded: boolean;
  enginesAsked: string[]; enginesNamed: string[]; competitorsNamed: string[]; excerpt: string | null;
};
export type SiteEvidence = {
  ref: string; domain: string; channelType: string | null; answers: number; withoutYou: number; namedYou: number;
  competitorNotYou: number; competitors: string[]; urls: string[];
};
export type RecEvidence = {
  brandId: string; tenantId: string; name: string; domain: string | null; platform: string | null; languages: string[];
  market: { product: string; icp: string; location: string } | null; competitors: string[];
  from: string; to: string; totalAnswers: number; namedAnswers: number;
  prompts: PromptEvidence[]; sites: SiteEvidence[]; ownCited: number; site: SiteSnapshot | null;
};

export const ASSET_KINDS = ["page_draft", "faq_block", "json_ld", "llms_txt", "meta", "gbp_edits", "directory_list", "thread_list", "change_pack"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const CATEGORIES = ["offsite", "onsite", "content", "technical"] as const;

export type Recommendation = {
  title: string; body: string; category: (typeof CATEGORIES)[number]; impact: number; ease: number;
  promptRefs: string[]; siteRefs: string[];
  asset: { kind: AssetKind; title: string; format: "markdown" | "json" | "text"; content: string; publishAs?: "page" | "post" };
  evidence: Record<string, unknown>;   // computed by code from the refs
};
