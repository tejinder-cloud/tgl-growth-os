// services/tgl-ops/src/agents/pipeline/overview-page.ts
// /pipeline/live, the Overview (25 Nov 2026): the whole business on one screen, in money order. The journey from
// found to won is the spine; around it, what needs the Architect, what went wrong, what the system did today and
// what it cost. Detail lives on the Outreach, Pipeline and Build tabs; this page links there instead of repeating.
import { BUILD_PLAN, type BuildPlan } from "./build-plan.js";
import { shortDay, summarize } from "./build-view.js";
import { dayOnly, PRODUCT_NAMES, rupees, timeOnly, type LiveView } from "./live-view.js";
import { esc, renderShell } from "./shell.js";

export const OVERVIEW_CSS = `.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:0 0 16px;padding:0;list-style:none}
.stats a{display:block;height:100%;text-decoration:none;background:var(--white);border:2px solid var(--ink);border-radius:12px;padding:12px 16px;box-shadow:3px 3px 0 var(--teal)}
.stats li:nth-child(2) a{box-shadow:3px 3px 0 var(--coral)}.stats li:nth-child(3) a{box-shadow:3px 3px 0 var(--terra)}.stats li:nth-child(4) a{box-shadow:3px 3px 0 var(--sage)}
.stats a:hover{transform:translate(-1px,-1px)}
.stats b{display:block;font-size:1.6rem;letter-spacing:-.02em;line-height:1.2}.stats small{font-size:.9rem;font-weight:500;color:var(--mute)}.stats span{display:block;font-size:.82rem;color:var(--mute);margin-top:2px}
.journey{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0;margin:4px 0 0;padding:0;list-style:none}
.journey li{position:relative;padding:12px 14px 12px 0}
.journey li+li{padding-left:22px}
.journey li+li::before{content:"";position:absolute;left:0;top:22px;width:12px;height:12px;border-top:2px solid var(--grey);border-right:2px solid var(--grey);transform:rotate(45deg)}
.journey b{display:block;font-size:2rem;letter-spacing:-.03em;line-height:1.05}
.journey .lbl{display:block;font-weight:600;font-size:.92rem;margin-top:2px}
.journey .conv{display:block;font-size:.78rem;color:var(--mute);margin-top:2px}
.journey .plus{display:inline-block;margin-top:6px;font-size:.74rem;font-weight:600;color:var(--sage-dk);background:#E3EEDC;border-radius:999px;padding:1px 8px}
.journey .bar{display:block;height:6px;border-radius:99px;background:var(--paper-2);margin-top:10px;overflow:hidden}.journey .bar i{display:block;height:100%;background:var(--teal);border-radius:99px}
.stuck{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:16px;padding:0;list-style:none}
.stuck a{display:flex;justify-content:space-between;align-items:center;gap:8px;text-decoration:none;background:var(--paper);border-radius:10px;padding:10px 12px;font-size:.88rem;height:100%}
.stuck a:hover{background:var(--paper-2)}.stuck b{font-size:1.15rem}.stuck .zero{color:var(--mute)}
.stucklbl{font-size:.8rem;color:var(--mute);margin-top:16px;font-weight:600}
.todo{list-style:none;margin:0;padding:0}.todo li{padding:8px 0 8px 14px;border-left:3px solid var(--terra);margin:6px 0}
.todo li.build{border-left-color:var(--teal)}
.probs{list-style:none;margin:0;padding:0}.probs li{border-left:3px solid var(--terra);padding:4px 0 4px 12px;margin:8px 0}.probs .sub{margin-top:2px}
.act li{grid-template-columns:76px 1fr auto}.act time{font-size:.85rem;color:var(--ink-2);font-variant-numeric:tabular-nums;padding-top:1px}.act time.none{color:var(--mute)}
.money{list-style:none;margin:0;padding:0}.money li{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--paper-2)}.money li:last-child{border-bottom:0}.money b{font-size:1.05rem}.money li.sm{font-size:.86rem;color:var(--mute);padding-left:12px}
.feed{list-style:none;margin:0;padding:0}.feed li{display:grid;grid-template-columns:76px 130px 1fr;gap:10px;padding:8px 0;border-bottom:1px solid var(--paper-2);font-size:.9rem}.feed li:last-child{border-bottom:0}
.feed time{color:var(--ink-2);font-variant-numeric:tabular-nums}.feed .who{font-weight:600}.feed li.warn span:last-child{color:var(--terra-text)}
@media (max-width:600px){.feed li{grid-template-columns:62px 1fr}.feed li span:last-child{grid-column:1/-1}}
@media (max-width:900px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.journey{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:6px}.journey li:nth-child(4){padding-left:0}.journey li:nth-child(4)::before{display:none}.stuck{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:600px){.act li{grid-template-columns:62px 1fr}.act .pill{grid-column:2;justify-self:start}}
@media (prefers-reduced-motion:reduce){.stats a:hover{transform:none}}`;

