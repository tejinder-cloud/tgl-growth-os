// Competitor intelligence (plan Day 30): every 30 minutes, verified brands with recent answers and no report in the
// last 30 days get one — who AI names instead of them (tracked and newly found), where each rival wins, which sites
// those answers cite, and a short "why AI picks them / what to do" per top rival. Shown on the Competitors tab.
import type { SupabaseClient } from "@supabase/supabase-js";
import { config, isTestMode } from "../../config.js";
import { slackClient } from "../../lib/slack-client.js";
import { postLine, resolveChannelId } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import { getTodayDateString } from "../../lib/standup.js";
import { checkAgentCostCap, recordApiSpend } from "../../lib/cost-cap.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { rivals, verifyDiscovered, type Ans, type Cit } from "./analyse.js";
import { containsName } from "../aeo-recommender/gather.js";
import { callTool, discoverMessage, DISCOVER_TOOL, PLAYBOOK_TOOL, playbookMessage, validatePlaybooks } from "./propose.js";

export const AGENT = "aeo-competitors";
const DAY = 86_400_000;
const SYSTEM = "You are TGL's competitor analyst for AI visibility (AEO). Use only the evidence given. Plain English, specific, no jargon, no numbers, no guarantees.";

export async function runCompetitorIntel(): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const { data: brands } = await sb.from("brands").select("id, name").eq("setup_status", "verified");
  let n = 0;
  for (const b of (brands ?? []) as any[]) {
    const { data: last } = await sb.from("competitor_insights").select("created_at").eq("brand_id", b.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - Date.parse(last.created_at) < 30 * DAY) continue;
    try { if (await buildInsight(sb, b.id)) n++; }
    catch (err: any) { await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* competitor report failed for *${b.name}*: \`${String(err?.message ?? err).slice(0, 300)}\`` }).catch(() => {}); }
    if (n >= 3) break; // spread the cost across runs
  }
  return n;
}

async function loadAnswers(sb: SupabaseClient, brandId: string, from: string): Promise<Ans[]> {
  const out: Ans[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await sb.from("answers").select("id, prompt_id, text, mentioned, competitors_mentioned, prompts!inner(text), runs!inner(engine, run_date, status)")
      .eq("brand_id", brandId).gte("runs.run_date", from).in("runs.status", ["succeeded", "partial"]).order("created_at").range(page * 500, page * 500 + 499);
    if (error) throw new Error(`answers: ${error.message}`);
    out.push(...((data ?? []) as any[]).filter((a) => a.text).map((a) => ({ id: a.id, prompt_id: a.prompt_id, prompt: a.prompts.text, engine: a.runs.engine, run_date: a.runs.run_date, mentioned: !!a.mentioned, text: a.text, tracked: a.competitors_mentioned ?? [] })));
    if ((data ?? []).length < 500) break;
  }
  return out;
}

/** Up to n answers that don't name the brand, taken round-robin across questions so every question is represented. */
export function spreadSample(answers: Ans[], n: number): Ans[] {
  const byQ = new Map<string, Ans[]>();
  for (const a of answers.filter((x) => !x.mentioned).sort((x, y) => y.run_date.localeCompare(x.run_date))) byQ.set(a.prompt_id, [...(byQ.get(a.prompt_id) ?? []), a]);
  const out: Ans[] = [];
  for (let i = 0; out.length < n; i++) {
    let added = false;
    for (const list of byQ.values()) if (list[i] && out.length < n) { out.push(list[i]); added = true; }
    if (!added) break;
  }
  return out;
}

