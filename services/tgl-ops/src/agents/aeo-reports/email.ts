// Email rendering for reports — one person writing to another (SPEC §6): short, specific, one next step.
// Every number comes from the report content (counts of stored answers).
import { ENGINE_LABEL, type BaselineContent, type DailyContent, type MonthlyContent, type Ratio, type WeeklyContent } from "./build.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const eng = (e: string) => ENGINE_LABEL[e] ?? e;
const r = (x: Ratio) => `${x.n} of ${x.of}`;
const answers = (n: number) => `${n} answer${n === 1 ? "" : "s"}`;
function delta(now: Ratio, prev: Ratio | null): string {
  if (!prev) return "";
  const d = now.n - prev.n;
  return d === 0 ? " (same as before)" : ` (${d > 0 ? "+" : ""}${d} vs ${r(prev)})`;
}

export type Email = { subject: string; text: string; html: string };
export type Block = { title?: string; lines: string[] };

export function render(blocks: Block[], cta: { label: string; url: string }, footerUrl: string, cta2?: { label: string; url: string }, opts: { aboutAnswers?: boolean } = {}): { text: string; html: string } {
  // The "answers come from each AI's API" note belongs on emails that report answers, not on receipts or site checks.
  const note = opts.aboutAnswers === false ? "" : "Answers come from each AI's API with web search on. ";
  const text = [...blocks.flatMap((b) => [...(b.title ? [b.title] : []), ...b.lines, ""]), `${cta.label}: ${cta.url}`, ...(cta2 ? [`${cta2.label}: ${cta2.url}`] : []), "", "— your TrueVisible team", "", `Change which emails you get: ${footerUrl}`].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#F7F3EC;font-family:Arial,Helvetica,sans-serif;color:#2B2420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #D8CFC2;border-radius:12px">
<tr><td style="padding:24px 24px 8px;font-family:Georgia,serif;font-size:20px;font-weight:bold">TrueVisible</td></tr>
${blocks.map((b) => `<tr><td style="padding:8px 24px">${b.title ? `<p style="margin:0 0 6px;font-weight:bold;font-size:15px">${esc(b.title)}</p>` : ""}${b.lines.map((l) => `<p style="margin:0 0 6px;font-size:15px;line-height:1.5">${esc(l)}</p>`).join("")}</td></tr>`).join("\n")}
<tr><td style="padding:16px 24px"><a href="${esc(cta.url)}" style="display:inline-block;background:#D9644A;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">${esc(cta.label)}</a>${cta2 ? ` <a href="${esc(cta2.url)}" style="display:inline-block;margin-left:8px;color:#2B2420;text-decoration:none;font-weight:bold;padding:11px 19px;border:1px solid #2B2420;border-radius:999px">${esc(cta2.label)}</a>` : ""}</td></tr>
<tr><td style="padding:8px 24px 24px;font-size:15px">— your TrueVisible team</td></tr>
</table>
<p style="font-size:12px;color:#6B625B;margin:12px 0 0">${note}<a href="${esc(footerUrl)}" style="color:#6B625B">Change which emails you get</a></p>
</td></tr></table></body></html>`;
  return { text, html };
}

export function dailyEmail(d: DailyContent, appUrl: string): Email {
  const blocks: Block[] = [{ lines: [
    "Hi,",
    `On ${day(d.date)}, ChatGPT, Gemini and Perplexity named ${d.brand} in ${r(d.overall)} answers${d.prevOverall ? `${delta(d.overall, d.prevOverall)}` : ""}.`,
    d.engines.map((e) => `${eng(e.engine)} ${r(e.today)}`).join(" · "),
  ] }];
  if (d.gained.length) blocks.push({ title: "Newly named", lines: d.gained.slice(0, 5).map((g) => `• “${g.prompt}” — ${eng(g.engine)}`) });
  if (d.lost.length) blocks.push({ title: "No longer named", lines: d.lost.slice(0, 5).map((g) => `• “${g.prompt}” — ${eng(g.engine)}`) });
  if (!d.gained.length && !d.lost.length && d.prevOverall) blocks.push({ lines: ["No question changed since the day before."] });
  if (d.competitors.length) blocks.push({ title: "Competitors", lines: d.competitors.slice(0, 4).map((c) => `• ${c.name}: named in ${answers(c.today)}${c.prev != null && c.prev !== c.today ? ` (was ${c.prev})` : ""}`) });
  if (d.newSites.length) blocks.push({ title: "New sites AI cited today", lines: [d.newSites.join(", ")] });
  if (d.topRec) blocks.push({ title: "One thing to do", lines: [`${d.topRec}${d.openRecs > 1 ? ` — one of ${d.openRecs} recommendations on your dashboard.` : ""}`] });
  const subject = `${d.brand}: named in ${r(d.overall)} AI answers${d.prevOverall && d.overall.n !== d.prevOverall.n ? ` (${d.overall.n - d.prevOverall.n > 0 ? "+" : ""}${d.overall.n - d.prevOverall.n})` : ""} · ${day(d.date)}`;
  const body = render(blocks, d.topRec ? { label: "See the recommendation", url: `${appUrl}/dashboard/recommendations` } : { label: "Open your dashboard", url: `${appUrl}/dashboard` }, `${appUrl}/dashboard/settings`);
  return { subject, ...body };
}

export function weeklyEmail(w: WeeklyContent, appUrl: string): Email {
  const blocks: Block[] = [{ lines: [
    "Hi,",
    `Week of ${day(w.start)}–${day(w.end)}: ${w.brand} was named in ${r(w.overall)} AI answers${delta(w.overall, w.prevOverall)}.`,
    w.engines.map((e) => `${eng(e.engine)} ${r(e.week)}`).join(" · "),
    w.unbranded.of ? `In questions that don't mention you by name: ${r(w.unbranded)}. That's the number that shows whether AI recommends you on its own.` : "",
  ].filter(Boolean) }];
  if (w.strongest.length) blocks.push({ title: "Where AI names you", lines: w.strongest.map((s) => `• “${s.prompt}” — ${s.named} of ${answers(s.of)}`) });
  if (w.neverNamed.length) blocks.push({ title: "Where it never did this week", lines: w.neverNamed.map((q) => `• “${q}”`) });
  if (w.competitors.length) blocks.push({ title: "Who AI named instead", lines: w.competitors.slice(0, 4).map((c) => `• ${c.name}: ${answers(c.answers)} (you: ${w.brandAnswers})`) });
  if (w.topSites.length) blocks.push({ title: "Sites AI read most", lines: [w.topSites.map((s) => `${s.domain} (${s.answers})`).join(", ")] });
  const recLine = [w.recsDone ? `You completed ${w.recsDone} recommendation${w.recsDone === 1 ? "" : "s"} this week.` : "", w.topRec ? `Next: ${w.topRec}` : ""].filter(Boolean);
  if (recLine.length) blocks.push({ title: "What to do next", lines: recLine });
  const subject = `${w.brand} · your AI visibility this week: ${r(w.overall)} answers name you`;
  return { subject, ...render(blocks, { label: "Open your dashboard", url: `${appUrl}/dashboard` }, `${appUrl}/dashboard/settings`) };
}

export function monthlyEmail(m: MonthlyContent, appUrl: string, reportId: string): Email {
  const month = new Date(m.month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const blocks: Block[] = [{ lines: [
    "Hi,",
    `Your AI visibility review for ${month} is attached as a one-page PDF.`,
    `${m.brand} was named in ${r(m.overall)} AI answers${delta(m.overall, m.prevOverall)}${m.unbranded.of ? `, and in ${r(m.unbranded)} answers to questions that don't mention you by name` : ""}.`,
  ] }];
  if (m.won.length) blocks.push({ title: "Won this month", lines: m.won.slice(0, 3).map((q) => `• “${q}”`) });
  if (m.lost.length) blocks.push({ title: "Lost this month", lines: m.lost.slice(0, 3).map((q) => `• “${q}”`) });
  if (m.plan.length) blocks.push({ title: "Next month", lines: m.plan.map((t, i) => `${i + 1}. ${t}`) });
  return { subject: `${m.brand} · AI visibility review · ${month}`, ...render(blocks, { label: "Open the review", url: `${appUrl}/dashboard/reports/${reportId}` }, `${appUrl}/dashboard/settings`) };
}

export function baselineEmail(b: BaselineContent, appUrl: string, reportId: string, managedUrl: string): Email {
  const blocks: Block[] = [{ lines: [
    "Hi,",
    `Over the last 7 days we read ${b.overall.of} answers from ChatGPT, Gemini and Perplexity to your ${b.questions} questions. They named ${b.brand} in ${b.overall.n}.`,
    b.unbranded.of ? `In questions that don't mention you by name: ${r(b.unbranded)}. That's the number that shows whether AI recommends you on its own.` : "",
    "This is your baseline — where you stand today. Seven days is too short to call a trend; change shows over weeks.",
  ].filter(Boolean) }];
  if (b.competitors.length) blocks.push({ title: "Who AI named instead", lines: b.competitors.slice(0, 4).map((c) => `• ${c.name}: ${answers(c.answers)} (you: ${b.brandAnswers})`) });
  if (b.topSites.length) blocks.push({ title: "Sites AI read most", lines: [b.topSites.slice(0, 4).map((s) => s.domain).join(", ")] });
  if (b.fixes.length) blocks.push({ title: "Three fixes to start with", lines: b.fixes.map((f, i) => `${i + 1}. ${f}`) });
  blocks.push({ lines: ["Your trial has ended. Keep watching every week with Track, or have us do the work with Managed."] });
  return { subject: `${b.brand}: your 7-day AI visibility baseline`,
    ...render(blocks, { label: "Keep watching — Track", url: `${appUrl}/dashboard/upgrade?from=baseline&report=${reportId}` }, `${appUrl}/dashboard/settings`, { label: "Have it done — Managed", url: managedUrl }) };
}

/** "Your 90-day plan is ready" (plan Day 29b): what the 90 days focus on and the first weeks, with the link. */
export function planReadyEmail(p: { brand: string; summary: string; months: { month: number; theme: string }[]; firstWeeks: string[]; startsOn: string; endsOn: string }, appUrl: string): Email {
  const blocks: Block[] = [
    { lines: [`Your 90-day AI visibility plan for ${p.brand} is ready. It runs ${day(p.startsOn)} – ${day(p.endsOn)}.`] },
    { lines: [p.summary] },
    { title: "The three months", lines: p.months.map((m) => `Month ${m.month}: ${m.theme}`) },
    ...(p.firstWeeks.length ? [{ title: "What we start with", lines: p.firstWeeks }] : []),
    { lines: ["We'll show every change in the dashboard as it happens, and measure the effect in the answers each week."] },
  ];
  const { text, html } = render(blocks, { label: "See the full plan", url: `${appUrl}/dashboard/plan` }, `${appUrl}/dashboard/settings#email`);
  return { subject: `Your 90-day plan for ${p.brand} is ready`, text, html };
}
