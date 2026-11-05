// GA4 Impact sync (plan Day 24): once a day, for each connected brand, read visits whose session source is an AI
// assistant and store daily counts in public.ga4_daily. Read-only Google scope; token from Supabase Vault.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTestMode } from "../../config.js";
import { postLine } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import { getSupabase } from "../prospect-researcher/db.js";

/** Session sources that are AI assistants → engine id. Order matters (first match wins). */
const SOURCES: [RegExp, string][] = [
  [/(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com)$/i, "chatgpt"],
  [/(^|\.)(gemini\.google\.com|bard\.google\.com)$/i, "gemini"],
  [/(^|\.)perplexity\.ai$/i, "perplexity"],
  [/(^|\.)(copilot\.microsoft\.com|copilot\.cloud\.microsoft)$/i, "copilot"],
  [/(^|\.)claude\.ai$/i, "claude"],
  [/(^|\.)(you\.com|phind\.com|meta\.ai|deepseek\.com|chat\.deepseek\.com|grok\.com|x\.ai|poe\.com|mistral\.ai|chat\.mistral\.ai)$/i, "other_ai"],
];
export const SOURCE_REGEX = ".*(chatgpt\\.com|openai\\.com|gemini\\.google\\.com|bard\\.google\\.com|perplexity\\.ai|copilot\\.microsoft\\.com|copilot\\.cloud\\.microsoft|claude\\.ai|you\\.com|phind\\.com|meta\\.ai|deepseek\\.com|grok\\.com|x\\.ai|poe\\.com|mistral\\.ai).*";

export function engineForSource(source: string): string | null {
  const host = source.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  for (const [re, e] of SOURCES) if (re.test(host)) return e;
  return null;
}

/** GA4 runReport rows → ga4_daily rows (pure; tested). */
export function parseReport(json: any): { date: string; source: string; engine: string; sessions: number; engaged_sessions: number; key_events: number }[] {
  const out = [];
  for (const r of json?.rows ?? []) {
    const [d, source] = (r.dimensionValues ?? []).map((x: any) => String(x?.value ?? ""));
    const engine = engineForSource(source);
    if (!engine || !/^\d{8}$/.test(d)) continue;
    const [s, e, k] = (r.metricValues ?? []).map((x: any) => Number(x?.value ?? 0));
    out.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, source, engine, sessions: s || 0, engaged_sessions: e || 0, key_events: k || 0 });
  }
  return out;
}

async function accessToken(refresh: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refresh, client_id: process.env.GOOGLE_CLIENT_ID!.trim(), client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(), grant_type: "refresh_token" }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw Object.assign(new Error(`token refresh: ${j.error ?? res.status}`), { revoked: j.error === "invalid_grant" });
  return j.access_token;
}

export async function syncBrand(sb: SupabaseClient, i: { tenant_id: string; brand_id: string; config: any }, fetchImpl: typeof fetch = fetch): Promise<number> {
  const { data: refresh } = await sb.rpc("svc_ga4_refresh_token", { p_brand: i.brand_id });
  if (!refresh) throw Object.assign(new Error("no stored token"), { revoked: true });
  const token = await accessToken(String(refresh), fetchImpl);
  const { count } = await sb.from("ga4_daily").select("date", { count: "exact", head: true }).eq("brand_id", i.brand_id);
  const startDate = count ? "7daysAgo" : "90daysAgo";                 // first sync backfills 90 days; then GA4's late data settles within a week
  const res = await fetchImpl(`https://analyticsdata.googleapis.com/v1beta/${i.config.property_id}:runReport`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate: "yesterday" }],
      dimensions: [{ name: "date" }, { name: "sessionSource" }],
      metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }],
      dimensionFilter: { filter: { fieldName: "sessionSource", stringFilter: { matchType: "FULL_REGEXP", value: SOURCE_REGEX, caseSensitive: false } } },
      limit: 10000,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GA4 runReport HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const rows = parseReport(j).map((r) => ({ ...r, tenant_id: i.tenant_id, brand_id: i.brand_id, updated_at: new Date().toISOString() }));
  if (rows.length) {
    const { error } = await sb.from("ga4_daily").upsert(rows, { onConflict: "brand_id,date,source" });
    if (error) throw new Error(`save ga4_daily: ${error.message}`);
  }
  return rows.length;
}

/** Daily for everyone; every 15 minutes `onlyNew` picks up a just-connected property so numbers appear the same hour. */
export async function runGa4Sync(opts: { onlyNew?: boolean } = {}): Promise<void> {
  if (isTestMode() || !process.env.GOOGLE_CLIENT_ID?.trim() || !process.env.GOOGLE_CLIENT_SECRET?.trim()) return;
  const sb = getSupabase();
  if (!sb) return;
  const { data: list } = await sb.from("integrations").select("tenant_id, brand_id, config").eq("provider", "ga4").eq("status", "connected");
  for (const i of list ?? []) {
    if (opts.onlyNew) {
      if ((i as any).config?.last_sync_at) continue;
    }
    try {
      await syncBrand(sb, i as any);
      await sb.from("integrations").update({ config: { ...(i as any).config, last_sync_at: new Date().toISOString() } }).eq("brand_id", i.brand_id).eq("provider", "ga4");
    }
    catch (err: any) {
      if (err?.revoked) await sb.from("integrations").update({ status: "error" }).eq("brand_id", i.brand_id).eq("provider", "ga4");
      await postLine({ channel: getAlertsChannel(), text: `[Warning] *@aeo-audit-engine* GA4 sync failed for brand \`${i.brand_id}\`: \`${String(err?.message ?? err).slice(0, 300)}\`` }).catch(() => {});
    }
  }
}
