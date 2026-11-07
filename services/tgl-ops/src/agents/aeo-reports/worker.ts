// Reports (plan Day 23): daily digest after the morning run, weekly trend on Mondays. Stored in public.reports
// (shown on the dashboard) and emailed through Resend. Idempotent: one report per brand × kind × period.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTestMode } from "../../config.js";
import { postLine } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import { getTodayDateString } from "../../lib/standup.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { cadenceFor, type Cadence } from "../aeo-audit-engine/cadence.js";
import { buildBaseline, buildDaily, buildMonthly, buildWeekly, dailyHasNews, previousMonth, type AnswerRow } from "./build.js";
import { monthlyPdf } from "./pdf.js";
import { baselineEmail, dailyEmail, monthlyEmail, weeklyEmail, type Email } from "./email.js";

export const AGENT = "aeo-audit-engine";
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** Monday–Sunday week before the given Monday (pure; tested). */
/** The 7 days ending today — so Monday's report includes Monday's weekly run (paid plans run on Mondays). */
export function previousWeek(today: string): { start: string; end: string } {
  return { start: addDays(today, -6), end: today };
}

/** Plan cadence per tenant (latest subscription). */
async function cadenceByTenant(sb: SupabaseClient): Promise<Map<string, Cadence>> {
  const { data } = await sb.from("subscriptions").select("tenant_id, plan, status, trial_started_at, trial_ends_at, created_at").eq("product", "truevisible").is("brand_id", null).order("created_at", { ascending: false });
  const m = new Map<string, Cadence>();
  for (const s of (data ?? []) as any[]) if (!m.has(s.tenant_id)) m.set(s.tenant_id, cadenceFor(s));
  return m;
}