function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : "";
}

export function renderOverviewMain(v: LiveView, now: Date, plan: BuildPlan = BUILD_PLAN): string {
  const s = summarize(plan, now);
  const capReached = v.today.cap > 0 && v.today.sent >= v.today.cap;

  const stats = `<ul class="stats">
<li><a href="/pipeline/outreach#sent"><b>${v.today.sent}<small> of ${v.today.cap}</small></b><span>emails sent today${capReached ? ", limit reached" : ""}</span></a></li>
<li><a href="/pipeline"><b>${v.today.replies}</b><span>${v.today.replies === 1 ? "reply" : "replies"} today</span></a></li>
<li><a href="/pipeline"><b>${v.today.callsBooked}</b><span>${v.today.nextCall ? `next call: ${esc(v.today.nextCall)}` : "calls coming up"}</span></a></li>
<li><a href="/pipeline/build"><b>Day ${Math.min(s.dayIndex, s.totalDays)}<small> of ${s.totalDays}</small></b><span>WhatsApp build; go-live target ${esc(shortDay(plan.goLive))}</span></a></li>
</ul>`;

  const max = Math.max(1, ...v.journey.map((j) => j.count));
  const journey = `<section class="panel"><h2>From found to won</h2><p class="lead">Every business the system has found, and how far each has got. The percentage is how many moved on from the stage before.</p>
<ol class="journey">${v.journey
    .map((j, i) => {
      const conv = i > 0 ? pct(j.count, v.journey[i - 1].count) : "";
      return `<li><b>${j.count}</b><span class="lbl">${esc(j.label)}</span><span class="conv">${i === 0 ? "all time" : conv ? `${conv} of ${esc(v.journey[i - 1].label.toLowerCase())}` : "&nbsp;"}</span>${j.today ? `<span class="plus">+${j.today} today</span>` : ""}<span class="bar"><i style="width:${Math.round((j.count / max) * 100)}%"></i></span></li>`;
    })
    .join("")}</ol>
<p class="stucklbl">Where businesses are waiting</p>
<ul class="stuck">
<li><a href="/pipeline/outreach#next"><span>Next in line for an email</span><b class="${v.stuck.nextInLine ? "" : "zero"}">${v.stuck.nextInLine}</b></a></li>
<li><a href="/pipeline/outreach#whatsapp"><span>Phone only, waiting for WhatsApp</span><b class="${v.stuck.whatsapp ? "" : "zero"}">${v.stuck.whatsapp}</b></a></li>
<li><a href="/pipeline/outreach#paused"><span>Paused</span><b class="${v.stuck.paused ? "" : "zero"}">${v.stuck.paused}</b></a></li>
<li><a href="#needs"><span>Waiting for your approval in #revenue</span><b class="${v.stuck.approval ? "" : "zero"}">${v.stuck.approval}</b></a></li>
</ul></section>`;

  // One list of what needs the Architect: today's pipeline asks, then his build tasks that are late or due this week.
  // Build tasks of his that are up now: in the current or next work day, and not waiting on Meta first.
  const metaBefore = (day: number) => plan.tasks.some((m) => m.owner === "Meta" && m.status !== "done" && m.day < day);
  const buildAsks = s.yours.filter((t) => t.day <= s.dayIndex + 1 && !metaBefore(t.day));
  const needs = [...v.waiting.map((w) => `<li>${esc(w)}</li>`), ...buildAsks.map((t) => `<li class="build">${esc(t.title)}<span class="sub">Build task, day ${t.day}</span></li>`)];
  const needsPanel = `<section class="panel" id="needs"><h2>Needs you${needs.length ? ` <span class="count">${needs.length}</span>` : ""}</h2>${needs.length ? `<ul class="todo">${needs.join("")}</ul>` : `<p class="ok">Nothing needs you right now.</p>`}</section>`;

  const probsPanel = `<section class="panel"><h2>Problems${v.problems.length ? ` <span class="count">${v.problems.length}</span>` : ""}</h2>${
    v.problems.length ? `<ul class="probs">${v.problems.map((p) => `<li>${esc(p.text)}${p.names.length ? `<span class="sub">${esc(p.names.join(", "))}</span>` : ""}</li>`).join("")}</ul>` : `<p class="ok">Nothing has gone wrong today.</p>`
  }</section>`;

  const STATE: Record<string, [string, string]> = { done: ["Done", "good"], waiting: ["Waiting", ""], problem: ["Problem", "bad"] };
  const actPanel = `<section class="panel"><h2>What the system did today</h2><p class="lead">From what each part saved, so a run always shows.</p><ul class="list act">${v.activity
    .map((a) => `<li><time class="${a.at ? "" : "none"}"${a.at ? ` datetime="${esc(a.at)}"` : ""}>${a.at ? esc(timeOnly(a.at)) : "--"}</time><div><b>${esc(a.name)}</b><span class="sub">${esc(a.what)}</span></div><span class="pill ${STATE[a.state][1]}">${STATE[a.state][0]}</span></li>`)
    .join("")}</ul></section>`;

  const sp = v.spend;
  const moneyPanel = `<section class="panel"><h2>Money</h2><p class="lead">Recorded spend on AI engines, models and Google search. No revenue yet.</p>${
    sp
      ? `<ul class="money"><li><span>Today</span><b>${rupees(sp.todayInr)}</b></li><li><span>This month</span><b>${rupees(sp.monthInr)}</b></li>${Object.entries(sp.byProduct)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `<li class="sm"><span>${esc(PRODUCT_NAMES[k] || k)}</span><span>${rupees(n)}</span></li>`)
          .join("")}</ul>`
      : `<p class="ok">Spend could not be read just now.</p>`
  }</section>`;

  const WHO: Record<string, string> = { "prospect-researcher": "Researcher", "outreach-sequencer": "Outreach", "aeo-audit-engine": "Citation tracker", booking: "Booking", system: "System" };
  const FEED_SHOW = 12;
  const feedItem = (e: { at: string; agent: string; kind: string; summary: string }) => `<li class="${e.kind === "error" || e.kind === "held" || e.kind === "bounce" ? "warn" : ""}"><time datetime="${esc(e.at)}">${esc(timeOnly(e.at))}</time><span class="who">${esc(WHO[e.agent] || e.agent)}</span><span>${esc(e.summary)}</span></li>`;
  const feedPanel = `<section class="panel"><h2>Recent activity${v.feed?.length ? ` <span class="count">${v.feed.length} today</span>` : ""}</h2>${
    v.feed === null
      ? `<p class="ok">The activity record could not be read just now.</p>`
      : v.feed.length
        ? `<ul class="feed">${v.feed.slice(0, FEED_SHOW).map(feedItem).join("")}</ul>${v.feed.length > FEED_SHOW ? `<details id="feed-more"><summary>Show ${v.feed.length - FEED_SHOW} more</summary><ul class="feed">${v.feed.slice(FEED_SHOW).map(feedItem).join("")}</ul></details>` : ""}`
        : `<p class="ok">Nothing recorded yet today.</p>`
  }</section>`;

  return `${stats}
<div class="row">${journey}</div>
<div class="row two">${needsPanel}${probsPanel}</div>
<div class="row two">${actPanel}${moneyPanel}</div>
<div class="row">${feedPanel}</div>
<p class="foot">Updated ${esc(timeOnly(v.generatedAt))} IST, ${esc(dayOnly(v.generatedAt))}. Refreshes every minute while open.</p>`;
}

export function renderOverviewPage(v: LiveView, email: string, now: Date = new Date(v.generatedAt)): string {
  return renderShell({
    title: "Overview",
    tab: "overview",
    email,
    heading: `Today at <span class="acc">The Growth Lab.</span>`,
    main: renderOverviewMain(v, now),
    css: OVERVIEW_CSS,
    partUrl: "/pipeline/live?part=main",
  });
}
