// Offline checks for the build tracker at /pipeline/build (24 Nov 2026). No network, no Supabase.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { makeSession, SESSION_COOKIE } from "./agents/pipeline/auth.js";
import { BUILD_PLAN, type BuildPlan } from "./agents/pipeline/build-plan.js";
import { renderBuildMain, renderBuildPage, shortDay, summarize } from "./agents/pipeline/build-view.js";
import type { LiveView } from "./agents/pipeline/live-view.js";
import { setLiveLoaderForTests } from "./routes/pipeline.js";

const EMOJI = /(?:\p{Extended_Pictographic}|[\u{2600}-\u{27BF}])/u;

const plan: BuildPlan = {
  title: "Test build",
  goal: "Goal <here>",
  start: "2026-11-24",
  goLive: "2026-11-30",
  totalDays: 6,
  phases: [{ name: "One", from: 1, to: 3 }, { name: "Two", from: 4, to: 6 }],
  tasks: [
    { day: 1, title: "Done thing", owner: "Claude", status: "done" },
    { day: 2, title: "Done too", owner: "Claude", status: "done" },
    { day: 3, title: "Current thing", owner: "Claude", status: "doing" },
    { day: 3, title: "Your thing", owner: "You", status: "todo" },
    { day: 4, title: "Meta thing", owner: "Meta", status: "todo", date: "2026-11-25" },
    { day: 6, title: "Later thing", owner: "Claude", status: "todo", date: "2026-11-30" },
  ],
  risks: [{ kind: "Issue", what: "{phone_only} phone-only", impact: "Medium", owner: "Claude", action: "x", status: "Open" }, { kind: "Risk", what: "R1", impact: "High", owner: "You", action: "Act", status: "Open" }, { kind: "Issue", what: "R2", impact: "Low", owner: "Claude", action: "x", status: "Closed" }],
  decisions: [{ date: "2026-11-24", what: "Decided" }],
  agents: [{ key: "outreach-sequencer", name: "Outreach", job: "Sends", when: "Daily", live: true }, { key: "prospect-researcher", name: "Researcher", job: "Finds", when: "09:30", live: true }, { key: "whatsapp", name: "WhatsApp", job: "Messages", when: "Later", live: false }],
};

const view = {
  generatedAt: "", today: { sent: 2, cap: 5, replies: 1, callsBooked: 0, nextCall: null }, journey: [], stuck: { approval: 0, nextInLine: 0, whatsapp: 1, paused: 0 },
  waiting: [], problems: [], outbox: [], nextInLine: [], paused: [], feed: [],
  calls: [{ company: "a", city: "", type: "", fit: 70, check: "" }],
  activity: [{ name: "Outreach", at: "2026-11-26T08:00:00Z", what: "Sent 2 emails", state: "done" }, { name: "Prospect researcher", at: null, what: "x", state: "problem" }],
  spend: { todayInr: 40.4, monthInr: 512.6, byProduct: { tgl_ops: 100, truevisible: 412.6 } },
} as LiveView;