export async function buildInsight(sb: SupabaseClient, brandId: string): Promise<string | null> {
  const cap = await checkAgentCostCap(AGENT);
  if (!cap.allowed) return null;
  const to = getTodayDateString();
  const from = new Date(Date.parse(to + "T00:00:00Z") - 29 * DAY).toISOString().slice(0, 10);
  const [{ data: brand }, { data: comps }, { data: variants }, { data: market }] = await Promise.all([
    sb.from("brands").select("id, tenant_id, name, primary_domain").eq("id", brandId).single(),
    sb.from("competitors").select("name").eq("brand_id", brandId).eq("status", "active"),
    sb.from("brand_variants").select("name").eq("brand_id", brandId),
    sb.from("products_icps").select("product, icp, location").eq("brand_id", brandId).order("created_at").limit(1),
  ]);
  if (!brand) return null;
  const answers = await loadAnswers(sb, brandId, from);
  if (answers.length < 10) return null;
  const cits: Cit[] = [];
  const ids = answers.map((a) => a.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("citations").select("answer_id, domain").in("answer_id", ids.slice(i, i + 200));
    cits.push(...((data ?? []) as Cit[]));
  }
  const tracked = ((comps ?? []) as any[]).map((c) => c.name);
  const brandNames = [brand.name, ...((variants ?? []) as any[]).map((v) => v.name)];
  const m = ((market ?? []) as any[])[0];
  let usd = 0;
  const spend = (r: { usd: number; model: string; tokens: { in: number; out: number } }, what: string) => {
    usd += r.usd;
    recordApiSpend({ agent: AGENT, apiName: `anthropic:${r.model}`, totalCostUsd: r.usd, details: `${what} ${brand.name} (${r.tokens.in} in / ${r.tokens.out} out)` });
  };

  // 1. Who else AI recommends (names checked against the answer text by code).
  const sample = spreadSample(answers, 60);
  let discovered: { name: string; answers: number }[] = [];
  if (sample.length) {
    const d = await callTool<{ names: string[] }>(SYSTEM, discoverMessage(brand.name, m ? `${m.product} for ${m.icp}, ${m.location}` : "—", sample), DISCOVER_TOOL, 2000);
    spend(d, "competitor discovery");
    discovered = verifyDiscovered(d.data?.names ?? [], answers, brandNames, tracked);
  }

  // 2. Every rival measured from the answers.
  const all = rivals(answers, cits, tracked, discovered.map((x) => x.name), brand.primary_domain);
  const top = all.filter((r) => r.winsOverYou > 0).slice(0, 3);

  // 3. Why AI picks the top rivals, grounded in their winning answers.
  const excerpts = new Map(top.map((r) => [r.name, answers.filter((a) => !a.mentioned && (r.tracked ? a.tracked.includes(r.name) : containsName(a.text, [r.name]))).slice(0, 4)]));
  let playbooks: ReturnType<typeof validatePlaybooks> = [];
  if (top.length) {
    const p = await callTool<any>(SYSTEM, playbookMessage(brand.name, top, excerpts), PLAYBOOK_TOOL, 3000);
    spend(p, "competitor playbooks");
    playbooks = validatePlaybooks(p.data, top, new Map([...excerpts.entries()].map(([k, v]) => [k, v.length])));
  }

  const usdInr = Number(process.env.USD_INR_RATE);
  if (isFinite(usdInr) && usdInr > 0 && usd > 0) {
    await sb.from("usage_costs").insert({ tenant_id: brand.tenant_id, brand_id: brandId, product: "truevisible", cost_date: to, category: "llm", engine: null, units: 1,
      amount_inr: Number((usd * usdInr).toFixed(4)), detail: { purpose: "competitor_intel", usd, usd_inr_rate: usdInr } }).then(() => {}, () => {});
  }
  const named = answers.filter((a) => a.mentioned).length;
  const { data: saved, error } = await sb.from("competitor_insights").insert({
    tenant_id: brand.tenant_id, brand_id: brandId, period_from: from, period_to: to, answers_total: answers.length, named_total: named,
    rivals: all.slice(0, 12), discovered, playbooks, cost_usd: usd,
  }).select("id").single();
  if (error) throw new Error(`save: ${error.message}`);

  const channel = (await resolveChannelId("#doors-aeo")) || config.approvalsChannelId;
  if (config.slackBotToken && channel) {
    const line = all.slice(0, 4).map((r) => `${r.name}${r.tracked ? "" : " (new)"} ${r.winsOverYou}`).join(" · ");
    await slackClient.chat.postMessage({ channel, text: `*${brand.name}* — competitor report: named in ${named} of ${answers.length} answers; rivals named where you aren't: ${line || "none"} · $${usd.toFixed(3)}` }).catch(() => {});
  }
  return saved.id;
}
