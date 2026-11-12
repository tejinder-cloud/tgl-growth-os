// services/tgl-ops/src/agents/aeo-audit-engine/types.ts
// Shared by the Citation Tracker (daily runs, Day 17) and the audit PDFs (Day 8 / Day 9) — one engine, many uses.

export type EngineId = "chatgpt" | "gemini" | "perplexity" | "claude";
/** The engines every tracker run and every audit asks. */
export const API_ENGINES: EngineId[] = ["chatgpt", "gemini", "perplexity"];
/** Display names, in the order columns are shown. */
export const ENGINE_LABELS: Record<EngineId, string> = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", claude: "Claude" };

export interface EngineCitation {
  url: string;
  title?: string;
  /** Domain as reported by the provider when the URL is a redirect (Gemini grounding). */
  domainHint?: string;
}

export interface EngineUsage {
  inputTokens: number;
  outputTokens: number;
  /** Billable web searches the provider ran (billed per call / per 1k). */
  searches: number;
  /** Non-billable search-tool actions (ChatGPT open_page / find_in_page). */
  pageActions?: number;
  /** Searches covered by the provider's free allowance (Gemini grounding), already excluded from costUsd. */
  freeSearches?: number;
}

export interface EngineAnswer {
  engine: EngineId;
  model: string;
  text: string;
  citations: EngineCitation[];
  usage: EngineUsage;
  /** USD for this call. Provider-reported when available, else tokens × configured prices + search fees. */
  costUsd: number;
  costSource: "provider" | "computed";
  raw: unknown;
}

export interface EngineConfig {
  engine: EngineId;
  apiKey: string;
  model: string;
  priceInPerMTok: number;
  priceOutPerMTok: number;
  /** USD per 1,000 web searches / requests. */
  searchPricePer1k: number;
  baseUrl: string;
}

export interface AskOptions {
  /** ISO country code for search localisation where the provider supports it. */
  country?: string;
  city?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** What we know about a brand when reading an answer. */
export interface BrandLens {
  name: string;
  variants: string[];
  domains: string[];
  competitors: { name: string; domain: string | null }[];
}

export interface AnswerAnalysis {
  mentioned: boolean;
  /** 1 = first business named in the answer among brand + tracked competitors; null if brand absent. */
  position: number | null;
  competitorsMentioned: string[];
}

export type ChannelType = "owned" | "earned" | "social" | "directory" | "marketplace" | "news" | "reference" | "forum" | "video" | "other";

export interface CitationAnalysis {
  domain: string;
  url: string | null;
  channelType: ChannelType | null;
  /** true when the cited page is on the brand's own domain; null when unknown (we don't fetch the page). */
  brandMentioned: boolean | null;
  competitorsMentioned: string[];
}
