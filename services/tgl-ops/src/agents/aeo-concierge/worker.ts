// Trial Concierge + Customer Success (plan Day 31).
// Hourly 10:00–19:00 IST: each workspace gets at most one journey email it's due (finishing setup, a setup sent back,
// trial day 3 and 5, after the trial, away 14+ days, a managed offer). Monday 09:30: the team's account-health list.
// Never: agency (white-label) clients, people who turned off "Tips and reminders", or the same email twice.
import type { SupabaseClient } from "@supabase/supabase-js";
import { config, isTestMode } from "../../config.js";
import { slackClient } from "../../lib/slack-client.js";
import { postLine, resolveChannelId } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { managedUrl, sendEmail } from "../aeo-reports/worker.js";
import { dueKind, riskFlags, type JourneyState } from "./journey.js";
import { journeyEmail, type Facts } from "./emails.js";

export const AGENT = "aeo-concierge";
const DAY = 86_400_000;
const ist = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);

type Account = { tenantId: string; tenantName: string; state: Omit<JourneyState, "sent">; brandId: string | null; brandName: string; setupNote: string | null; members: { userId: string; tips: boolean }[] };

async function loadAccounts(sb: SupabaseClient, now: number): Promise<Account[]> {
  const [{ data: tenants }, { data: subs }, { data: brands }, { data: members }] = await Promise.all([
    sb.from("tenants").select("id, name, kind, created_at").neq("kind", "agency_client"),
    sb.from("subscriptions").select("tenant_id, plan, status, trial_started_at, trial_ends_at, created_at").eq("product", "truevisible").is("brand_id", null).order("created_at", { ascending: false }),
    sb.from("brands").select("id, tenant_id, name, onboarding_step, setup_status, setup_note, updated_at").order("created_at"),
    sb.from("tenant_members").select("tenant_id, user_id, email_tips, last_seen_at"),
  ]);
  const out: Account[] = [];
  for (const t of (tenants ?? []) as any[]) {
    const sub = ((subs ?? []) as any[]).find((s) => s.tenant_id === t.id);
    if (!sub || sub.plan === "internal") continue;
    const b = ((brands ?? []) as any[]).find((x) => x.tenant_id === t.id) ?? null;
    const ms = ((members ?? []) as any[]).filter((m) => m.tenant_id === t.id);
    const lastSeen = ms.map((m) => m.last_seen_at).filter(Boolean).sort().pop() ?? null;
    let diyStale = 0, managedAskedRecently = false;
    if (b && sub.plan === "track") {
      const since = new Date(now - 14 * DAY).toISOString();
      const [{ count }, { count: asked }] = await Promise.all([
        sb.from("recommendations").select("id", { count: "exact", head: true }).eq("brand_id", b.id).eq("status", "diy").lt("updated_at", since),
        sb.from("managed_aeo_requests").select("id", { count: "exact", head: true }).eq("tenant_id", t.id).gte("created_at", new Date(now - 60 * DAY).toISOString()),
      ]);
      diyStale = count ?? 0; managedAskedRecently = (asked ?? 0) > 0;
    }
    out.push({
      tenantId: t.id, tenantName: t.name, brandId: b?.id ?? null, brandName: b?.name ?? "your brand", setupNote: b?.setup_note ?? null,
      members: ms.map((m) => ({ userId: m.user_id, tips: m.email_tips !== false })),
      state: { now, tenantCreatedAt: t.created_at, plan: sub.plan, status: sub.status, trialStartedAt: sub.trial_started_at, trialEndsAt: sub.trial_ends_at,
        brand: b ? { onboardingStep: b.onboarding_step ?? 0, setupStatus: b.setup_status, updatedAt: b.updated_at } : null, lastSeenAt: lastSeen, diyStale, managedAskedRecently },
    });
  }
  return out;
}

