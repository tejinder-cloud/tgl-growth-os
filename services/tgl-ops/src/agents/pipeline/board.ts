// services/tgl-ops/src/agents/pipeline/board.ts
// The private board at /pipeline, in the website's visual system (same as /book): a column per stage, a card per
// deal, totals on top. Read-only: stages move through the Slack buttons, so there is one place to change a deal.
import { cleanBusinessName } from "../outreach-sequencer/names.js";
import { esc, renderShell } from "./shell.js";
import { money, STAGE_LABEL, STAGES, type Currency, type Deal, type Stage } from "./stages.js";

const SOURCE_LABEL: Record<Deal["source"], string> = { outreach: "Outreach", site: "Website audit form", booking: "Booking page", manual: "Added by hand" };
const SHADOW: Record<Stage, string> = {
  in_outreach: "var(--grey)", audit_requested: "var(--mustard)", replied: "var(--teal)", call_booked: "var(--coral)",
  call_done: "var(--sage)", proposal_sent: "var(--terra)", won: "var(--sage)", lost: "var(--grey)",
};


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

/** A role the researcher writes when no person is known; it is not a name, so the card does not show it. */
export function isPlaceholderContact(name: string | null | undefined): boolean {
  const n = String(name || "").trim();
  return !n || n.includes("/") || /dm unknown|^owner\b|lead doctor|contact found/i.test(n);
}

function card(d: Deal, now: Date, auditLine?: string): string {
  const days = daysInStage(d, now);
  const facts: string[] = [];
  if (!isPlaceholderContact(d.contact_name)) facts.push(esc(d.contact_name));
  if (d.city) facts.push(esc(d.city));
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
<details><summary>${esc(SOURCE_LABEL[d.source] || d.source)}, ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`} here</summary>
${d.contact_email ? `<p class="mail">${esc(d.contact_email)}</p>` : ""}
${auditLine ? `<p class="audit">${esc(auditLine)}</p>` : ""}
<ol class="hist">${history}</ol>
</details>
</article>`;
}

export const BOARD_CSS = `.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:0 0 16px;padding:0;list-style:none}
.stats li{background:var(--white);border:2px solid var(--ink);border-radius:12px;padding:12px 16px;box-shadow:3px 3px 0 var(--teal)}
.stats li:nth-child(2){box-shadow:3px 3px 0 var(--coral)}.stats li:nth-child(3){box-shadow:3px 3px 0 var(--terra)}.stats li:nth-child(4){box-shadow:3px 3px 0 var(--sage)}
.stats b{display:block;font-size:1.6rem;letter-spacing:-.02em;line-height:1.2}.stats span{display:block;font-size:.82rem;color:var(--mute);margin-top:2px}
.board{display:grid;grid-template-columns:repeat(7,minmax(150px,1fr));gap:10px;align-items:start;overflow-x:auto;padding-bottom:8px}
.col{background:var(--paper-2);border-radius:14px;padding:10px;min-height:110px;min-width:0}
.col h2{font-size:.86rem;display:flex;justify-content:space-between;align-items:center;gap:6px;margin:2px 2px 10px}
.col h2 span{font-size:.72rem;background:var(--ink);color:var(--paper);border-radius:999px;padding:1px 8px}
.card{background:var(--white);border:2px solid var(--ink);border-radius:10px;padding:9px 10px;box-shadow:3px 3px 0 var(--sh);margin-bottom:9px}
.card h3{font-size:.9rem;line-height:1.25;overflow-wrap:anywhere}.who{color:var(--ink-2);font-size:.8rem;margin-top:2px}
.hi{font-weight:600;margin-top:6px;font-size:.85rem}.note{margin-top:6px;font-size:.8rem;color:var(--terra-text)}
.card details{margin-top:6px;font-size:.8rem}.card summary{cursor:pointer;color:var(--mute);font-weight:600;font-size:.76rem;margin:0}
.mail,.audit{margin-top:6px;overflow-wrap:anywhere}.hist{margin:6px 0 0;padding-left:16px;color:var(--ink-2)}.hist li{margin:2px 0}
.empty{color:var(--mute);font-size:.8rem;padding:4px 2px}
.col details.more>summary{font-size:.8rem;margin:2px 2px 0}
.lost{margin-top:14px}
@media (max-width:900px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.board{grid-template-columns:repeat(7,200px)}}`;

