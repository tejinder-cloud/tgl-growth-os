// services/tgl-ops/src/agents/pipeline/live-view.ts
// The live view at /pipeline/live (24 Nov 2026, modelled on the My LabOS /ops/live page). Actions first: what is
// waiting on the Architect, problems, and the call list of approved businesses that have only a phone number; then
// the funnel, the outbox, what the agents did and spend. Everything is counted from data the service keeps;
// nothing is estimated, and a part that could not be read says so instead of showing zero.
// buildLiveView is pure, so every number on the page is tested without a database.
import { plainError } from "../../lib/plain-error.js";
import { cleanBusinessName } from "../outreach-sequencer/names.js";
import { categoryLabel } from "../outreach-sequencer/sequence.js";
import type { Deal } from "./stages.js";

export interface LiveProspect {
  id: string;
  company: string;
  city?: string | null;
  category?: string | null;
  status: string;
  fit_score?: number | null;
  created_at?: string | null;
  decision_maker?: { name?: string; email?: string; phone?: string } | null;
  signals?: {
    outreach?: {
      state?: string;
      next_touch?: number;
      next_due_at?: string;
      pause_reason?: string;
      last_reply_at?: string;
      last_reply_intent?: string;
      touches?: { n: number; channel?: string; sent_at?: string; dry_run?: boolean; via?: string }[];
    };
    /** The AI check run in advance for a phone-only business (preaudit.ts). */
    preaudit?: { mentions?: number; total_queries?: number; audited_at?: string; weakest_competitor?: string; competitor_mentions?: Record<string, number> };
  } | null;
}

export interface AgentLine {
  agent: string;
  /** The last heading the agent wrote in today's log, e.g. "Run, 09:30 IST (Ludhiana, hotels)". */
  last: string;
}

export interface Spend {
  todayInr: number;
  monthInr: number;
  /** Rupees this month per product ("truevisible", "tgl_ops"). */
  byProduct: Record<string, number>;
}

export interface LiveInput {
  now: Date;
  prospects: LiveProspect[];
  deals: Deal[];
  agents: AgentLine[] | null;
  spend: Spend | null;
  /** Emails allowed today (the warm-up cap). */
  capToday: number;
}

export interface OutboxRow {
  company: string;
  city: string;
  what: string;
  sentAt: string;
  today: boolean;
}

export interface CallRow {
  company: string;
  city: string;
  type: string;
  fit: number;
  /** The advance AI check in one sentence, or "" when it has not run yet. */
  check: string;
}

export interface Problem {
  text: string;
  /** Businesses it concerns, when there are any. */
  names: string[];
}

export interface LiveView {
  generatedAt: string;
  today: { sent: number; cap: number; replies: number; callsBooked: number; nextCall: string | null };
  funnel: { label: string; count: number }[];
  /** One sentence about the biggest gap in the funnel, or null. */
  funnelNote: string | null;
  waiting: string[];
  calls: CallRow[];
  problems: Problem[];
  outbox: OutboxRow[];
  agents: AgentLine[] | null;
  spend: Spend | null;
}

export function istDate(iso: string | Date): string {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return new Date(t + 330 * 60_000).toISOString().slice(0, 10);
}

const CALL_STAGES = new Set(["call_booked", "call_done", "proposal_sent", "won"]);

export const TOUCH_NAMES: Record<number, string> = { 1: "First email", 2: "WhatsApp note", 3: "Report email", 4: "Follow-up", 5: "Last note" };

function hasEmail(p: LiveProspect): boolean {
  return /\S+@\S+\.\S+/.test(p.decision_maker?.email || "");
}

/** "Named in 0 of 15 AI answers; Kochar's House of Smiles named in 7 (checked 25 Nov)." Only stored facts. */
export function checkLine(company: string, a: NonNullable<NonNullable<LiveProspect["signals"]>["preaudit"]> | undefined): string {
  if (!a || typeof a.mentions !== "number" || !a.total_queries) return "";
  const comp = a.weakest_competitor && a.competitor_mentions?.[a.weakest_competitor] !== undefined ? `; ${a.weakest_competitor} named in ${a.competitor_mentions[a.weakest_competitor]}` : "";
  const when = a.audited_at ? ` (checked ${dayOnly(a.audited_at).replace(/^\w+, /, "")})` : "";
  return `Named in ${a.mentions} of ${a.total_queries} AI answers${comp}${when}.`;
}