async function loadAnswers(sb: SupabaseClient, brandId: string, from: string, to: string): Promise<AnswerRow[]> {
  const out: AnswerRow[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await sb.from("answers").select("prompt_id, mentioned, competitors_mentioned, created_at, prompts!inner(text, status), runs!inner(engine, run_date, status)")
      .eq("brand_id", brandId).gte("runs.run_date", from).lte("runs.run_date", to).in("runs.status", ["succeeded", "partial"]).eq("prompts.status", "active")
      .order("created_at").range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`answers: ${error.message}`);
    for (const a of (data ?? []) as any[]) out.push({ prompt_id: a.prompt_id, prompt_text: a.prompts.text, engine: a.runs.engine, date: a.runs.run_date, mentioned: !!a.mentioned, competitors: a.competitors_mentioned ?? [], created_at: a.created_at });
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function loadSites(sb: SupabaseClient, brandId: string, from: string, to: string): Promise<{ date: string; domain: string; answer: string }[]> {
  const out: { date: string; domain: string; answer: string }[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await sb.from("citations").select("domain, answer_id, answers!inner(runs!inner(run_date, status))")
      .eq("brand_id", brandId).gte("answers.runs.run_date", from).lte("answers.runs.run_date", to).in("answers.runs.status", ["succeeded", "partial"])
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`citations: ${error.message}`);
    for (const c of (data ?? []) as any[]) out.push({ date: c.answers.runs.run_date, domain: c.domain, answer: c.answer_id });
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function context(sb: SupabaseClient, brandId: string) {
  const [{ data: brand }, { data: comps }, { data: variants }, { data: recs }] = await Promise.all([
    sb.from("brands").select("id, tenant_id, name, primary_domain").eq("id", brandId).single(),
    sb.from("competitors").select("name").eq("brand_id", brandId).eq("status", "active"),
    sb.from("brand_variants").select("name").eq("brand_id", brandId),
    sb.from("recommendations").select("title, status, priority, updated_at").eq("brand_id", brandId).neq("status", "superseded").order("priority", { ascending: false }),
  ]);
  const open = (recs ?? []).filter((r: any) => r.status === "open");
  return { brand: brand as any, competitors: (comps ?? []).map((c: any) => c.name as string), variants: (variants ?? []).map((v: any) => v.name as string), recs: recs ?? [], openRecs: open.length, topRec: (open[0]?.title as string) ?? null };
}

async function recipients(sb: SupabaseClient, tenantId: string, kind: "daily" | "weekly" | "monthly"): Promise<string[]> {
  const { data: tenant } = await sb.from("tenants").select("kind").eq("id", tenantId).maybeSingle();
  if (tenant?.kind === "agency_client") return [];                 // white-label: TGL never emails an agency's brand (SPEC §9)
  const { data: members } = await sb.from("tenant_members").select("user_id, email_daily, email_weekly").eq("tenant_id", tenantId);
  const out: string[] = [];
  for (const m of (members ?? []) as any[]) {
    if (kind === "daily" ? !m.email_daily : !m.email_weekly) continue;   // monthly follows the weekly choice
    const { data } = await sb.auth.admin.getUserById(m.user_id);
    if (data?.user?.email) out.push(data.user.email);
  }
  return out;
}

/** Resend REST API. Returns null on success, else the error. */
export async function sendEmail(to: string[], e: Email, fetchImpl: typeof fetch = fetch, attachments?: { filename: string; content: string }[]): Promise<string | null> {
  const key = process.env.RESEND_API_KEY?.trim(), from = process.env.REPORTS_FROM?.trim();
  if (!key || !from) return "RESEND_API_KEY / REPORTS_FROM not set";
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject: e.subject, text: e.text, html: e.html, reply_to: process.env.REPORTS_REPLY_TO?.trim() || undefined, ...(attachments?.length ? { attachments } : {}) }),
  });
  return res.ok ? null : `Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
}

async function saveAndSend(sb: SupabaseClient, row: { tenant_id: string; brand_id: string; kind: "daily" | "weekly"; period_start: string; period_end: string; summary: string; content: unknown }, email: Email | null) {
  const { data: saved, error } = await sb.from("reports").insert(row).select("id").single();
  if (error) { if (/duplicate|unique/i.test(error.message)) return; throw new Error(`save report: ${error.message}`); }
  if (!email) return;
  const to = await recipients(sb, row.tenant_id, row.kind);
  if (!to.length) return;
  const err = await sendEmail(to, email);
  await sb.from("reports").update(err ? { email_error: err } : { emailed_at: new Date().toISOString(), email_recipients: to.length }).eq("id", saved.id);
  if (err) await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* ${row.kind} report email not sent: \`${err}\`` }).catch(() => {});
}

export async function runDailyDigests(date = getTodayDateString()): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const appUrl = process.env.TRUEVISIBLE_APP_URL?.trim().replace(/\/$/, "");
  const { data: todayRows } = await sb.from("v_visibility_daily").select("brand_id").eq("run_date", date);
  const brandIds = [...new Set((todayRows ?? []).map((r: any) => r.brand_id as string))];
  const cad = await cadenceByTenant(sb);
  const { data: tenantRows } = brandIds.length ? await sb.from("brands").select("id, tenant_id").in("id", brandIds) : { data: [] };
  const tenantOf = new Map((tenantRows ?? []).map((b: any) => [b.id as string, b.tenant_id as string]));
  let made = 0;
  for (const brandId of brandIds) {
    if (cad.get(tenantOf.get(brandId) ?? "") !== "daily") continue;   // weekly plans get the weekly email instead
    const { data: exists } = await sb.from("reports").select("id").eq("brand_id", brandId).eq("kind", "daily").eq("period_end", date).limit(1);
    if (exists?.length) continue;
    // Wait until today's daily runs are all finished (audits alone don't make a digest).
    const { data: runs } = await sb.from("runs").select("status, kind").eq("brand_id", brandId).eq("run_date", date);
    if (!(runs ?? []).some((r: any) => r.kind === "daily") || (runs ?? []).some((r: any) => r.status === "running" || r.status === "queued")) continue;
    try {
      const ctx = await context(sb, brandId);
      const { data: prevRow } = await sb.from("v_visibility_daily").select("run_date").eq("brand_id", brandId).lt("run_date", date).gte("run_date", addDays(date, -7)).order("run_date", { ascending: false }).limit(1).maybeSingle();
      const prevDate = (prevRow?.run_date as string | undefined) ?? null;
      const [today, prev, sites] = await Promise.all([
        loadAnswers(sb, brandId, date, date),
        prevDate ? loadAnswers(sb, brandId, prevDate, prevDate) : Promise.resolve([]),
        loadSites(sb, brandId, addDays(date, -7), date),
      ]);
      const d = buildDaily({ brand: ctx.brand.name, date, today, prev, prevDate, competitorNames: ctx.competitors,
        sitesToday: sites.filter((s) => s.date === date).map((s) => s.domain), sitesBefore: sites.filter((s) => s.date < date).map((s) => s.domain), openRecs: ctx.openRecs, topRec: ctx.topRec });
      const email = appUrl && dailyHasNews(d) ? dailyEmail(d, appUrl) : null;
      await saveAndSend(sb, { tenant_id: ctx.brand.tenant_id, brand_id: brandId, kind: "daily", period_start: date, period_end: date,
        summary: `Named in ${d.overall.n} of ${d.overall.of} answers`, content: d }, email);
      made++;
    } catch (err: any) {
      await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* daily report failed for \`${brandId}\`: \`${String(err?.message ?? err).slice(0, 300)}\`` }).catch(() => {});
    }
  }
  if (!appUrl && made) await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* reports saved but not emailed: set \`TRUEVISIBLE_APP_URL\` on tgl-ops.` }).catch(() => {});
  return made;
}