async function main() {
  const now = new Date("2026-11-26T06:00:00Z"); // 26 Nov, 11:30 IST
  const s = summarize(plan, now);
  assert.equal(s.today, "2026-11-26");
  assert.equal(s.dayIndex, 3, "the first work day with unfinished work, whatever the calendar says");
  assert.equal(s.daysDone, 2);
  assert.equal(s.totalDays, 6);
  assert.equal(s.daysLeft, 4, "calendar days to the go-live target");
  assert.equal(s.percent, 33);
  assert.deepEqual(s.overdue.map((t) => t.title), ["Meta thing"], "only a passed date set by others is late");
  assert.deepEqual(s.yours.map((t) => t.title), ["Your thing"]);
  assert.deepEqual(s.next.map((t) => t.title), ["Current thing", "Meta thing"], "others' work in the current and next work day");
  assert.equal(s.onTrack, false);
  assert.equal(shortDay("2026-12-15"), "Tue 15 Dec");

  // Finishing work moves the day forward on the same calendar day.
  const faster = summarize({ ...plan, tasks: plan.tasks.map((t) => (t.day <= 3 ? { ...t, status: "done" as const } : t)) }, now);
  assert.equal(faster.dayIndex, 4);
  const all = summarize({ ...plan, tasks: plan.tasks.map((t) => ({ ...t, status: "done" as const })) }, now);
  assert.equal(all.dayIndex, 7);
  assert.equal(all.daysDone, 6);

  const main = renderBuildMain(view, now, plan);
  assert.ok(main.includes("Day 3<small> of 6</small>") && main.includes("2 work days done"));
  assert.ok(main.includes("1 late"));
  assert.ok(main.includes("Goal &lt;here&gt;") && !main.includes("Goal <here>"), "escaped");
  assert.ok(main.includes("Ran today") && main.includes("Problem") && main.includes("Not live yet"), "team states from today's records");
  assert.ok(!main.includes("₹513"), "money is on the Overview, not repeated here");
  assert.ok(main.includes('aria-current="step"'), "current work day marked on the timeline");
  assert.ok(main.includes("Dates that depend on others") && main.includes("Wed 25 Nov") && main.includes("Mon 30 Nov"), "only dated tasks show dates");
  assert.ok(main.includes("Day 4, planned for Wed 25 Nov") && main.includes("Day 3"), "tasks show their work day");
  assert.ok(!main.includes("due "), "no calendar due dates on ordinary tasks");
  assert.ok(main.includes("2 open"), "closed risks not counted");
  assert.ok(main.includes("1 phone-only"), "live count in the risk text");
  assert.ok(!EMOJI.test(main), "no emojis");

  const noData = renderBuildMain(null, now, plan);
  assert.ok(noData.includes("Your thing") && noData.includes("Many phone-only"), "the plan shows without live data");

  // The real plan is internally consistent.
  assert.ok(BUILD_PLAN.start <= BUILD_PLAN.goLive);
  assert.equal(BUILD_PLAN.phases[0].from, 1);
  assert.equal(BUILD_PLAN.phases[BUILD_PLAN.phases.length - 1].to, BUILD_PLAN.totalDays);
  for (let i = 1; i < BUILD_PLAN.phases.length; i++) assert.equal(BUILD_PLAN.phases[i].from, BUILD_PLAN.phases[i - 1].to + 1, "phases are back to back");
  for (const t of BUILD_PLAN.tasks) {
    assert.ok(Number.isInteger(t.day) && t.day >= 1 && t.day <= BUILD_PLAN.totalDays, `task inside the plan: ${t.title}`);
    if (t.date) assert.match(t.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.ok(BUILD_PLAN.tasks.filter((t) => t.date).every((t) => t.owner === "Meta" || t.day === BUILD_PLAN.totalDays), "dates only where others set the pace, and go-live");
  for (const d of BUILD_PLAN.decisions) assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
  const page = renderBuildPage(view, "me@x.example", now);
  assert.ok(!EMOJI.test(page), "no emojis in the real plan");
  assert.ok(page.includes('href="/pipeline/build" aria-current="page"'));

  // Route
  const env = { ...process.env };
  process.env.PIPELINE_ALLOWED_EMAILS = "me@x.example";
  process.env.PIPELINE_SESSION_SECRET = "s3cret";
  setLiveLoaderForTests(async () => view);
  const server = createApp("x").listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.match(await (await fetch(`${base}/pipeline/build`)).text(), /Sign in with Google/);
    assert.equal((await fetch(`${base}/pipeline/build?part=main`)).status, 401);
    const cookie = { cookie: `${SESSION_COOKIE}=${encodeURIComponent(makeSession("me@x.example", "s3cret"))}` };
    const res = await fetch(`${base}/pipeline/build`, { headers: cookie });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok((await res.text()).includes("WhatsApp outreach build"));
    const part = await (await fetch(`${base}/pipeline/build?part=main`, { headers: cookie })).text();
    assert.ok(part.startsWith('<ul class="stats">') && !part.includes("<html"));
    setLiveLoaderForTests(async () => { throw new Error("db down"); });
    const down = await fetch(`${base}/pipeline/build`, { headers: cookie });
    assert.equal(down.status, 200, "the plan still shows when live data fails");
  } finally {
    server.close();
    setLiveLoaderForTests(null);
    process.env = env;
  }
  console.log("test-build-view: all checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
