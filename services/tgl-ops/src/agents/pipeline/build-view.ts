// services/tgl-ops/src/agents/pipeline/build-view.ts
// /pipeline/build: the build tracker (24 Nov 2026), after the My LabOS "Agent team build" page. The plan, tasks,
// risks and decisions come from build-plan.ts; agents, spend and today's sends come from the live view's data.
import { BUILD_PLAN, type BuildPlan, type PlanTask } from "./build-plan.js";
import { agentName, esc, istDate, readableTimes, rupees, type LiveView } from "./live-view.js";

const DAY = 86_400_000;

function dayNum(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);
}
function addDays(date: string, n: number): string {
  return new Date((dayNum(date) + n) * DAY).toISOString().slice(0, 10);
}
/** "Wed 26 Nov". */
export function shortDay(date: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`)).replace(",", "");
}

export interface BuildSummary {
  today: string;
  dayIndex: number; // 1-based; 0 before start, > totalDays after go-live
  totalDays: number;
  daysLeft: number;
  done: number;
  total: number;
  percent: number;
  overdue: PlanTask[];
  yours: PlanTask[];
  next3: PlanTask[];
  onTrack: boolean;
}

/** Everything the top strip says, from the plan and the date. Pure. */
export function summarize(plan: BuildPlan, now: Date): BuildSummary {
  const today = istDate(now);
  const totalDays = dayNum(plan.goLive) - dayNum(plan.start) + 1;
  const dayIndex = dayNum(today) - dayNum(plan.start) + 1;
  const done = plan.tasks.filter((t) => t.status === "done").length;
  const open = plan.tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.due < today);
  const yours = open.filter((t) => t.owner === "You").sort((a, b) => a.due.localeCompare(b.due));
  const horizon = addDays(today, 3);
  const next3 = open.filter((t) => t.owner !== "You" && t.due >= today && t.due <= horizon).sort((a, b) => a.due.localeCompare(b.due));
  return {
    today,
    dayIndex,
    totalDays,
    daysLeft: Math.max(0, dayNum(plan.goLive) - dayNum(today)),
    done,
    total: plan.tasks.length,
    percent: plan.tasks.length ? Math.round((done / plan.tasks.length) * 100) : 0,
    overdue,
    yours,
    next3,
    onTrack: overdue.length === 0,
  };
}

function ownerTag(o: string): string {
  return `<span class="own own-${esc(o.toLowerCase())}">${esc(o)}</span>`;
}

function taskRow(t: PlanTask, today: string): string {
  const late = t.status !== "done" && t.due < today;
  const label = t.status === "done" ? "Done" : t.status === "doing" ? "In progress" : t.status === "blocked" ? "Blocked" : late ? "Late" : "To do";
  return `<li class="task ${t.status}${late ? " late" : ""}"><span class="box" aria-hidden="true"></span><div><b>${esc(t.title)}</b><span class="sub">${ownerTag(t.owner)} due ${esc(shortDay(t.due))}${t.note ? `. ${esc(t.note)}` : ""}</span></div><span class="st">${label}</span></li>`;
}

function timeline(plan: BuildPlan, s: BuildSummary): string {
  return `<div class="tl">${plan.phases
    .map((ph) => {
      const days: string[] = [];
      for (let d = ph.start; d <= ph.end; d = addDays(d, 1)) {
        const cls = d < s.today ? "past" : d === s.today ? "now" : "next";
        const dt = new Date(`${d}T00:00:00Z`);
        days.push(`<li class="${cls}${d === plan.goLive ? " live" : ""}"${d === s.today ? ' aria-current="date"' : ""} title="${esc(shortDay(d))}"><b>${dt.getUTCDate()}</b><span>${esc(dt.toLocaleString("en-IN", { month: "short", timeZone: "UTC" }))}</span></li>`);
      }
      const state = ph.end < s.today ? "Done" : ph.start <= s.today ? "Now" : `From ${shortDay(ph.start)}`;
      return `<section class="ph"><h3>${esc(ph.name)} <small>${esc(state)}</small></h3><ol>${days.join("")}</ol></section>`;
    })
    .join("")}</div><p class="legend"><span class="k past"></span>Done <span class="k now"></span>Today <span class="k next"></span>Planned <span class="k live"></span>Go live</p>`;
}

/** The part of the page that refreshes. */
export function renderBuildMain(v: LiveView | null, now: Date, plan: BuildPlan = BUILD_PLAN): string {
  const s = summarize(plan, now);
  const dayText = s.dayIndex < 1 ? `Starts ${shortDay(plan.start)}` : s.dayIndex > s.totalDays ? "Past go-live" : `Day ${s.dayIndex}<small> of ${s.totalDays}</small>`;
  const ran = new Map((v?.agents || []).map((a) => [a.agent, a.last]));
  const openTasks = plan.tasks.filter((t) => t.status !== "done").sort((a, b) => a.due.localeCompare(b.due));
  const doneTasks = plan.tasks.filter((t) => t.status === "done");
  const spend = v?.spend;

  const stats = `<ul class="stats">
<li><div><b>${s.percent}%</b><span>${s.done} of ${s.total} tasks done</span><i class="bar"><i style="width:${s.percent}%"></i></i></div></li>
<li><div><b>${dayText}</b><span>${esc(shortDay(plan.start))} to ${esc(shortDay(plan.goLive))}</span></div></li>
<li><div><b>${esc(shortDay(plan.goLive))}</b><span>Go live: ${s.daysLeft} ${s.daysLeft === 1 ? "day" : "days"} left</span></div></li>
<li><div><b>${s.yours.length}</b><span>Waiting on you${s.overdue.length ? `, ${s.overdue.length} late` : ""}</span></div></li>
</ul>`;

  const agents = `<section class="panel"><h2>Agents</h2><p class="lead">Ran today means the agent saved a log today.</p><ul class="roster">${plan.agents
    .map((a) => {
      const last = ran.get(a.key);
      const state = !a.live ? ["Not live yet", "off"] : last ? ["Ran today", "on"] : v?.agents ? ["No run yet today", "idle"] : ["Logs unreadable", "idle"];
      return `<li><div><b>${esc(a.name || agentName(a.key))}</b><span class="sub">${esc(a.job)}. ${esc(a.when)}.</span>${last ? `<span class="last">${esc(readableTimes(last))}</span>` : ""}</div><span class="pill ${state[1]}">${state[0]}</span></li>`;
    })
    .join("")}</ul></section>`;

  const money = spend
    ? `<ul class="spend"><li><span>Today</span><b>${rupees(spend.todayInr)}</b></li><li><span>This month</span><b>${rupees(spend.monthInr)}</b></li>${Object.entries(spend.byProduct)
        .map(([k, n]) => `<li class="sm"><span>${esc(k === "tgl_ops" ? "Research and audits" : k === "truevisible" ? "TrueVisible" : k)}</span><span>${rupees(n)}</span></li>`)
        .join("")}</ul>`
    : `<p class="ok">Spend could not be read just now.</p>`;
  const today = v
    ? `<ul class="spend"><li><span>Emails sent today</span><b>${v.today.sent} of ${v.today.cap}</b></li><li><span>Replies today</span><b>${v.today.replies}</b></li><li><span>Phone only, waiting for WhatsApp</span><b>${v.calls.length}</b></li></ul>`
    : `<p class="ok">Today's numbers could not be read just now.</p>`;

  const waiting = `<section class="panel"><h2>Waiting on you${s.yours.length ? ` <span class="count">${s.yours.length}</span>` : ""}</h2>${
    s.yours.length ? `<ul class="tasks">${s.yours.map((t) => taskRow(t, s.today)).join("")}</ul>` : `<p class="ok">Nothing is waiting on you.</p>`
  }<h2 class="h2b">Coming up from others</h2>${s.next3.length ? `<ul class="tasks">${s.next3.map((t) => taskRow(t, s.today)).join("")}</ul>` : `<p class="ok">Nothing else due in the next 3 days.</p>`}</section>`;

  const tasks = `<section class="panel wide" id="tasks"><h2>Tasks <span class="count">${openTasks.length} open</span></h2><ul class="tasks">${openTasks.map((t) => taskRow(t, s.today)).join("")}</ul><details><summary>${doneTasks.length} done</summary><ul class="tasks">${doneTasks.map((t) => taskRow(t, s.today)).join("")}</ul></details></section>`;

  const risks = `<section class="panel wide"><h2>Risks and issues <span class="count">${plan.risks.filter((r) => r.status !== "Closed").length} open</span></h2><table><thead><tr><th>What</th><th>Impact</th><th>Owner</th><th>What we do about it</th><th>Status</th></tr></thead><tbody>${plan.risks
    .map((r) => `<tr><td><span class="kind ${r.kind.toLowerCase()}">${r.kind}</span> <b>${esc(r.what)}</b></td><td><span class="imp ${r.impact.toLowerCase()}">${r.impact}</span></td><td>${ownerTag(r.owner)}</td><td>${esc(r.action)}</td><td>${r.status}</td></tr>`)
    .join("")}</tbody></table></section>`;

  const decisions = `<section class="panel wide"><h2>Decisions <span class="count">${plan.decisions.length}</span></h2><ul class="dec">${plan.decisions
    .map((d) => `<li><span class="when">${esc(shortDay(d.date))}</span><div><b>${esc(d.what)}</b>${d.why ? `<span class="sub">${esc(d.why)}</span>` : ""}</div></li>`)
    .join("")}</ul></section>`;

  return `${stats}
<section class="panel wide"><h2>Plan <span class="status ${s.onTrack ? "good" : "bad"}">${s.onTrack ? "On track" : `${s.overdue.length} late`}</span></h2><p class="lead">${esc(plan.goal)}</p>${timeline(plan, s)}</section>
<div class="grid">${waiting}${agents}
<section class="panel"><h2>Today</h2>${today}</section>
<section class="panel"><h2>Running costs</h2><p class="lead">Recorded spend only.</p>${money}</section>
${tasks}${risks}${decisions}</div>
<p class="foot">Updated ${esc(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(now))} IST. Refreshes every minute.</p>`;
}

