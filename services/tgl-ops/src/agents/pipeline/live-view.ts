// services/tgl-ops/src/agents/pipeline/live-view.ts
// The live view at /pipeline/live (24 Nov 2026, modelled on the My LabOS /ops/live page): today's numbers, the
// funnel from qualified to won, what is waiting on the Architect, the outbox, what each agent last did, problems,
// and AI spend. Everything is counted from data the service already keeps; nothing is estimated.
// buildLiveView is pure, so every number on the page is tested without a database.
import { plainError } from "../../lib/plain-error.js";
import { cleanBusinessName } from "../outreach-sequencer/names.js";
import type { Deal } from "./stages.js";

export interface LiveProspect {
  id: string;
  company: string;
  city?: string | null;
  category?: string | null;
  status: string;
  fit_score?: number | null;
  created_at?: string | null;
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
  } | null;
}

export interface AgentLine {
  agent: string;
  /** The last heading the agent wrote in today's log, e.g. "Run, 09:30 IST (Ludhiana, hotels)". */
  last: string;
}

export interface LiveInput {
  now: Date;
  prospects: LiveProspect[];
  deals: Deal[];
  agents: AgentLine[] | null;
  spend: { todayUsd: number; monthUsd: number } | null;
  usdInr: number;
  /** Emails allowed today (the warm-up cap). */
  capToday: number;
}

export interface OutboxRow {
  company: string;
  city: string;
  touch: number;
  channel: string;
  sentAt: string;
}

export interface LiveView {
  generatedAt: string;
  today: { sent: number; cap: number; replies: number; callsBooked: number; nextCall: string | null };
  funnel: { label: string; count: number }[];
  waiting: string[];
  outbox: OutboxRow[];
  agents: AgentLine[] | null;
  problems: string[];
  spend: { todayInr: number; monthInr: number } | null;
}

export function istDate(iso: string | Date): string {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return new Date(t + 330 * 60_000).toISOString().slice(0, 10);
}

const CALL_STAGES = new Set(["call_booked", "call_done", "proposal_sent", "won"]);