/** Why a sequence is paused, as one plain heading that groups the same cause together. */
export function pauseGroup(reason: string | undefined): string {
  const r = String(reason || "").replace(/^touch \d+: /, "");
  if (!r) return "Paused, no reason recorded";
  if (/held by the last check/i.test(r)) return "Held before sending: the email named something the audit does not support";
  if (/bounced/i.test(r)) return "Paused: an email bounced, so the address needs checking";
  return `Paused: ${plainError(r.replace(/^audit or one-pager failed: /i, ""))}`;
}

export function buildLiveView(input: LiveInput): LiveView {
  const today = istDate(input.now);
  const qualified = input.prospects.filter((p) => p.status !== "bench");
  const sentRows: OutboxRow[] = [];
  let sentToday = 0;
  let repliesToday = 0;
  let emailed = 0;
  let replied = 0;
  const groups = new Map<string, string[]>();

  for (const p of qualified) {
    const o = p.signals?.outreach;
    if (!o) continue;
    const name = cleanBusinessName(p.company);
    let any = false;
    for (const t of o.touches || []) {
      if (t.dry_run || !t.sent_at) continue;
      any = true;
      const isToday = istDate(t.sent_at) === today;
      sentRows.push({ company: name, city: p.city || "", what: TOUCH_NAMES[t.n] || `Message ${t.n}`, sentAt: t.sent_at, today: isToday });
      if (isToday) sentToday++;
    }
    if (any) emailed++;
    if (o.last_reply_at || o.state === "replied") replied++;
    if (o.last_reply_at && istDate(o.last_reply_at) === today) repliesToday++;
    // A business the Architect rejected stays paused for good; that is not a problem to report.
    if (o.state === "paused" && p.status !== "rejected") {
      const g = pauseGroup(o.pause_reason);
      groups.set(g, [...(groups.get(g) || []), name]);
    }
  }

  const approvedList = qualified.filter((p) => p.status === "reviewed" || p.status === "handed_to_outreach");
  const awaiting = qualified.filter((p) => p.status === "new").length;
  const calls = input.deals.filter((d) => CALL_STAGES.has(d.stage)).length;
  const won = input.deals.filter((d) => d.stage === "won").length;
  const upcoming = input.deals
    .filter((d) => d.stage === "call_booked" && d.call_at && Date.parse(d.call_at) > input.now.getTime())
    .map((d) => ({ at: d.call_at as string, company: cleanBusinessName(d.company) }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const replyDeals = input.deals.filter((d) => d.stage === "replied").length;

  // Approved, never emailed, no email address, a phone number: the WhatsApp first message reaches them once Meta
  // approves the app (no cold calls, Architect 24 Nov 2026).
  const callList: CallRow[] = approvedList
    .filter((p) => p.status === "reviewed" && !p.signals?.outreach && !hasEmail(p) && (p.decision_maker?.phone || "").replace(/\D/g, "").length >= 8)
    .sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0))
    .map((p) => ({
      company: cleanBusinessName(p.company),
      city: p.city || "",
      type: categoryLabel(p.category || ""),
      fit: Number(p.fit_score || 0),
      check: checkLine(cleanBusinessName(p.company), p.signals?.preaudit),
    }));
  const waitingForEmail = approvedList.filter((p) => p.status === "reviewed" && !p.signals?.outreach && hasEmail(p)).length;

  const waiting: string[] = [];
  if (awaiting) waiting.push(`Approve or reject ${awaiting} new ${awaiting === 1 ? "business" : "businesses"} in #revenue.`);
  if (replyDeals) waiting.push(`Answer ${replyDeals} ${replyDeals === 1 ? "reply" : "replies"} (open the pipeline).`);
  if (upcoming[0]) waiting.push(`Prepare for your next call: ${upcoming[0].company}, ${fmt(upcoming[0].at)}.`);

  const problems: Problem[] = [...groups.entries()].map(([text, names]) => ({ text, names }));
  const minutes = istMinutes(input.now);
  if (input.agents) {
    if (!input.agents.some((a) => a.agent === "prospect-researcher") && minutes > 11 * 60) {
      problems.push({ text: "No run log from the prospect researcher today (it runs at 09:30).", names: [] });
    }
    if (!input.agents.some((a) => a.agent === "aeo-audit-engine") && minutes > 8 * 60) {
      problems.push({ text: "No run log from the citation tracker today (it runs at 06:00).", names: [] });
    }
  } else {
    problems.push({ text: "Today's agent logs could not be read.", names: [] });
  }

  const funnel = [
    { label: "Qualified", count: qualified.length },
    { label: "Approved", count: approvedList.length },
    { label: "Emailed", count: emailed },
    { label: "Replied", count: replied },
    { label: "Call booked", count: calls },
    { label: "Won", count: won },
  ];
  let funnelNote: string | null = null;
  if (callList.length) {
    funnelNote = `${callList.length} approved ${callList.length === 1 ? "business has" : "businesses have"} only a phone number, so ${callList.length === 1 ? "it" : "they"} can't be emailed; ${callList.length === 1 ? "it gets" : "they get"} the WhatsApp first message once Meta approves the app.${waitingForEmail ? ` ${waitingForEmail} more ${waitingForEmail === 1 ? "is" : "are"} waiting for a free slot under the daily email limit.` : ""}`;
  } else if (waitingForEmail) {
    funnelNote = `${waitingForEmail} approved ${waitingForEmail === 1 ? "business is" : "businesses are"} waiting for a free slot under the daily email limit.`;
  }

  sentRows.sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  return {
    generatedAt: input.now.toISOString(),
    today: { sent: sentToday, cap: input.capToday, replies: repliesToday, callsBooked: upcoming.length, nextCall: upcoming[0] ? `${upcoming[0].company}, ${fmt(upcoming[0].at)}` : null },
    funnel,
    funnelNote,
    waiting,
    calls: callList,
    problems,
    outbox: sentRows.slice(0, 30),
    agents: input.agents,
    spend: input.spend,
  };
}

