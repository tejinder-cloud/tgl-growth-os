// services/tgl-ops/src/agents/pipeline/build-view.ts
// /pipeline/build: the build tracker (24 Nov 2026), after the My LabOS "Agent team build" page. The plan, tasks,
// risks and decisions come from build-plan.ts; agents, spend and today's sends come from the live view's data.
import { BUILD_PLAN, type BuildPlan, type PlanTask } from "./build-plan.js";
import { agentName, istDate, type LiveView } from "./live-view.js";
import { esc, renderShell } from "./shell.js";

const DAY = 86_400_000;

function dayNum(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);
}
/** "Wed 26 Nov". */
export function shortDay(date: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`)).replace(",", "");
}

export interface BuildSummary {
  today: string;
  /** The first work day with unfinished work (1-based); totalDays + 1 when everything is done. */
  dayIndex: number;
  totalDays: number;
  /** Work days fully finished. */
  daysDone: number;
  /** Calendar days to the go-live target. */
  daysLeft: number;
  done: number;
  total: number;
  percent: number;
  /** Tasks with a date someone else set that has passed without the task being done. */
  overdue: PlanTask[];
  yours: PlanTask[];
  /** Others' open tasks in the current and next work day. */
  next: PlanTask[];
  onTrack: boolean;
}

/** Everything the top strip says. Progress comes from finished work, not the calendar (25 Nov 2026). Pure. */
export function summarize(plan: BuildPlan, now: Date): BuildSummary {
  const today = istDate(now);
  const open = plan.tasks.filter((t) => t.status !== "done");
  const dayIndex = open.length ? Math.min(...open.map((t) => t.day)) : plan.totalDays + 1;
  const done = plan.tasks.length - open.length;
  const byDay = (a: PlanTask, b: PlanTask) => a.day - b.day;
  const overdue = open.filter((t) => t.date && t.date < today);
  return {
    today,
    dayIndex,
    totalDays: plan.totalDays,
    daysDone: Math.min(plan.totalDays, dayIndex - 1),
    daysLeft: Math.max(0, dayNum(plan.goLive) - dayNum(today)),
    done,
    total: plan.tasks.length,
    percent: plan.tasks.length ? Math.round((done / plan.tasks.length) * 100) : 0,
    overdue,
    yours: open.filter((t) => t.owner === "You").sort(byDay),
    next: open.filter((t) => t.owner !== "You" && t.day <= dayIndex + 1).sort(byDay),
    onTrack: overdue.length === 0 && dayNum(today) <= dayNum(plan.goLive),
  };
}

function ownerTag(o: string): string {
  return `<span class="own own-${esc(o.toLowerCase())}">${esc(o)}</span>`;
}

function taskRow(t: PlanTask, today: string): string {
  const late = t.status !== "done" && Boolean(t.date && t.date < today);
  const label = t.status === "done" ? "Done" : t.status === "doing" ? "In progress" : t.status === "blocked" ? "Blocked" : late ? "Late" : "To do";
  const when = `Day ${t.day}${t.date ? `, ${t.owner === "Meta" ? "planned for" : "target"} ${shortDay(t.date)}` : ""}`;
  return `<li class="task ${t.status}${late ? " late" : ""}"><span class="box" aria-hidden="true"></span><div><b>${esc(t.title)}</b><span class="sub">${ownerTag(t.owner)} ${esc(when)}${t.note ? `. ${esc(t.note)}` : ""}</span></div><span class="st">${label}</span></li>`;
}

function timeline(plan: BuildPlan, s: BuildSummary): string {
  const waits = new Set(plan.tasks.filter((t) => t.owner === "Meta" && t.status !== "done").map((t) => t.day));
  return `<div class="tl">${plan.phases
    .map((ph) => {
      const days: string[] = [];
      for (let d = ph.from; d <= ph.to; d++) {
        const cls = d < s.dayIndex ? "past" : d === s.dayIndex ? "now" : "next";
        const titles = plan.tasks.filter((t) => t.day === d).map((t) => t.title).join("; ");
        days.push(`<li class="${cls}${d === plan.totalDays ? " live" : ""}${waits.has(d) ? " wait" : ""}"${d === s.dayIndex ? ' aria-current="step"' : ""} title="${esc(`Day ${d}${titles ? `: ${titles}` : ""}`)}"><span>Day</span><b>${d}</b></li>`);
      }
      const state = ph.to < s.dayIndex ? "Done" : ph.from <= s.dayIndex ? "Now" : `Days ${ph.from} to ${ph.to}`;
      return `<section class="ph"><h3>${esc(ph.name)} <small>${esc(state)}</small></h3><ol>${days.join("")}</ol></section>`;
    })
    .join("")}</div><p class="legend"><span class="k past"></span>Done <span class="k now"></span>Current <span class="k next"></span>Planned <span class="k wait"></span>Waits for Meta <span class="k live"></span>Go live</p>`;
}

/** Dates someone else sets, and the go-live target: the only calendar dates in the plan. */
function datesPanel(plan: BuildPlan, s: BuildSummary): string {
  const dated = plan.tasks.filter((t) => t.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return `<section class="panel"><h2>Dates that depend on others</h2><p class="lead">Work days move as fast as we work. These do not.</p><ul class="list">${dated
    .map((t) => `<li><div><b>${esc(t.title)}</b><span class="sub">${ownerTag(t.owner)} Day ${t.day}${t.note ? `. ${esc(t.note)}` : ""}</span></div><span class="pill ${t.status === "done" ? "good" : t.date! < s.today ? "bad" : ""}">${t.status === "done" ? "Done" : esc(shortDay(t.date!))}</span></li>`)
    .join("")}</ul></section>`;
}

/** The part of the page that refreshes. Plan only: today's activity and money are on the Overview. */
export function renderBuildMain(v: LiveView | null, now: Date, plan: BuildPlan = BUILD_PLAN): string {
  const s = summarize(plan, now);
  const dayText = s.dayIndex > s.totalDays ? "All done" : `Day ${s.dayIndex}<small> of ${s.totalDays}</small>`;
  const openTasks = plan.tasks.filter((t) => t.status !== "done").sort((a, b) => a.day - b.day);
  const doneTasks = plan.tasks.filter((t) => t.status === "done");
  const live = (text: string) => text.replace(/\{phone_only\}/g, v ? String(v.calls.length) : "Many");
  const ran = new Map((v?.activity || []).map((a) => [a.name, a]));
  const ACT: Record<string, string> = { "prospect-researcher": "Prospect researcher", "outreach-sequencer": "Outreach", "aeo-audit-engine": "Citation tracker" };

  const stats = `<ul class="stats">
<li><div><b>${s.percent}%</b><span>${s.done} of ${s.total} tasks done</span><i class="bar"><i style="width:${s.percent}%"></i></i></div></li>
<li><div><b>${dayText}</b><span>${s.daysDone} work ${s.daysDone === 1 ? "day" : "days"} done</span></div></li>
<li><div><b>${s.daysLeft}<small> days</small></b><span>to go-live on ${esc(shortDay(plan.goLive))}</span></div></li>
<li><div><b>${s.yours.length}</b><span>tasks waiting on you${s.overdue.length ? `, ${s.overdue.length} late` : ""}</span></div></li>
</ul>`;

  const waiting = `<section class="panel"><h2>Waiting on you${s.yours.length ? ` <span class="count">${s.yours.length}</span>` : ""}</h2>${
    s.yours.length ? `<ul class="tasks">${s.yours.map((t) => taskRow(t, s.today)).join("")}</ul>` : `<p class="ok">Nothing is waiting on you.</p>`
  }<h2 class="h2b">Up next from others</h2>${s.next.length ? `<ul class="tasks">${s.next.map((t) => taskRow(t, s.today)).join("")}</ul>` : `<p class="ok">Nothing else in the current work day.</p>`}</section>`;

  const roster = `<section class="panel"><h2>The team</h2><p class="lead">What each part does and when. Today's runs are on the Overview.</p><ul class="list roster">${plan.agents
    .map((a) => {
      const act = ACT[a.key] ? ran.get(ACT[a.key]) : undefined;
      const pill = !a.live ? `<span class="pill">Not live yet</span>` : act?.state === "done" ? `<span class="pill good">Ran today</span>` : act?.state === "problem" ? `<span class="pill bad">Problem</span>` : `<span class="pill">Scheduled</span>`;
      return `<li><div><b>${esc(a.name || agentName(a.key))}</b><span class="sub">${esc(a.job)}. ${esc(a.when)}.</span></div>${pill}</li>`;
    })
    .join("")}</ul></section>`;

  const tasks = `<section class="panel" id="tasks"><h2>Tasks <span class="count">${openTasks.length} open</span></h2><ul class="tasks">${openTasks.map((t) => taskRow(t, s.today)).join("")}</ul><details id="done-tasks"><summary>${doneTasks.length} done</summary><ul class="tasks">${doneTasks.map((t) => taskRow(t, s.today)).join("")}</ul></details></section>`;

  const risks = `<section class="panel"><h2>Risks and issues <span class="count">${plan.risks.filter((r) => r.status !== "Closed").length} open</span></h2><table><thead><tr><th>What</th><th>Impact</th><th>Owner</th><th>What we do about it</th><th>Status</th></tr></thead><tbody>${plan.risks
    .map((r) => `<tr><td><span class="kind ${r.kind.toLowerCase()}">${r.kind}</span> <b>${esc(live(r.what))}</b></td><td><span class="imp ${r.impact.toLowerCase()}">${r.impact}</span></td><td>${ownerTag(r.owner)}</td><td>${esc(live(r.action))}</td><td>${r.status}</td></tr>`)
    .join("")}</tbody></table></section>`;

  const decisions = `<section class="panel"><h2>Decisions <span class="count">${plan.decisions.length}</span></h2><ul class="dec">${plan.decisions
    .map((d) => `<li><span class="when">${esc(shortDay(d.date))}</span><div><b>${esc(d.what)}</b>${d.why ? `<span class="sub">${esc(d.why)}</span>` : ""}</div></li>`)
    .join("")}</ul></section>`;

  return `${stats}