export async function runWeeklyReports(today = getTodayDateString()): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const appUrl = process.env.TRUEVISIBLE_APP_URL?.trim().replace(/\/$/, "");
  const { start, end } = previousWeek(today);
  const { data: rows } = await sb.from("v_visibility_daily").select("brand_id").gte("run_date", start).lte("run_date", end);
  let made = 0;
  const { data: trialTenants } = await sb.from("subscriptions").select("tenant_id").eq("product", "truevisible").eq("plan", "trial");
  const trials = new Set((trialTenants ?? []).map((t: any) => t.tenant_id as string));
  for (const brandId of [...new Set((rows ?? []).map((r: any) => r.brand_id as string))]) {
    const { data: bt } = await sb.from("brands").select("tenant_id").eq("id", brandId).maybeSingle();
    if (bt && trials.has(bt.tenant_id)) continue;                    // trials get the day-7 baseline instead
    const { data: exists } = await sb.from("reports").select("id").eq("brand_id", brandId).eq("kind", "weekly").eq("period_end", end).limit(1);
    if (exists?.length) continue;
    try {
      const ctx = await context(sb, brandId);
      const [week, prevWeek, sites] = await Promise.all([loadAnswers(sb, brandId, start, end), loadAnswers(sb, brandId, addDays(start, -7), addDays(end, -7)), loadSites(sb, brandId, start, end)]);
      const perDomain = new Map<string, Set<string>>();
      for (const s of sites) { if (!perDomain.has(s.domain)) perDomain.set(s.domain, new Set()); perDomain.get(s.domain)!.add(s.answer); }
      const names = [ctx.brand.name, ...ctx.variants, ...(ctx.brand.primary_domain ? [ctx.brand.primary_domain] : [])].map((n: string) => n.toLowerCase());
      const recsDone = ctx.recs.filter((r: any) => r.status === "done" && r.updated_at >= start + "T00:00:00+05:30" && r.updated_at <= end + "T23:59:59+05:30").length;
      const w = buildWeekly({ brand: ctx.brand.name, start, end, week, prevWeek, isBranded: (t) => names.some((n) => n.length >= 3 && t.toLowerCase().includes(n)),
        competitorNames: ctx.competitors, sites: [...perDomain].map(([domain, a]) => ({ domain, answers: a.size })), recsDone, openRecs: ctx.openRecs, topRec: ctx.topRec });
      await saveAndSend(sb, { tenant_id: ctx.brand.tenant_id, brand_id: brandId, kind: "weekly", period_start: start, period_end: end,
        summary: `Named in ${w.overall.n} of ${w.overall.of} answers`, content: w }, appUrl ? weeklyEmail(w, appUrl) : null);
      made++;
    } catch (err: any) {
      await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* weekly report failed for \`${brandId}\`: \`${String(err?.message ?? err).slice(0, 300)}\`` }).catch(() => {});
    }
  }
  return made;
}