export function renderBuildPage(v: LiveView | null, email: string, now: Date, plan: BuildPlan = BUILD_PLAN): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Build | The Growth Lab</title>
<style>
@font-face{font-family:"DM Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url(/book/assets/dm-sans-latin.woff2) format("woff2")}
@font-face{font-family:"Fraunces";font-style:italic;font-weight:400 700;font-display:swap;src:url(/book/assets/fraunces-latin-italic.woff2) format("woff2")}
:root{--paper:#F5F0E8;--paper-2:#EDE8DD;--white:#FFFDF9;--ink:#2C2118;--ink-2:#3A3028;--mute:#6B625B;--grey:#D9D1C5;--terra:#C75B3B;--terra-text:#B94B35;--coral:#E8846B;--sage:#7BA668;--sage-dk:#4F7A3E;--mustard:#E8B44C;--teal:#4A9B8E;--serif:"Fraunces",Georgia,serif;--sans:"DM Sans",system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
a{color:inherit}p{margin:0}h1,h2,h3{margin:0;font-weight:600;letter-spacing:-.02em}
.hd{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 20px;border-bottom:1px solid var(--paper-2)}
.hd img{height:34px;display:block}.nav{display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px;font-size:.88rem;color:var(--mute)}
.nav a{text-decoration:none;font-weight:600;color:var(--ink-2)}.nav a:hover{text-decoration:underline}.nav a[aria-current]{color:var(--terra-text);text-decoration:underline;text-underline-offset:4px}
.top{padding:22px 20px 4px;display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:12px;max-width:1240px}
h1{font-size:clamp(1.8rem,4vw,2.5rem);letter-spacing:-.032em}.acc{font-family:var(--serif);font-style:italic;font-weight:400;color:var(--terra-text)}
.refresh{font:600 .85rem var(--sans);background:var(--white);color:var(--ink);border:2px solid var(--ink);border-radius:10px;padding:7px 14px;cursor:pointer;box-shadow:2px 2px 0 var(--grey)}
main{padding:14px 20px 40px;max-width:1240px}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 16px;padding:0;list-style:none}
.stats div{height:100%;background:var(--white);border:2px solid var(--ink);border-radius:12px;padding:12px 16px;box-shadow:3px 3px 0 var(--teal)}
.stats li:nth-child(2) div{box-shadow:3px 3px 0 var(--coral)}.stats li:nth-child(3) div{box-shadow:3px 3px 0 var(--terra)}.stats li:nth-child(4) div{box-shadow:3px 3px 0 var(--sage)}
.stats b{display:block;font-size:1.6rem;letter-spacing:-.02em;line-height:1.2}.stats small{font-size:.9rem;font-weight:500;color:var(--mute)}.stats span{display:block;font-size:.82rem;color:var(--mute);margin-top:2px}
.stats .bar{display:block;height:6px;background:var(--paper-2);border-radius:99px;margin-top:8px;overflow:hidden}.stats .bar i{display:block;height:100%;background:var(--teal)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start;margin-top:14px}
.panel{background:var(--white);border:2px solid var(--ink);border-radius:14px;padding:16px 18px}.panel.wide{grid-column:1/-1}
.panel h2{font-size:1.02rem;margin-bottom:10px;display:flex;align-items:center;gap:8px}.h2b{margin-top:16px}
.count{font-size:.75rem;background:var(--ink);color:var(--paper);border-radius:999px;padding:1px 9px}
.status{font-size:.75rem;border-radius:999px;padding:1px 10px;font-weight:600}.status.good{background:#E3EEDC;color:var(--sage-dk)}.status.bad{background:#F6DDD3;color:var(--terra-text)}
.lead{color:var(--mute);font-size:.88rem;margin-bottom:8px}.ok{color:var(--mute)}.sub{display:block;font-size:.82rem;color:var(--mute);margin-top:1px}
.tl{display:flex;flex-wrap:wrap;gap:14px 18px;margin-top:6px}.ph h3{font-size:.8rem;color:var(--ink-2);margin-bottom:6px}.ph h3 small{font-weight:500;color:var(--mute);margin-left:4px}
.ph ol{display:flex;gap:5px;list-style:none;margin:0;padding:0}
.ph li{width:44px;height:50px;border-radius:9px;border:1.5px solid var(--grey);background:var(--paper);display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1}
.ph li b{font-size:.98rem}.ph li span{font-size:.66rem;color:var(--mute)}
.ph li.past{background:var(--sage);border-color:var(--sage);color:var(--white)}.ph li.past span{color:var(--white)}
.ph li.now{background:var(--white);border:2.5px solid var(--ink);box-shadow:2px 2px 0 var(--terra)}
.ph li.live{border:2px dashed var(--terra)}.ph li.live.past{border-style:solid}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;font-size:.78rem;color:var(--mute);margin-top:10px}
.k{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:-1px;border:1.5px solid var(--grey);background:var(--paper)}
.k.past{background:var(--sage);border-color:var(--sage)}.k.now{border:2px solid var(--ink);background:var(--white)}.k.live{border:2px dashed var(--terra)}
.tasks{list-style:none;margin:0;padding:0}.task{display:grid;grid-template-columns:18px 1fr auto;gap:10px;align-items:start;padding:8px 0;border-bottom:1px solid var(--paper-2)}
.box{width:16px;height:16px;border:2px solid var(--ink-2);border-radius:5px;margin-top:2px}
.task.done .box{background:var(--sage);border-color:var(--sage)}.task.done b{text-decoration:line-through;color:var(--mute);font-weight:500}
.task.doing .box{background:linear-gradient(90deg,var(--teal) 50%,transparent 50%)}
.st{font-size:.75rem;font-weight:600;color:var(--mute);white-space:nowrap}.task.late .st,.task.blocked .st{color:var(--terra-text)}.task.doing .st{color:var(--teal)}
.own{font-weight:600;color:var(--ink-2)}.own-you{color:var(--terra-text)}.own-meta{color:var(--teal)}
.roster{list-style:none;margin:0;padding:0}.roster li{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:start;padding:8px 0;border-bottom:1px solid var(--paper-2)}
.last{display:block;font-size:.8rem;color:var(--ink-2);margin-top:2px}
.pill{font-size:.72rem;font-weight:600;border-radius:999px;padding:2px 9px;white-space:nowrap}.pill.on{background:#E3EEDC;color:var(--sage-dk)}.pill.idle{background:var(--paper-2);color:var(--mute)}.pill.off{border:1.5px dashed var(--grey);color:var(--mute)}
.spend{list-style:none;margin:0;padding:0}.spend li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--paper-2)}.spend li.sm{font-size:.86rem;color:var(--mute);padding-left:12px}
table{width:100%;border-collapse:collapse;font-size:.88rem}thead th{text-align:left;font-size:.75rem;color:var(--mute);font-weight:600;padding:4px 10px 6px 0;border-bottom:1.5px solid var(--grey)}
td{padding:8px 10px 8px 0;border-bottom:1px solid var(--paper-2);vertical-align:top}
.kind{font-size:.72rem;font-weight:600;color:var(--mute)}.kind.issue{color:var(--terra-text)}
.imp{font-size:.72rem;font-weight:600;border-radius:999px;padding:1px 8px}.imp.high{background:#F6DDD3;color:var(--terra-text)}.imp.medium{background:#F7EBCB;color:#7A5A12}.imp.low{background:var(--paper-2);color:var(--mute)}
.dec{list-style:none;margin:0;padding:0}.dec li{display:grid;grid-template-columns:92px 1fr;gap:10px;padding:8px 0;border-bottom:1px solid var(--paper-2)}.dec .when{font-size:.82rem;color:var(--mute)}.dec b{font-weight:500}
details{margin-top:8px}summary{cursor:pointer;color:var(--mute);font-weight:600;font-size:.88rem}
.foot{color:var(--mute);font-size:.8rem;margin-top:12px}
:focus-visible{outline:3px solid var(--teal);outline-offset:2px}
@media (max-width:820px){.grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}table thead{display:none}table,tbody,tr,td{display:block}tr{padding:8px 0;border-bottom:1px solid var(--paper-2)}td{border:0;padding:2px 0}}
@media (max-width:520px){.hd{flex-wrap:wrap}.ph li{width:38px;height:46px}}
</style></head><body>
<header class="hd"><a href="/pipeline/live"><img src="/book/assets/logo.png" alt="The Growth Lab" width="60" height="34"></a>
<nav class="nav" aria-label="Pages"><a href="/pipeline/live">Today</a><a href="/pipeline/build" aria-current="page">Build</a><a href="/pipeline">Pipeline</a><a href="/pipeline/whatsapp/console">WhatsApp</a><span>${esc(email)}</span><a href="/pipeline/logout">Sign out</a></nav></header>
<div class="top"><h1>${esc(plan.title)}, <span class="acc">live by ${esc(shortDay(plan.goLive))}.</span></h1><button class="refresh" type="button" id="refresh">Refresh</button></div>
<main id="build" aria-live="polite">${renderBuildMain(v, now, plan)}</main>
<script>
(function(){
  var busy=false;
  function load(){
    if(busy)return;busy=true;
    var b=document.getElementById("refresh");b.textContent="Refreshing";
    var open=document.querySelector("#tasks details[open]");
    fetch("/pipeline/build?part=main",{credentials:"same-origin"}).then(function(r){return r.ok?r.text():null}).then(function(h){if(h){document.getElementById("build").innerHTML=h;if(open){var d=document.querySelector("#tasks details");if(d)d.open=true}}}).catch(function(){}).then(function(){busy=false;b.textContent="Refresh"});
  }
  document.getElementById("refresh").addEventListener("click",load);
  setInterval(function(){if(!document.hidden)load()},60000);
})();
</script>
</body></html>`;
}
