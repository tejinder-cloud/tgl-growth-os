// services/tgl-ops/src/agents/aeo-audit-engine/engines.ts
// One function per AI engine: ask a buyer's question exactly as written, with the provider's own web search on,
// and return the answer text, the sources it cited, token/search usage and the USD cost of the call.
// No extra instructions are added to the prompt — we record what the engine says, not what we nudge it to say.
// Models, prices and endpoints come from env (AGENTS.md: never hard-code a model or a price).
import type { AskOptions, EngineAnswer, EngineCitation, EngineConfig, EngineId } from "./types.js";

const ENV: Record<EngineId, { key: string[]; prefix: string; baseUrl: string }> = {
  chatgpt: { key: ["OPENAI_API_KEY"], prefix: "AEO_OPENAI", baseUrl: "https://api.openai.com/v1/responses" },
  gemini: { key: ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"], prefix: "AEO_GEMINI", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  perplexity: { key: ["PERPLEXITY_API_KEY"], prefix: "AEO_PERPLEXITY", baseUrl: "https://api.perplexity.ai/v1/sonar" },
};

/** Reads an engine's settings. Returns the list of missing variables instead of guessing defaults. */
export function loadEngineConfig(engine: EngineId, env: NodeJS.ProcessEnv = process.env): { config?: EngineConfig; missing: string[] } {
  const spec = ENV[engine];
  const missing: string[] = [];
  const apiKey = spec.key.map((k) => env[k]?.trim()).find(Boolean) || "";
  if (!apiKey) missing.push(spec.key[0]);
  const read = (name: string) => {
    const v = env[`${spec.prefix}_${name}`]?.trim();
    if (!v) missing.push(`${spec.prefix}_${name}`);
    return v || "";
  };
  const num = (name: string) => {
    const v = read(name);
    if (v && isNaN(Number(v))) missing.push(`${spec.prefix}_${name} (not a number)`);
    return Number(v);
  };
  const model = read("MODEL");
  const priceIn = num("PRICE_IN");
  const priceOut = num("PRICE_OUT");
  const search = num("SEARCH_PRICE_PER_1K");
  if (missing.length) return { missing };
  return {
    missing,
    config: {
      engine, apiKey, model,
      priceInPerMTok: priceIn, priceOutPerMTok: priceOut, searchPricePer1k: search,
      baseUrl: env[`${spec.prefix}_URL`]?.trim() || spec.baseUrl,
    },
  };
}

export function computeCostUsd(cfg: Pick<EngineConfig, "priceInPerMTok" | "priceOutPerMTok" | "searchPricePer1k">, u: { inputTokens: number; outputTokens: number; searches: number }): number {
  const usd = (u.inputTokens / 1e6) * cfg.priceInPerMTok + (u.outputTokens / 1e6) * cfg.priceOutPerMTok + (u.searches / 1000) * cfg.searchPricePer1k;
  return Number(usd.toFixed(6));
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, opts: AskOptions): Promise<any> {
  const f = opts.fetchImpl ?? fetch;
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
    try {
      const res = await f(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < 3) {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function dedupeCitations(list: EngineCitation[]): EngineCitation[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    if (!c.url || seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

// ── ChatGPT: OpenAI Responses API + web_search tool ──────────────────────────
export function parseOpenAI(json: any): { text: string; citations: EngineCitation[]; usage: EngineAnswer["usage"] } {
  const out: any[] = Array.isArray(json?.output) ? json.output : [];
  const parts: string[] = [];
  const cites: EngineCitation[] = [];
  let searches = 0;
  for (const item of out) {
    if (item?.type === "web_search_call") searches++;
    if (item?.type === "message") {
      for (const c of item.content ?? []) {
        if (c?.type === "output_text") {
          parts.push(String(c.text ?? ""));
          for (const a of c.annotations ?? []) if (a?.type === "url_citation" && a.url) cites.push({ url: a.url, title: a.title });
        }
      }
    }
  }
  return {
    text: parts.join("\n").trim(),
    citations: dedupeCitations(cites),
    usage: { inputTokens: json?.usage?.input_tokens ?? 0, outputTokens: json?.usage?.output_tokens ?? 0, searches },
  };
}

async function askOpenAI(cfg: EngineConfig, prompt: string, opts: AskOptions): Promise<EngineAnswer> {
  const tool: Record<string, unknown> = { type: "web_search" };
  if (opts.country) tool.user_location = { type: "approximate", country: opts.country, ...(opts.city ? { city: opts.city } : {}) };
  const json = await postJson(cfg.baseUrl, { authorization: `Bearer ${cfg.apiKey}` }, { model: cfg.model, input: prompt, tools: [tool] }, opts);
  const p = parseOpenAI(json);
  return { engine: "chatgpt", model: cfg.model, ...p, costUsd: computeCostUsd(cfg, p.usage), costSource: "computed", raw: json };
}

// ── Gemini: generateContent + Grounding with Google Search ───────────────────
export function parseGemini(json: any): { text: string; citations: EngineCitation[]; usage: EngineAnswer["usage"] } {
  const cand = json?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("").trim();
  const gm = cand?.groundingMetadata ?? {};
  const cites: EngineCitation[] = (gm.groundingChunks ?? [])
    .map((ch: any) => ch?.web)
    .filter((w: any) => w?.uri)
    // Gemini returns redirect URLs; the title is usually the source domain, which we keep as a hint.
    .map((w: any) => ({ url: w.uri, title: w.title, domainHint: typeof w.title === "string" && /\.[a-z]{2,}$/i.test(w.title) ? w.title : undefined }));
  const um = json?.usageMetadata ?? {};
  return {
    text,
    citations: dedupeCitations(cites),
    usage: {
      inputTokens: um.promptTokenCount ?? 0,
      outputTokens: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
      searches: Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries.length : 0,
    },
  };
}

async function askGemini(cfg: EngineConfig, prompt: string, opts: AskOptions): Promise<EngineAnswer> {
  const url = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const json = await postJson(url, { "x-goog-api-key": cfg.apiKey }, { contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }, opts);
  const p = parseGemini(json);
  // Free monthly grounding allowance is ignored on purpose: cost is an upper bound, never an understatement.
  return { engine: "gemini", model: cfg.model, ...p, costUsd: computeCostUsd(cfg, p.usage), costSource: "computed", raw: json };
}

// ── Perplexity: Sonar ────────────────────────────────────────────────────────
export function parsePerplexity(json: any): { text: string; citations: EngineCitation[]; usage: EngineAnswer["usage"]; providerCostUsd: number | null } {
  const text = String(json?.choices?.[0]?.message?.content ?? "").trim();
  const sr: any[] = Array.isArray(json?.search_results) ? json.search_results : [];
  const cites: EngineCitation[] = sr.length
    ? sr.filter((r) => r?.url).map((r) => ({ url: r.url, title: r.title }))
    : (Array.isArray(json?.citations) ? json.citations : []).filter((u: any) => typeof u === "string").map((u: string) => ({ url: u }));
  const cost = json?.usage?.cost?.total_cost;
  return {
    text,
    citations: dedupeCitations(cites),
    usage: { inputTokens: json?.usage?.prompt_tokens ?? 0, outputTokens: json?.usage?.completion_tokens ?? 0, searches: 1 },
    providerCostUsd: typeof cost === "number" && isFinite(cost) ? cost : null,
  };
}

async function askPerplexity(cfg: EngineConfig, prompt: string, opts: AskOptions): Promise<EngineAnswer> {
  const json = await postJson(cfg.baseUrl, { authorization: `Bearer ${cfg.apiKey}` }, { model: cfg.model, messages: [{ role: "user", content: prompt }] }, opts);
  const p = parsePerplexity(json);
  const provider = p.providerCostUsd;
  return {
    engine: "perplexity", model: cfg.model, text: p.text, citations: p.citations, usage: p.usage,
    costUsd: provider ?? computeCostUsd(cfg, p.usage), costSource: provider != null ? "provider" : "computed", raw: json,
  };
}

export async function askEngine(cfg: EngineConfig, prompt: string, opts: AskOptions = {}): Promise<EngineAnswer> {
  switch (cfg.engine) {
    case "chatgpt": return askOpenAI(cfg, prompt, opts);
    case "gemini": return askGemini(cfg, prompt, opts);
    case "perplexity": return askPerplexity(cfg, prompt, opts);
  }
}