async function facts(sb: SupabaseClient, a: Account, now: number): Promise<Facts> {
  const f: Facts = { brand: a.brandName, named: null, answers: null, topRec: null, diy: [], note: a.setupNote, thisWeek: null, lastWeek: null };
  if (!a.brandId) return f;
  const from = a.state.trialStartedAt ? ist(Date.parse(a.state.trialStartedAt)) : ist(now - 30 * DAY);
  const [{ data: vis }, { data: top }, { data: diy }] = await Promise.all([
    sb.from("v_visibility_daily").select("run_date, answers, mentioned").eq("brand_id", a.brandId).gte("run_date", ist(now - 30 * DAY)),
    sb.from("recommendations").select("title").eq("brand_id", a.brandId).eq("status", "open").order("priority", { ascending: false }).limit(1),
    sb.from("recommendations").select("title").eq("brand_id", a.brandId).eq("status", "diy").order("updated_at").limit(3),
  ]);
  const rows = (vis ?? []) as any[];
  const sum = (r: any[]) => (r.length ? { n: r.reduce((s, x) => s + (x.mentioned ?? 0), 0), of: r.reduce((s, x) => s + (x.answers ?? 0), 0) } : null);
  const period = sum(rows.filter((r) => r.run_date >= from));
  if (period?.of) { f.named = period.n; f.answers = period.of; }
  const tw = sum(rows.filter((r) => r.run_date > ist(now - 7 * DAY))), lw = sum(rows.filter((r) => r.run_date > ist(now - 14 * DAY) && r.run_date <= ist(now - 7 * DAY)));
  f.thisWeek = tw?.of ? tw : null; f.lastWeek = lw?.of ? lw : null;
  f.topRec = ((top ?? []) as any[])[0]?.title ?? null;
  f.diy = ((diy ?? []) as any[]).map((r) => r.title);
  return f;
}

export async function runConcierge(now = Date.now()): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  const appUrl = process.env.TRUEVISIBLE_APP_URL?.trim().replace(/\/$/, "");
  if (!sb || !appUrl) return 0;
  const accounts = await loadAccounts(sb, now);
  const { data: sentRows } = await sb.from("lifecycle_messages").select("tenant_id, kind");
  let n = 0;
  for (const a of accounts) {
    const sent = new Set(((sentRows ?? []) as any[]).filter((r) => r.tenant_id === a.tenantId).map((r) => r.kind));
    const kind = dueKind({ ...a.state, sent });
    if (!kind) continue;
    // Claim first (unique tenant+kind) so a second run can't send it again.
    const { data: claim, error } = await sb.from("lifecycle_messages").insert({ tenant_id: a.tenantId, brand_id: a.brandId, kind }).select("id").single();
    if (error) continue;
    const email = journeyEmail(kind, await facts(sb, a, now), appUrl, managedUrl().replace("trial_baseline", kind.split(":")[0]));
    const to: string[] = [];
    for (const m of a.members.filter((x) => x.tips)) { const { data } = await sb.auth.admin.getUserById(m.userId); if (data?.user?.email) to.push(data.user.email); }
    const err = !email ? "no template" : !to.length ? null : await sendEmail(to, email);
    await sb.from("lifecycle_messages").update({ recipients: email && !err ? to.length : 0, error: err }).eq("id", claim.id);
    if (err) await postLine({ channel: getAlertsChannel(), text: `[Warning] *@${AGENT}* ${kind} email for ${a.tenantName} not sent: \`${err}\`` }).catch(() => {});
    else n++;
  }
  return n;
}

/** Monday 09:30 IST: every trial and paying account in one Slack list, those needing a person first. */
export async function postHealthList(now = Date.now()): Promise<void> {
  if (isTestMode() || !config.slackBotToken) return;
  const sb = getSupabase();
  if (!sb) return;
  const accounts = await loadAccounts(sb, now);
  const live = accounts.filter((a) => (a.state.plan === "trial" && ["trialing", "expired"].includes(a.state.status)) || ["track", "managed", "managed_plus"].includes(a.state.plan));
  const seen = (iso: string | null) => (iso ? `${Math.floor((now - Date.parse(iso)) / DAY)}d ago` : "never");
  const rows = live.map((a) => ({ a, flags: riskFlags(a.state) })).sort((x, y) => y.flags.length - x.flags.length);
  const line = ({ a, flags }: { a: Account; flags: string[] }) => {
    const trialDay = a.state.trialStartedAt && a.state.status === "trialing" ? ` · day ${Math.min(7, Math.floor((now - Date.parse(a.state.trialStartedAt)) / DAY) + 1)} of 7` : "";
    return `${flags.length ? "FLAG" : "-"} *${a.brandName}* (${a.state.plan}${a.state.status !== "active" ? `, ${a.state.status}` : ""}${trialDay}) · last seen ${seen(a.state.lastSeenAt)} · setup ${a.state.brand?.setupStatus ?? "not started"}${flags.length ? ` — ${flags.join("; ")}` : ""}`;
  };
  const text = rows.length ? `*Account health — week of ${ist(now)}* (${rows.filter((r) => r.flags.length).length} need a person)\n${rows.slice(0, 40).map(line).join("\n")}` : `*Account health — week of ${ist(now)}*: no trial or paying accounts yet.`;
  const channel = (await resolveChannelId("#doors-aeo")) || config.approvalsChannelId;
  await slackClient.chat.postMessage({ channel, text }).catch(() => {});
}