/** 1st of the month, 09:00 IST: one-page review of the previous calendar month — stored, PDF in Storage, emailed. */
export async function runMonthlyReports(today = getTodayDateString()): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const appUrl = process.env.TRUEVISIBLE_APP_URL?.trim().replace(/\/$/, "");
  const pm = previousMonth(today);
  const { data: rows } = await sb.from("v_visibility_daily").select("brand_id").gte("run_date", pm.start).lte("run_date", pm.end);
  let made = 0;
  for (const brandId of [...new Set((rows ?? []).map((r: any) => r.brand_id as string))]) {
    const { data: exists } = await sb.from("reports").select("id").eq("brand_id", brandId).eq("kind", "monthly").eq("period_end", pm.end).limit(1);
    if (exists?.length) continue;
    try {
      const ctx = await context(sb, brandId);
      const [month, prev, sites] = await Promise.all([loadAnswers(sb, brandId, pm.start, pm.end), loadAnswers(sb, brandId, pm.prevStart, pm.prevEnd), loadSites(sb, brandId, pm.start, pm.end)]);
      const perDomain = new Map<string, Set<string>>();
      for (const s of sites) { if (!perDomain.has(s.domain)) perDomain.set(s.domain, new Set()); perDomain.get(s.domain)!.add(s.answer); }
      const names = [ctx.brand.name, ...ctx.variants, ...(ctx.brand.primary_domain ? [ctx.brand.primary_domain] : [])].map((n: string) => n.toLowerCase());
      const recsDone = ctx.recs.filter((r: any) => r.status === "done" && r.updated_at >= pm.start + "T00:00:00+05:30" && r.updated_at <= pm.end + "T23:59:59+05:30").length;
      const m = buildMonthly({ brand: ctx.brand.name, month: pm.month, start: pm.start, end: pm.end, rows: month, prevRows: prev,
        isBranded: (t) => names.some((n) => n.length >= 3 && t.toLowerCase().includes(n)), competitorNames: ctx.competitors,
        sites: [...perDomain].map(([domain, a]) => ({ domain, answers: a.size })), recsDone, openRecs: ctx.openRecs,
        plan: ctx.recs.filter((r: any) => r.status === "open").slice(0, 3).map((r: any) => r.title as string) });
      const pdf = await monthlyPdf(m, ctx.brand.primary_domain);
      const key = `${ctx.brand.tenant_id}/${brandId}/${pm.month}-monthly.pdf`;
      const up = await sb.storage.from("reports").upload(key, pdf, { contentType: "application/pdf", upsert: true });
      if (up.error) throw new Error(`upload pdf: ${up.error.message}`);
      const { data: saved, error } = await sb.from("reports").insert({ tenant_id: ctx.brand.tenant_id, brand_id: brandId, kind: "monthly", period_start: pm.start, period_end: pm.end,
        summary: `Named in ${m.overall.n} of ${m.overall.of} answers`, content: m, url: key }).select("id").single();
      if (error) { if (/duplicate|unique/i.test(error.message)) continue; throw new Error(`save report: ${error.message}`); }
      made++;
      if (!appUrl) continue;
      const to = await recipients(sb, ctx.brand.tenant_id, "monthly");
      if (!to.length) continue;
      const err = await sendEmail(to, monthlyEmail(m, appUrl, saved.id), fetch, [{ filename: `${ctx.brand.name.replace(/[^A-Za-z0-9]+/g, "-")}-AI-visibility-${pm.month}.pdf`, content: pdf.toString("base64") }]);
      await sb.from("reports").update(err ? { email_error: err } : { emailed_at: new Date().toISOString(), email_recipients: to.length }).eq("id", saved.id);
      if (err) await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* monthly report email not sent: \`${err}\`` }).catch(() => {});
    } catch (err: any) {
      await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* monthly report failed for \`${brandId}\`: \`${String(err?.message ?? err).slice(0, 300)}\`` }).catch(() => {});
    }
  }
  return made;
}