export function buildLiveView(input: LiveInput): LiveView {
  const today = istDate(input.now);
  const qualified = input.prospects.filter((p) => p.status !== "bench");
  const sentRows: OutboxRow[] = [];
  let sentToday = 0;
  let repliesToday = 0;
  let emailed = 0;
  let replied = 0;
  let paused = 0;
  const pauseReasons = new Map<string, number>();

  for (const p of qualified) {
    const o = p.signals?.outreach;
    if (!o) continue;
    let any = false;
    for (const t of o.touches || []) {
      if (t.dry_run || !t.sent_at) continue;
      any = true;
      sentRows.push({ company: cleanBusinessName(p.company), city: p.city || "", touch: t.n, channel: String(t.channel || "email").toLowerCase(), sentAt: t.sent_at });
      if (istDate(t.sent_at) === today) sentToday++;
    }
    if (any) emailed++;
    if (o.last_reply_at || o.state === "replied") replied++;
    if (o.last_reply_at && istDate(o.last_reply_at) === today) repliesToday++;
    // A business the Architect rejected stays paused for good; that is not a problem to report.
    if (o.state === "paused" && p.status !== "rejected") {
      paused++;
      const why = plainError(String(o.pause_reason || "no reason recorded").replace(/^touch \d+: /, ""));
      pauseReasons.set(why, (pauseReasons.get(why) || 0) + 1);
    }
  }

  const approved = qualified.filter((p) => p.status === "reviewed" || p.status === "handed_to_outreach").length;
  const awaiting = qualified.filter((p) => p.status === "new").length;
  const calls = input.deals.filter((d) => CALL_STAGES.has(d.stage)).length;
  const won = input.deals.filter((d) => d.stage === "won").length;
  const upcoming = input.deals
    .filter((d) => d.stage === "call_booked" && d.call_at && Date.parse(d.call_at) > input.now.getTime())
    .map((d) => ({ at: d.call_at as string, company: cleanBusinessName(d.company) }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const replyDeals = input.deals.filter((d) => d.stage === "replied").length;

  const waiting: string[] = [];
  if (awaiting) waiting.push(`${awaiting} ${awaiting === 1 ? "business is" : "businesses are"} waiting for your approval in #revenue.`);
  if (replyDeals) waiting.push(`${replyDeals} ${replyDeals === 1 ? "reply needs" : "replies need"} an answer from you (see the pipeline).`);
  if (upcoming[0]) waiting.push(`Next call: ${upcoming[0].company}, ${fmt(upcoming[0].at)}.`);

  const problems: string[] = [];
  for (const [why, n] of pauseReasons) problems.push(`${n} ${n === 1 ? "sequence is" : "sequences are"} paused: ${why}.`);
  if (input.agents && !input.agents.some((a) => a.agent === "prospect-researcher") && nowIstMinutes(input.now) > 11 * 60) {
    problems.push("The prospect researcher has not reported a run today.");
  }
  if (input.agents && !input.agents.some((a) => a.agent === "aeo-audit-engine") && nowIstMinutes(input.now) > 8 * 60) {
    problems.push("The citation tracker has not reported a run today.");
  }
  if (!input.agents) problems.push("Today's agent logs could not be read.");

  sentRows.sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  return {
    generatedAt: input.now.toISOString(),
    today: { sent: sentToday, cap: input.capToday, replies: repliesToday, callsBooked: upcoming.length, nextCall: upcoming[0] ? `${upcoming[0].company}, ${fmt(upcoming[0].at)}` : null },
    funnel: [
      { label: "Qualified", count: qualified.length },
      { label: "Approved", count: approved },
      { label: "Emailed", count: emailed },
      { label: "Replied", count: replied },
      { label: "Call booked", count: calls },
      { label: "Won", count: won },
    ],
    waiting,
    outbox: sentRows.slice(0, 15),
    agents: input.agents,
    problems,
    spend: input.spend ? { todayInr: input.spend.todayUsd * input.usdInr, monthInr: input.spend.monthUsd * input.usdInr } : null,
  };
}

function nowIstMinutes(now: Date): number {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function fmt(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

const AGENT_NAMES: Record<string, string> = {
  "aeo-audit-engine": "Citation tracker",
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

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rupees(n: number): string {
  return `₹${n < 100 ? n.toFixed(0) : Math.round(n).toLocaleString("en-IN")}`;
}

/** The part of the page that refreshes. */
export function renderLiveMain(v: LiveView): string {
  const max = Math.max(1, ...v.funnel.map((f) => f.count));
  const funnel = v.funnel
    .map((f, i) => {
      const prev = i > 0 ? v.funnel[i - 1].count : 0;
      const share = i > 0 && prev > 0 ? `<span class="pct">${Math.round((f.count / prev) * 100)}% of ${esc(v.funnel[i - 1].label.toLowerCase())}</span>` : "";
      return `<li><span class="lbl">${esc(f.label)}</span><span class="bar"><i style="width:${Math.max(f.count ? 2 : 0, Math.round((f.count / max) * 100))}%"></i></span><b>${f.count}</b>${share}</li>`;
    })
    .join("");
  const outbox = v.outbox.length
    ? `<table><thead><tr><th>Business</th><th>Email</th><th>Sent</th></tr></thead><tbody>${v.outbox
        .map((r) => `<tr><td>${esc(r.company)}${r.city ? `<span class="sub">${esc(r.city)}</span>` : ""}</td><td>${r.channel === "whatsapp" ? "WhatsApp" : `Email ${r.touch}`}</td><td>${esc(fmt(r.sentAt))}</td></tr>`)
        .join("")}</tbody></table><p class="foot">The full text of every email is in #revenue.</p>`
    : `<p class="empty">Nothing sent yet.</p>`;
  const agents = v.agents === null
    ? `<p class="empty">Today's agent logs could not be read.</p>`
    : v.agents.length
      ? `<ul class="agents">${v.agents.map((a) => `<li><b>${esc(agentName(a.agent))}</b><span>${esc(a.last)}</span></li>`).join("")}</ul>`
      : `<p class="empty">No agent has reported today yet.</p>`;
  const list = (items: string[], empty: string) => (items.length ? `<ul class="lines">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p class="empty">${esc(empty)}</p>`);

  return `<ul class="stats">
<li><b>${v.today.sent}<small> of ${v.today.cap}</small></b><span>emails sent today</span></li>
<li><b>${v.today.replies}</b><span>replies today</span></li>
<li><b>${v.today.callsBooked}</b><span>calls coming up</span></li>
<li><b>${v.spend ? esc(rupees(v.spend.monthInr)) : "unknown"}</b><span>AI spend this month${v.spend ? `, ${esc(rupees(v.spend.todayInr))} today` : ""}</span></li>
</ul>
<div class="grid">
<section class="panel wide"><h2>Funnel</h2><ol class="funnel">${funnel}</ol></section>
<section class="panel"><h2>Waiting on you</h2>${list(v.waiting, "Nothing is waiting on you.")}</section>
<section class="panel"><h2>Problems</h2>${list(v.problems, "Nothing is wrong right now.")}</section>
<section class="panel wide"><h2>Outbox</h2>${outbox}</section>
<section class="panel wide"><h2>What the agents did today</h2>${agents}</section>
</div>
<p class="foot">Updated ${esc(fmt(v.generatedAt))}. Refreshes every minute.</p>`;
}

export function renderLivePage(v: LiveView, email: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Live | The Growth Lab</title>
<style>
@font-face{font-family:"DM Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url(/book/assets/dm-sans-latin.woff2) format("woff2")}
@font-face{font-family:"Fraunces";font-style:italic;font-weight:400 700;font-display:swap;src:url(/book/assets/fraunces-latin-italic.woff2) format("woff2")}
:root{--paper:#F5F0E8;--paper-2:#EDE8DD;--white:#FFFDF9;--ink:#2C2118;--ink-2:#3A3028;--mute:#6B625B;--grey:#D9D1C5;--terra:#C75B3B;--terra-text:#B94B35;--coral:#E8846B;--sage:#7BA668;--mustard:#E8B44C;--teal:#4A9B8E;--serif:"Fraunces",Georgia,serif;--sans:"DM Sans",system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
a{color:inherit}p{margin:0}h1,h2{margin:0;font-weight:600;letter-spacing:-.02em}
.hd{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 20px;border-bottom:1px solid var(--paper-2)}
.hd img{height:34px;display:block}.hd .me{font-size:.85rem;color:var(--mute)}.hd .me a{margin-left:10px}
.top{padding:24px 20px 6px}h1{font-size:clamp(1.8rem,4vw,2.6rem);letter-spacing:-.032em}.acc{font-family:var(--serif);font-style:italic;font-weight:400;color:var(--terra-text)}
main{padding:12px 20px 40px;max-width:1200px}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 18px;padding:0;list-style:none}
.stats li{background:var(--white);border:2px solid var(--ink);border-radius:12px;padding:10px 16px;box-shadow:3px 3px 0 var(--teal);min-width:150px}
.stats li:nth-child(2){box-shadow:3px 3px 0 var(--coral)}.stats li:nth-child(3){box-shadow:3px 3px 0 var(--terra)}.stats li:nth-child(4){box-shadow:3px 3px 0 var(--sage)}
.stats b{display:block;font-size:1.5rem;letter-spacing:-.02em}.stats small{font-size:.85rem;font-weight:500;color:var(--mute)}.stats span{font-size:.8rem;color:var(--mute)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.panel{background:var(--white);border:2px solid var(--ink);border-radius:14px;padding:16px}.panel.wide{grid-column:1/-1}
.panel h2{font-size:1rem;margin-bottom:12px}
.funnel{list-style:none;margin:0;padding:0}.funnel li{display:grid;grid-template-columns:110px 1fr 48px;align-items:center;gap:10px;margin:7px 0}
.funnel .lbl{font-size:.9rem}.funnel .bar{background:var(--paper-2);border-radius:999px;height:14px;overflow:hidden}.funnel .bar i{display:block;height:100%;background:var(--teal);border-radius:999px}
.funnel b{text-align:right}.funnel .pct{grid-column:2/4;font-size:.75rem;color:var(--mute);margin-top:-6px}
.lines{margin:0;padding-left:18px}.lines li{margin:5px 0}
table{width:100%;border-collapse:collapse;font-size:.9rem}th{text-align:left;font-size:.75rem;color:var(--mute);font-weight:600;padding:4px 8px 6px 0;border-bottom:1.5px solid var(--grey)}
td{padding:7px 8px 7px 0;border-bottom:1px solid var(--paper-2);vertical-align:top}.sub{display:block;font-size:.78rem;color:var(--mute)}
.agents{list-style:none;margin:0;padding:0}.agents li{display:grid;grid-template-columns:180px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid var(--paper-2)}.agents b{font-weight:600}
.empty{color:var(--mute);font-size:.9rem}.foot{color:var(--mute);font-size:.8rem;margin-top:10px}
:focus-visible{outline:3px solid var(--teal);outline-offset:2px}
@media (max-width:560px){.agents li{grid-template-columns:1fr}.funnel li{grid-template-columns:90px 1fr 40px}}
</style></head><body>
<header class="hd"><a href="/pipeline"><img src="/book/assets/logo.png" alt="The Growth Lab" width="60" height="34"></a><p class="me">${esc(email)}<a href="/pipeline">Pipeline</a><a href="/pipeline/whatsapp/console">WhatsApp</a><a href="/pipeline/logout">Sign out</a></p></header>
<div class="top"><h1>Today at <span class="acc">The Growth Lab.</span></h1></div>
<main id="live" aria-live="polite">${renderLiveMain(v)}</main>
<script>
setInterval(function(){
  if (document.hidden) return;
  fetch("/pipeline/live?part=main",{credentials:"same-origin"}).then(function(r){return r.ok?r.text():null}).then(function(h){if(h)document.getElementById("live").innerHTML=h}).catch(function(){});
}, 60000);
</script>
</body></html>`;
}
