// services/tgl-ops/src/agents/aeo-strategist/evidence.ts
// What the reviewer's suggestions may rest on: the brand's own homepage and one live AI answer about the market.
import { askEngine, loadEngineConfig } from "../aeo-audit-engine/engines.js";
import type { Evidence, SetupSnapshot, SiteSnapshot } from "./types.js";

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");

export function extractSite(html: string, url: string): SiteSnapshot {
  const pick = (re: RegExp) => { const m = re.exec(html); return m ? decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : undefined; };
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ?? pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const headings: string[] = [];
  for (const m of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const h = decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (h && h.length < 160 && !headings.includes(h)) headings.push(h);
    if (headings.length >= 20) break;
  }
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim().slice(0, 3000);
  return { url, ok: true, title, description, headings, text };
}

export async function fetchSite(domain: string | null, fetchImpl: typeof fetch = fetch): Promise<SiteSnapshot | null> {
  if (!domain) return null;
  const url = `https://${domain}/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; TrueVisibleSetupCheck/1.0; +https://thegrowthlab.co.in)" } });
    if (!res.ok) return { url, ok: false, headings: [], text: "", error: `HTTP ${res.status}` };
    return extractSite((await res.text()).slice(0, 600_000), res.url || url);
  } catch (err: any) {
    return { url, ok: false, headings: [], text: "", error: String(err?.message ?? err).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** The discovery question. Deliberately neutral: no brand name, so the answer shows who AI names unprompted. */
export function marketQuestion(s: SetupSnapshot): string | null {
  if (!s.market) return null;
  return `Who are the best ${s.market.product} providers in ${s.market.location} for ${s.market.icp}? Name specific businesses and their websites.`;
}

export async function gatherEvidence(s: SetupSnapshot, opts: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): Promise<{ evidence: Evidence; aiCostUsd: number }> {
  const site = await fetchSite(s.domain, opts.fetchImpl);
  const q = marketQuestion(s);
  const ev: Evidence = { site, aiQuestion: q, aiAnswer: null, aiEngine: null };
  let aiCostUsd = 0;
  if (q) {
    // Perplexity is cheapest per answer (~$0.002 on 31 Oct) and reports its own cost.
    const { config } = loadEngineConfig("perplexity", opts.env);
    if (config) {
      try {
        const ans = await askEngine(config, q, { country: "IN", fetchImpl: opts.fetchImpl });
        ev.aiAnswer = ans.text.slice(0, 6000);
        ev.aiEngine = `perplexity (${ans.model})`;
        aiCostUsd = ans.costUsd;
      } catch (err: any) {
        ev.aiError = String(err?.message ?? err).slice(0, 200);
      }
    } else {
      ev.aiError = "Perplexity not configured";
    }
  }
  return { evidence: ev, aiCostUsd };
}

/** All text a suggested competitor must be found in. */
export function evidenceCorpus(ev: Evidence): string {
  return [ev.site?.title, ev.site?.description, ...(ev.site?.headings ?? []), ev.site?.text, ev.aiAnswer].filter(Boolean).join("\n");
}