<div class="row"><section class="panel"><h2>Plan <span class="pill ${s.onTrack ? "good" : "bad"}">${s.onTrack ? "On track" : `${s.overdue.length} late`}</span></h2><p class="lead">${esc(plan.goal)}</p>${timeline(plan, s)}</section></div>
<div class="row two">${waiting}${datesPanel(plan, s)}</div>
<div class="row">${roster}</div>
<div class="row">${tasks}</div>
<div class="row">${risks}</div>
<div class="row">${decisions}</div>
<p class="foot">Updated ${esc(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(now))} IST. Claude keeps the plan current with each change.</p>`;
}

export const BUILD_CSS = `.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:0 0 16px;padding:0;list-style:none}
.stats div{height:100%;background:var(--white);border:2px solid var(--ink);border-radius:12px;padding:12px 16px;box-shadow:3px 3px 0 var(--teal)}
.stats li:nth-child(2) div{box-shadow:3px 3px 0 var(--coral)}.stats li:nth-child(3) div{box-shadow:3px 3px 0 var(--terra)}.stats li:nth-child(4) div{box-shadow:3px 3px 0 var(--sage)}
.stats b{display:block;font-size:1.6rem;letter-spacing:-.02em;line-height:1.2}.stats small{font-size:.9rem;font-weight:500;color:var(--mute)}.stats span{display:block;font-size:.82rem;color:var(--mute);margin-top:2px}
.stats .bar{display:block;height:6px;background:var(--paper-2);border-radius:99px;margin-top:8px;overflow:hidden}.stats .bar i{display:block;height:100%;background:var(--teal)}
.h2b{margin-top:18px}
.tl{display:flex;flex-wrap:wrap;gap:14px 22px;margin-top:6px}.ph h3{font-size:.8rem;color:var(--ink-2);margin-bottom:6px}.ph h3 small{font-weight:500;color:var(--mute);margin-left:4px}
.ph ol{display:flex;gap:5px;list-style:none;margin:0;padding:0}
.ph li{width:44px;height:50px;border-radius:9px;border:1.5px solid var(--grey);background:var(--paper);display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1}
.ph li b{font-size:1rem;line-height:1}.ph li span{font-size:.62rem;color:var(--mute)}
.ph li.past{background:var(--sage);border-color:var(--sage);color:var(--white)}.ph li.past span{color:var(--white)}
.ph li.now{background:var(--white);border:2.5px solid var(--ink);box-shadow:2px 2px 0 var(--terra)}
.ph li.live{border:2px dashed var(--terra)}.ph li.live.past{border-style:solid}
.ph li.wait:not(.past){border:2px dashed var(--teal)}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;font-size:.78rem;color:var(--mute);margin-top:12px}
.k{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:-1px;border:1.5px solid var(--grey);background:var(--paper)}
.k.past{background:var(--sage);border-color:var(--sage)}.k.now{border:2px solid var(--ink);background:var(--white)}.k.live{border:2px dashed var(--terra)}.k.wait{border:2px dashed var(--teal)}
.tasks{list-style:none;margin:0;padding:0}.task{display:grid;grid-template-columns:18px 1fr auto;gap:10px;align-items:start;padding:8px 0;border-bottom:1px solid var(--paper-2)}
.box{width:16px;height:16px;border:2px solid var(--ink-2);border-radius:5px;margin-top:2px}
.task.done .box{background:var(--sage);border-color:var(--sage)}.task.done b{text-decoration:line-through;color:var(--mute);font-weight:500}
.task.doing .box{background:linear-gradient(90deg,var(--teal) 50%,transparent 50%)}
.st{font-size:.75rem;font-weight:600;color:var(--mute);white-space:nowrap}.task.late .st,.task.blocked .st{color:var(--terra-text)}.task.doing .st{color:var(--teal)}
.own{font-weight:600;color:var(--ink-2)}.own-you{color:var(--terra-text)}.own-meta{color:var(--teal)}
.kind{font-size:.72rem;font-weight:600;color:var(--mute)}.kind.issue{color:var(--terra-text)}
.imp{font-size:.72rem;font-weight:600;border-radius:999px;padding:1px 8px}.imp.high{background:#F6DDD3;color:var(--terra-text)}.imp.medium{background:#F7EBCB;color:#7A5A12}.imp.low{background:var(--paper-2);color:var(--mute)}
.dec{list-style:none;margin:0;padding:0}.dec li{display:grid;grid-template-columns:96px 1fr;gap:10px;padding:8px 0;border-bottom:1px solid var(--paper-2)}.dec li:last-child{border-bottom:0}.dec .when{font-size:.82rem;color:var(--mute)}.dec b{font-weight:500}
@media (max-width:900px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:600px){.ph li{width:38px;height:46px}}`;

export function renderBuildPage(v: LiveView | null, email: string, now: Date, plan: BuildPlan = BUILD_PLAN): string {
  return renderShell({
    title: "Build",
    tab: "build",
    email,
    heading: `${esc(plan.title)}, <span class="acc">live by ${esc(shortDay(plan.goLive))}.</span>`,
    main: renderBuildMain(v, now, plan),
    css: BUILD_CSS,
    partUrl: "/pipeline/build?part=main",
  });
}