const PER_COLUMN = 8;

export function renderBoardMain(deals: Deal[], opts: { now: Date; audits?: Record<string, string>; rejected?: Set<string> }): string {
  const shown = deals.filter((d) => !(d.prospect_id && opts.rejected?.has(d.prospect_id)));
  const t = totals(shown);
  const draw = (d: Deal) => card(d, opts.now, d.prospect_id ? opts.audits?.[d.prospect_id] : undefined);
  const cols = STAGES.filter((s) => s !== "lost").map((stage) => {
    const list = shown.filter((d) => d.stage === stage).sort((a, b) => daysInStage(b, opts.now) - daysInStage(a, opts.now));
    const head = list.slice(0, PER_COLUMN).map(draw).join("\n");
    const rest = list.slice(PER_COLUMN);
    const body = list.length ? `${head}${rest.length ? `<details class="more" id="more-${stage}"><summary>Show ${rest.length} more</summary>${rest.map(draw).join("\n")}</details>` : ""}` : `<p class="empty">Nothing here</p>`;
    return `<section class="col" aria-label="${esc(STAGE_LABEL[stage])}"><h2>${esc(STAGE_LABEL[stage])} <span>${list.length}</span></h2>${body}</section>`;
  }).join("\n");
  const lost = shown.filter((d) => d.stage === "lost");
  return `<ul class="stats">
<li><b>${t.open}</b><span>open deals</span></li>
<li><b>${t.callsBooked}</b><span>calls booked</span></li>
<li><b>${esc(sums(t.proposedMonthly))}</b><span>${t.proposalsOut} proposal${t.proposalsOut === 1 ? "" : "s"} out, a month</span></li>
<li><b>${esc(sums(t.wonMonthly))}</b><span>won, a month</span></li>
</ul>
<div class="board">${cols}</div>
${lost.length ? `<details class="lost" id="lost"><summary>${lost.length} lost</summary><div class="board">${lost.map(draw).join("")}</div></details>` : ""}
<p class="foot">Stages move with the buttons in Slack, so there is one place to change a deal. Longest waiting first in each column.</p>`;
}

export function renderBoard(deals: Deal[], opts: { now: Date; email: string; audits?: Record<string, string>; rejected?: Set<string> }): string {
  return renderShell({
    title: "Pipeline",
    tab: "pipeline",
    email: opts.email,
    heading: `Sales <span class="acc">pipeline.</span>`,
    subline: "Every open deal, by stage.",
    main: renderBoardMain(deals, opts),
    css: BOARD_CSS,
  });
}

export function loginPage(message?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Pipeline | The Growth Lab</title>
<style>@font-face{font-family:"DM Sans";font-weight:400 700;src:url(/book/assets/dm-sans-latin.woff2) format("woff2")}body{margin:0;background:#F5F0E8;color:#2C2118;font-family:"DM Sans",system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px}main{max-width:380px;text-align:center}img{height:44px}h1{font-size:1.6rem;letter-spacing:-.03em;margin:22px 0 8px}p{color:#3A3028;margin:0 0 22px}.msg{background:#F8E2DA;border-left:3px solid #C75B3B;padding:10px;text-align:left;border-radius:0 8px 8px 0}a.btn{display:inline-block;font-weight:600;padding:14px 22px;border:2px solid #2C2118;border-radius:14px;background:#2C2118;color:#F5F0E8;text-decoration:none;box-shadow:4px 4px 0 #C75B3B}</style></head>
<body><main><img src="/book/assets/logo.png" alt="The Growth Lab"><h1>Sales pipeline</h1><p>Private. Sign in with the Google account that has access.</p>${message ? `<p class="msg" role="alert">${esc(message)}</p>` : ""}<a class="btn" href="/pipeline/connect">Sign in with Google</a></main></body></html>`;
}