function istMinutes(now: Date): number {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function fmt(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

function timeOnly(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

function dayOnly(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

const AGENT_NAMES: Record<string, string> = {
  "aeo-audit-engine": "Citation tracker and audits",
  "prospect-researcher": "Prospect researcher",
  "outreach-sequencer": "Outreach",
  "chief-of-staff": "Chief of staff",
  "web-builder": "Web builder",
  "creative-director": "Creative director",
};

export function agentName(key: string): string {
  if (AGENT_NAMES[key]) return AGENT_NAMES[key];
  const words = key.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** "Tick 2026-11-24T08:00:00.000Z (live)" reads "Tick 1:30 pm IST (live)". */
export function readableTimes(text: string): string {
  return String(text || "").replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g, (iso) => `${timeOnly(iso)} IST`);
}

const PRODUCT_NAMES: Record<string, string> = { truevisible: "TrueVisible", tgl_ops: "Research and audits" };

function callItem(c: CallRow): string {
  return `<li><div><b>${esc(c.company)}</b><span class="sub">${esc([c.type, c.city].filter(Boolean).join(", "))}</span>${c.check ? `<span class="chk">${esc(c.check)}</span>` : `<span class="chk wait">AI check not run yet</span>`}</div><span class="fit" title="Fit score">fit ${c.fit}</span></li>`;
}

/** The part of the page that refreshes. */
export function renderLiveMain(v: LiveView): string {
  const full = v.today.sent >= v.today.cap && v.today.cap > 0;
  const stats = `<ul class="stats">
<li><a href="#outbox"><b>${v.today.sent}<small> of ${v.today.cap}</small></b><span>${full ? "emails sent today, limit reached" : "emails sent today"}</span></a></li>
<li><a href="#waiting"><b>${v.today.replies}</b><span>${v.today.replies === 1 ? "reply today" : "replies today"}</span></a></li>
<li><a href="#waiting"><b>${v.today.callsBooked}</b><span>${v.today.nextCall ? `next: ${esc(v.today.nextCall)}` : "calls coming up"}</span></a></li>
<li><a href="#spend"><b>${v.spend ? esc(rupees(v.spend.monthInr)) : "Not available"}</b><span>${v.spend ? `AI and search this month, ${esc(rupees(v.spend.todayInr))} today` : "spend could not be read"}</span></a></li>
</ul>`;

  const waiting = v.waiting.length ? `<ol class="todo">${v.waiting.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : `<p class="ok">Nothing is waiting on you.</p>`;

  const problems = v.problems.length
    ? `<ul class="probs">${v.problems
        .map((p) => `<li><p>${esc(p.text)}</p>${p.names.length ? `<p class="names">${esc(p.names.join(", "))}</p>` : ""}</li>`)
        .join("")}</ul>`
    : `<p class="ok">Nothing is wrong right now.</p>`;

  const calls = v.calls.length
    ? `<p class="lead">Approved businesses with no email address. Their first message is the WhatsApp note, once Meta approves the app. Each gets its AI check in advance, a few each day, so the message is ready. Highest fit first.</p>
<ul class="calls">${v.calls.slice(0, 10).map(callItem).join("")}</ul>${
        v.calls.length > 10 ? `<details><summary>Show ${v.calls.length - 10} more</summary><ul class="calls">${v.calls.slice(10).map(callItem).join("")}</ul></details>` : ""
      }`
    : `<p class="ok">No approved business is waiting for WhatsApp.</p>`;

  const max = Math.max(1, ...v.funnel.map((f) => f.count));
  const funnel = v.funnel
    .map((f, i) => {
      const prev = i > 0 ? v.funnel[i - 1].count : 0;
      const share = i > 0 && prev > 0 ? `${Math.round((f.count / prev) * 100)}%` : "";
      return `<li><span class="lbl">${esc(f.label)}</span><span class="bar" aria-hidden="true"><i style="width:${f.count ? Math.max(2, Math.round((f.count / max) * 100)) : 0}%"></i></span><b>${f.count}</b><span class="pct">${share}</span></li>`;
    })
    .join("");

  const todays = v.outbox.filter((r) => r.today);
  const earlier = v.outbox.filter((r) => !r.today);
  const row = (r: OutboxRow) =>
    `<tr><td><b>${esc(r.company)}</b>${r.city ? `<span class="sub">${esc(r.city)}</span>` : ""}</td><td>${esc(r.what)}</td><td class="when">${esc(r.today ? timeOnly(r.sentAt) : dayOnly(r.sentAt))}</td></tr>`;
  const outbox = v.outbox.length
    ? `<table><thead><tr><th>Business</th><th>Message</th><th>When</th></tr></thead>
${todays.length ? `<tbody><tr class="grp"><th colspan="3">Today</th></tr>${todays.map(row).join("")}</tbody>` : ""}
${earlier.length ? `<tbody><tr class="grp"><th colspan="3">Earlier</th></tr>${earlier.slice(0, 6).map(row).join("")}</tbody>` : ""}
</table>${earlier.length > 6 ? `<details><summary>Show ${earlier.length - 6} earlier</summary><table><tbody>${earlier.slice(6).map(row).join("")}</tbody></table></details>` : ""}
<p class="foot">The full text of every email is in #revenue.</p>`
    : `<p class="ok">Nothing sent yet.</p>`;

  const agents =
    v.agents === null
      ? `<p class="ok">Today's agent logs could not be read.</p>`
      : v.agents.length
        ? `<ul class="agents">${v.agents.map((a) => `<li><b>${esc(agentName(a.agent))}</b><span>${esc(readableTimes(a.last))}</span></li>`).join("")}</ul>`
        : `<p class="ok">No agent has saved a log today yet.</p>`;

  const parts = v.spend ? Object.entries(v.spend.byProduct).filter(([, n]) => n > 0) : [];
  const spend = v.spend
    ? `${parts.length ? `<ul class="spend">${parts.map(([k, n]) => `<li><span>${esc(PRODUCT_NAMES[k] || k)}</span><b>${esc(rupees(n))}</b></li>`).join("")}</ul>` : `<p class="ok">Nothing recorded this month.</p>`}
<p class="foot">Recorded spend on AI engines, models and Google search. Research and outreach audits are recorded from 24 Nov.</p>`
    : `<p class="ok">Spend could not be read.</p>`;

  return `${stats}
<div class="grid">
<section class="panel" id="waiting"><h2>Waiting on you</h2>${waiting}</section>
<section class="panel" id="problems"><h2>Problems</h2>${problems}</section>
<section class="panel wide" id="calls"><h2>Waiting for WhatsApp${v.calls.length ? ` <span class="count">${v.calls.length}</span>` : ""}</h2>${calls}</section>
<section class="panel wide" id="funnel"><h2>Funnel</h2><ol class="funnel">${funnel}</ol>${v.funnelNote ? `<p class="note">${esc(v.funnelNote)}</p>` : ""}</section>
<section class="panel wide" id="outbox"><h2>Outbox</h2>${outbox}</section>
<section class="panel" id="agents"><h2>What the agents did today</h2>${agents}</section>
<section class="panel" id="spend"><h2>Spend this month</h2>${spend}</section>
</div>
<p class="foot updated">Updated ${esc(timeOnly(v.generatedAt))}. The page refreshes every minute while it is open.</p>`;
}

export function renderLivePage(v: LiveView, email: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Today | The Growth Lab</title>
<style>
@font-face{font-family:"DM Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url(/book/assets/dm-sans-latin.woff2) format("woff2")}
@font-face{font-family:"Fraunces";font-style:italic;font-weight:400 700;font-display:swap;src:url(/book/assets/fraunces-latin-italic.woff2) format("woff2")}
:root{--paper:#F5F0E8;--paper-2:#EDE8DD;--white:#FFFDF9;--ink:#2C2118;--ink-2:#3A3028;--mute:#6B625B;--grey:#D9D1C5;--terra:#C75B3B;--terra-text:#B94B35;--coral:#E8846B;--sage:#7BA668;--mustard:#E8B44C;--teal:#4A9B8E;--serif:"Fraunces",Georgia,serif;--sans:"DM Sans",system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
a{color:inherit}p{margin:0}h1,h2{margin:0;font-weight:600;letter-spacing:-.02em}
.hd{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 20px;border-bottom:1px solid var(--paper-2)}
.hd img{height:34px;display:block}.nav{display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px;font-size:.88rem;color:var(--mute)}
.nav a{text-decoration:none;font-weight:600;color:var(--ink-2)}.nav a:hover{text-decoration:underline}.nav a[aria-current]{color:var(--terra-text);text-decoration:underline;text-underline-offset:4px}
.top{padding:22px 20px 4px;display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:12px;max-width:1240px}
h1{font-size:clamp(1.8rem,4vw,2.5rem);letter-spacing:-.032em}.acc{font-family:var(--serif);font-style:italic;font-weight:400;color:var(--terra-text)}
.refresh{font:600 .85rem var(--sans);background:var(--white);color:var(--ink);border:2px solid var(--ink);border-radius:10px;padding:7px 14px;cursor:pointer;box-shadow:2px 2px 0 var(--grey)}
.refresh:active{transform:translate(1px,1px);box-shadow:1px 1px 0 var(--grey)}
main{padding:14px 20px 40px;max-width:1240px}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 16px;padding:0;list-style:none}
.stats a{display:block;height:100%;text-decoration:none;background:var(--white);border:2px solid var(--ink);border-radius:12px;padding:12px 16px;box-shadow:3px 3px 0 var(--teal)}
.stats li:nth-child(2) a{box-shadow:3px 3px 0 var(--coral)}.stats li:nth-child(3) a{box-shadow:3px 3px 0 var(--terra)}.stats li:nth-child(4) a{box-shadow:3px 3px 0 var(--sage)}
.stats a:hover{transform:translate(-1px,-1px)}
.stats b{display:block;font-size:1.6rem;letter-spacing:-.02em;line-height:1.2}.stats small{font-size:.9rem;font-weight:500;color:var(--mute)}.stats span{display:block;font-size:.82rem;color:var(--mute);margin-top:2px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
.panel{background:var(--white);border:2px solid var(--ink);border-radius:14px;padding:16px 18px;scroll-margin-top:12px}.panel.wide{grid-column:1/-1}
.panel h2{font-size:1.02rem;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.count{font-size:.75rem;background:var(--ink);color:var(--paper);border-radius:999px;padding:1px 9px}
.lead{color:var(--mute);font-size:.88rem;margin-bottom:6px}
.todo{margin:0;padding-left:20px}.todo li{margin:6px 0;padding-left:2px}
.probs{list-style:none;margin:0;padding:0}.probs li{border-left:3px solid var(--terra);padding:2px 0 2px 10px;margin:8px 0}.names{color:var(--mute);font-size:.86rem;margin-top:2px}
.ok{color:var(--mute)}
.calls{list-style:none;margin:0;padding:0}.calls li{display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px 14px;padding:9px 0;border-bottom:1px solid var(--paper-2)}
.sub{display:block;font-size:.8rem;color:var(--mute)}.fit{font-size:.75rem;font-weight:600;border:1.5px solid var(--grey);border-radius:999px;padding:1px 8px;color:var(--mute);white-space:nowrap}
.chk{display:block;font-size:.86rem;color:var(--ink-2);margin-top:3px}.chk.wait{color:var(--mute);font-style:italic}
.funnel{list-style:none;margin:0;padding:0}.funnel li{display:grid;grid-template-columns:110px 1fr 44px 44px;align-items:center;gap:10px;margin:6px 0}
.funnel .lbl{font-size:.9rem}.funnel .bar{background:var(--paper-2);border-radius:999px;height:14px;overflow:hidden}.funnel .bar i{display:block;height:100%;background:var(--teal);border-radius:999px}
.funnel b{text-align:right}.funnel .pct{font-size:.78rem;color:var(--mute);text-align:right}
.note{margin-top:12px;background:var(--paper);border-radius:10px;padding:9px 12px;font-size:.9rem}
table{width:100%;border-collapse:collapse;font-size:.9rem}thead th{text-align:left;font-size:.75rem;color:var(--mute);font-weight:600;padding:4px 8px 6px 0;border-bottom:1.5px solid var(--grey)}
td{padding:7px 8px 7px 0;border-bottom:1px solid var(--paper-2);vertical-align:top}td b{font-weight:600}.when{white-space:nowrap;color:var(--ink-2)}
.grp th{text-align:left;font-size:.78rem;color:var(--terra-text);font-weight:600;padding:12px 0 4px}
details{margin-top:8px}summary{cursor:pointer;color:var(--mute);font-weight:600;font-size:.88rem}
.agents,.spend{list-style:none;margin:0;padding:0}.agents li{padding:7px 0;border-bottom:1px solid var(--paper-2)}.agents b{display:block;font-weight:600}.agents span{font-size:.88rem;color:var(--ink-2)}
.spend li{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--paper-2)}
.foot{color:var(--mute);font-size:.8rem;margin-top:10px}
:focus-visible{outline:3px solid var(--teal);outline-offset:2px}
@media (max-width:820px){.grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:520px){.funnel li{grid-template-columns:86px 1fr 36px 36px}.hd{flex-wrap:wrap}}
@media (prefers-reduced-motion:reduce){.stats a:hover{transform:none}}
</style></head><body>
<header class="hd"><a href="/pipeline/live"><img src="/book/assets/logo.png" alt="The Growth Lab" width="60" height="34"></a>
<nav class="nav" aria-label="Pages"><a href="/pipeline/live" aria-current="page">Today</a><a href="/pipeline/build">Build</a><a href="/pipeline">Pipeline</a><a href="/pipeline/whatsapp/console">WhatsApp</a><span>${esc(email)}</span><a href="/pipeline/logout">Sign out</a></nav></header>
<div class="top"><h1>Today at <span class="acc">The Growth Lab.</span></h1><button class="refresh" type="button" id="refresh">Refresh</button></div>
<main id="live" aria-live="polite">${renderLiveMain(v)}</main>
<script>
(function(){
  var busy=false;
  function load(){
    if(busy)return;busy=true;
    var b=document.getElementById("refresh");b.textContent="Refreshing";
    fetch("/pipeline/live?part=main",{credentials:"same-origin"}).then(function(r){return r.ok?r.text():null}).then(function(h){if(h)document.getElementById("live").innerHTML=h}).catch(function(){}).then(function(){busy=false;b.textContent="Refresh"});
  }
  document.getElementById("refresh").addEventListener("click",load);
  setInterval(function(){if(!document.hidden)load()},60000);
  document.addEventListener("visibilitychange",function(){if(!document.hidden)load()});
})();
</script>
</body></html>`;
}