/** Hourly: when a trial's 7 days are up — baseline report (stored + emailed) and the trial is marked expired. */
export async function runTrialBaselines(now = new Date()): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const appUrl = process.env.TRUEVISIBLE_APP_URL?.trim().replace(/\/$/, "");
  const { data: ended } = await sb.from("subscriptions").select("id, tenant_id, trial_started_at, trial_ends_at").eq("product", "truevisible").eq("plan", "trial").eq("status", "trialing")
    .not("trial_started_at", "is", null).lte("trial_ends_at", now.toISOString());
  let made = 0;
  for (const sub of (ended ?? []) as any[]) {
    try {
      const { data: brands } = await sb.from("brands").select("id").eq("tenant_id", sub.tenant_id).eq("onboarding_step", 4);
      for (const b of brands ?? []) {
        const start = new Date(Date.parse(sub.trial_started_at) + 5.5 * 3600_000).toISOString().slice(0, 10);
        const end = new Date(Date.parse(sub.trial_ends_at) + 5.5 * 3600_000).toISOString().slice(0, 10);
        const { data: exists } = await sb.from("reports").select("id").eq("brand_id", b.id).eq("kind", "baseline").limit(1);
        if (exists?.length) continue;
        const ctx = await context(sb, b.id);
        const [rows, sites] = await Promise.all([loadAnswers(sb, b.id, start, end), loadSites(sb, b.id, start, end)]);
        const perDomain = new Map<string, Set<string>>();
        for (const s of sites) { if (!perDomain.has(s.domain)) perDomain.set(s.domain, new Set()); perDomain.get(s.domain)!.add(s.answer); }
        const names = [ctx.brand.name, ...ctx.variants, ...(ctx.brand.primary_domain ? [ctx.brand.primary_domain] : [])].map((n: string) => n.toLowerCase());
        const base = buildBaseline({ brand: ctx.brand.name, start, end, rows, isBranded: (t) => names.some((n) => n.length >= 3 && t.toLowerCase().includes(n)),
          competitorNames: ctx.competitors, sites: [...perDomain].map(([domain, a]) => ({ domain, answers: a.size })),
          fixes: ctx.recs.filter((r: any) => r.status === "open").slice(0, 3).map((r: any) => r.title as string) });
        const { data: saved, error } = await sb.from("reports").insert({ tenant_id: sub.tenant_id, brand_id: b.id, kind: "baseline", period_start: start, period_end: end,
          summary: `${base.overall.of} answers read · named in ${base.overall.n}`, content: base }).select("id").single();
        if (error) { if (/duplicate|unique/i.test(error.message)) continue; throw new Error(`save baseline: ${error.message}`); }
        made++;
        if (!appUrl) continue;
        const to = await recipients(sb, sub.tenant_id, "weekly");
        if (!to.length) continue;
        const err = await sendEmail(to, baselineEmail(base, appUrl, saved.id, managedUrl()));
        await sb.from("reports").update(err ? { email_error: err } : { emailed_at: new Date().toISOString(), email_recipients: to.length }).eq("id", saved.id);
      }
      await sb.from("subscriptions").update({ status: "expired" }).eq("id", sub.id);
    } catch (err: any) {
      await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* trial baseline failed for tenant \`${sub.tenant_id}\`: \`${String(err?.message ?? err).slice(0, 300)}\`` }).catch(() => {});
    }
  }
  return made;
}

/** Where "have it done" goes: the AEO page on the website (pricing lives there). */
export function managedUrl(): string {
  const u = new URL(process.env.NEXT_PUBLIC_MANAGED_AEO_URL || "https://thegrowthlab.co.in/answer-engine-optimization-services/");
  u.searchParams.set("utm_source", "truevisible"); u.searchParams.set("utm_medium", "email"); u.searchParams.set("utm_campaign", "trial_baseline");
  return u.toString();
}
