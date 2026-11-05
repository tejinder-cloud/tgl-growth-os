// Email rendering for reports — one person writing to another (SPEC §6): short, specific, one next step.
// Every number comes from the report content (counts of stored answers).
import { ENGINE_LABEL, type DailyContent, type Ratio, type WeeklyContent } from "./build.js";

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
type Block = { title?: string; lines: string[] };

function render(blocks: Block[], cta: { label: string; url: string }, footerUrl: string): { text: string; html: string } {
  const text = [...blocks.flatMap((b) => [...(b.title ? [b.title] : []), ...b.lines, ""]), `${cta.label}: ${cta.url}`, "", "— your TrueVisible team", "", `Change which emails you get: ${footerUrl}`].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#F7F3EC;font-family:Arial,Helvetica,sans-serif;color:#2B2420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #D8CFC2;border-radius:12px">
<tr><td style="padding:24px 24px 8px;font-family:Georgia,serif;font-size:20px;font-weight:bold">TrueVisible</td></tr>
${blocks.map((b) => `<tr><td style="padding:8px 24px">${b.title ? `<p style="margin:0 0 6px;font-weight:bold;font-size:15px">${esc(b.title)}</p>` : ""}${b.lines.map((l) => `<p style="margin:0 0 6px;font-size:15px;line-height:1.5">${esc(l)}</p>`).join("")}</td></tr>`).join("\n")}
<tr><td style="padding:16px 24px"><a href="${esc(cta.url)}" style="display:inline-block;background:#D9644A;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">${esc(cta.label)}</a></td></tr>
<tr><td style="padding:8px 24px 24px;font-size:15px">— your TrueVisible team</td></tr>
</table>
<p style="font-size:12px;color:#6B625B;margin:12px 0 0">Answers come from each AI's API with web search on. <a href="${esc(footerUrl)}" style="color:#6B625B">Change which emails you get</a></p>
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
