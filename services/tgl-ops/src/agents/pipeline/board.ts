// services/tgl-ops/src/agents/pipeline/board.ts
// The private board at /pipeline, in the website's visual system (same as /book): a column per stage, a card per
// deal, totals on top. Read-only: stages move through the Slack buttons, so there is one place to change a deal.
import { cleanBusinessName } from "../outreach-sequencer/names.js";
import { money, STAGE_LABEL, STAGES, type Currency, type Deal, type Stage } from "./stages.js";

const SITE = "https://thegrowthlab.co.in";
const SOURCE_LABEL: Record<Deal["source"], string> = { outreach: "Outreach", site: "Website audit form", booking: "Booking page", manual: "Added by hand" };
const SHADOW: Record<Stage, string> = {
  in_outreach: "var(--grey)", audit_requested: "var(--mustard)", replied: "var(--teal)", call_booked: "var(--coral)",
  call_done: "var(--sage)", proposal_sent: "var(--terra)", won: "var(--sage)", lost: "var(--grey)",
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ist(iso: string, withTime = true): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", ...(withTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}) }).format(new Date(iso));
}

export function daysInStage(d: Deal, now: Date): number {
  const last = [...(d.history || [])].reverse().find((h) => h.stage === d.stage);
  const since = last ? new Date(last.at).getTime() : now.getTime();
  return Math.max(0, Math.floor((now.getTime() - since) / 86400000));
}

export interface BoardTotals {
  open: number;
  callsBooked: number;
  proposalsOut: number;
  proposedMonthly: Partial<Record<Currency, number>>;
  wonMonthly: Partial<Record<Currency, number>>;
}

export function totals(deals: Deal[]): BoardTotals {
  const t: BoardTotals = { open: 0, callsBooked: 0, proposalsOut: 0, proposedMonthly: {}, wonMonthly: {} };
  for (const d of deals) {
    if (d.stage !== "won" && d.stage !== "lost") t.open++;
    if (d.stage === "call_booked") t.callsBooked++;
    const cur = (d.currency || "INR") as Currency;
    if (d.stage === "proposal_sent" && d.amount) {
      t.proposalsOut++;
      t.proposedMonthly[cur] = (t.proposedMonthly[cur] || 0) + Number(d.amount);
    }
    if (d.stage === "won" && d.amount) t.wonMonthly[cur] = (t.wonMonthly[cur] || 0) + Number(d.amount);
  }
  return t;
}

function sums(m: Partial<Record<Currency, number>>): string {
  const parts = (["INR", "USD"] as Currency[]).filter((c) => m[c]).map((c) => money(m[c] as number, c).replace(" a month", ""));
  return parts.length ? parts.join(" + ") : "0";
}

function card(d: Deal, now: Date, auditLine?: string): string {
  const days = daysInStage(d, now);
  const facts: string[] = [];
  if (d.contact_name) facts.push(esc(d.contact_name));
  if (d.city) facts.push(esc(d.city));
  const meta = [
    `<span>${esc(SOURCE_LABEL[d.source] || d.source)}</span>`,
    `<span>${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`} here</span>`,
  ];
  const extra: string[] = [];
  if (d.stage === "call_booked" && d.call_at) extra.push(`<p class="hi">Call ${esc(ist(d.call_at))}</p>`);
  if (d.amount && d.currency) extra.push(`<p class="hi">${esc(money(Number(d.amount), d.currency))}</p>`);
  if (d.no_show) extra.push(`<p class="note">Missed a booked call</p>`);
  if (d.stage === "lost" && d.lost_reason) extra.push(`<p class="note">${esc(d.lost_reason)}</p>`);
  const history = (d.history || []).map((h) => `<li><b>${esc(STAGE_LABEL[h.stage] || h.stage)}</b> ${esc(ist(h.at))}${h.by && h.by !== "system" ? `, ${esc(h.by)}` : ""}${h.note ? `: ${esc(h.note)}` : ""}</li>`).join("");
  return `<article class="card" style="--sh:${SHADOW[d.stage]}">
<h3>${esc(cleanBusinessName(d.company))}</h3>
${facts.length ? `<p class="who">${facts.join(", ")}</p>` : ""}
${extra.join("")}
<p class="meta">${meta.join("")}</p>
<details><summary>Details</summary>
${d.contact_email ? `<p class="mail">${esc(d.contact_email)}</p>` : ""}
${auditLine ? `<p class="audit">${esc(auditLine)}</p>` : ""}
<ol class="hist">${history}</ol>
</details>
</article>`;
}

export function renderBoard(deals: Deal[], opts: { now: Date; email: string; audits?: Record<string, string> }): string {
  const t = totals(deals);
  const cols = STAGES.map((stage) => {
    const list = deals.filter((d) => d.stage === stage);
    const body = list.length ? list.map((d) => card(d, opts.now, d.prospect_id ? opts.audits?.[d.prospect_id] : undefined)).join("\n") : `<p class="empty">Nothing here</p>`;
    return `<section class="col${stage === "lost" ? " muted" : ""}" aria-label="${esc(STAGE_LABEL[stage])}"><h2>${esc(STAGE_LABEL[stage])} <span>${list.length}</span></h2>${body}</section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Pipeline | The Growth Lab</title>
<style>
@font-face{font-family:"DM Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url(/book/assets/dm-sans-latin.woff2) format("woff2")}
@font-face{font-family:"Fraunces";font-style:italic;font-weight:400 700;font-display:swap;src:url(/book/assets/fraunces-latin-italic.woff2) format("woff2")}
:root{--paper:#F5F0E8;--paper-2:#EDE8DD;--white:#FFFDF9;--ink:#2C2118;--ink-2:#3A3028;--mute:#6B625B;--grey:#D9D1C5;--terra:#C75B3B;--terra-text:#B94B35;--coral:#E8846B;--sage:#7BA668;--mustard:#E8B44C;--teal:#4A9B8E;--serif:"Fraunces",Georgia,serif;--sans:"DM Sans",system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
a{color:inherit}p{margin:0}h1,h2,h3{margin:0;font-weight:600;letter-spacing:-.02em}
.hd{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 20px;border-bottom:1px solid var(--paper-2)}
.hd img{height:34px;display:block}.hd .me{font-size:.85rem;color:var(--mute)}.hd .me a{margin-left:10px}
.top{padding:24px 20px 8px;display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:16px 32px}
h1{font-size:clamp(1.8rem,4vw,2.6rem);letter-spacing:-.032em}.acc{font-family:var(--serif);font-style:italic;font-weight:400;color:var(--terra-text)}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:0;padding:0;list-style:none}
.stats li{background:var(--white);border:2px solid var(--ink);border-radius:12px;padding:8px 14px;box-shadow:3px 3px 0 var(--teal)}
.stats li:nth-child(2){box-shadow:3px 3px 0 var(--coral)}.stats li:nth-child(3){box-shadow:3px 3px 0 var(--terra)}.stats li:nth-child(4){box-shadow:3px 3px 0 var(--sage)}
.stats b{display:block;font-size:1.25rem;letter-spacing:-.02em}.stats span{font-size:.78rem;color:var(--mute)}
.board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(250px,1fr);gap:14px;overflow-x:auto;padding:18px 20px 40px;align-items:start}
.col{background:var(--paper-2);border-radius:16px;padding:12px;min-height:120px}
.col h2{font-size:.95rem;display:flex;justify-content:space-between;align-items:center;margin:2px 4px 12px}
.col h2 span{font-size:.78rem;background:var(--ink);color:var(--paper);border-radius:999px;padding:1px 9px}
.col.muted{opacity:.75}
.card{background:var(--white);border:2px solid var(--ink);border-radius:12px;padding:12px;box-shadow:4px 4px 0 var(--sh);margin-bottom:12px}
.card h3{font-size:1rem;line-height:1.25}.who{color:var(--ink-2);font-size:.88rem;margin-top:3px}
.hi{font-weight:600;margin-top:8px}.note{margin-top:8px;font-size:.85rem;color:var(--terra-text)}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.meta span{font-size:.72rem;font-weight:600;border:1.5px solid var(--grey);border-radius:999px;padding:1px 8px;color:var(--mute)}
details{margin-top:10px;font-size:.85rem}summary{cursor:pointer;color:var(--mute);font-weight:600}
.mail,.audit{margin-top:8px;overflow-wrap:anywhere}.hist{margin:8px 0 0;padding-left:18px;color:var(--ink-2)}.hist li{margin:3px 0}
.empty{color:var(--mute);font-size:.85rem;padding:6px 4px}
:focus-visible{outline:3px solid var(--teal);outline-offset:2px}
</style></head><body>
<header class="hd"><a href="${SITE}/"><img src="/book/assets/logo.png" alt="The Growth Lab" width="60" height="34"></a><p class="me">${esc(opts.email)}<a href="/pipeline/whatsapp/console">WhatsApp</a><a href="/pipeline/logout">Sign out</a></p></header>
<div class="top"><h1>Sales <span class="acc">pipeline.</span></h1>
<ul class="stats">
<li><b>${t.open}</b><span>open deals</span></li>
<li><b>${t.callsBooked}</b><span>calls booked</span></li>
<li><b>${esc(sums(t.proposedMonthly))}</b><span>${t.proposalsOut} proposal${t.proposalsOut === 1 ? "" : "s"} out, a month</span></li>
<li><b>${esc(sums(t.wonMonthly))}</b><span>won, a month</span></li>
</ul></div>
<main class="board">${cols}</main>
</body></html>`;
}

export function loginPage(message?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Pipeline | The Growth Lab</title>
<style>@font-face{font-family:"DM Sans";font-weight:400 700;src:url(/book/assets/dm-sans-latin.woff2) format("woff2")}body{margin:0;background:#F5F0E8;color:#2C2118;font-family:"DM Sans",system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px}main{max-width:380px;text-align:center}img{height:44px}h1{font-size:1.6rem;letter-spacing:-.03em;margin:22px 0 8px}p{color:#3A3028;margin:0 0 22px}.msg{background:#F8E2DA;border-left:3px solid #C75B3B;padding:10px;text-align:left;border-radius:0 8px 8px 0}a.btn{display:inline-block;font-weight:600;padding:14px 22px;border:2px solid #2C2118;border-radius:14px;background:#2C2118;color:#F5F0E8;text-decoration:none;box-shadow:4px 4px 0 #C75B3B}</style></head>
<body><main><img src="/book/assets/logo.png" alt="The Growth Lab"><h1>Sales pipeline</h1><p>Private. Sign in with the Google account that has access.</p>${message ? `<p class="msg" role="alert">${esc(message)}</p>` : ""}<a class="btn" href="/pipeline/connect">Sign in with Google</a></main></body></html>`;
}
