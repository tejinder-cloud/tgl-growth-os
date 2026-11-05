// One-page monthly review PDF (plan Day 24). Pure-Node PDFKit, Fraunces + DM Sans, paper-and-ink.
// Every number comes from MonthlyContent (counts of stored answers); a missing value prints "—".
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { ENGINE_LABEL, pct, type MonthlyContent, type Ratio } from "./build.js";

const INK = "#2B2420", MUTED = "#6B625B", LINE = "#D8CFC2", CREAM = "#F7F3EC", CORAL = "#D9644A";
const ENGINE_COLOR: Record<string, string> = { chatgpt: "#D9644A", gemini: "#00897B", perplexity: "#D6A02A" };

function font(file: string): string | null {
  for (const c of [path.join(__dirname, "../../assets/fonts", file), path.join(process.cwd(), "src/assets/fonts", file), path.join(process.cwd(), "dist/assets/fonts", file), path.join(process.cwd(), "services/tgl-ops/src/assets/fonts", file)])
    if (fs.existsSync(c)) return c;
  return null;
}
const monthName = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const short = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const r = (x: Ratio | null) => (x && x.of ? `${x.n} of ${x.of}` : "—");
const p = (x: Ratio | null) => { const v = pct(x); return v == null ? "—" : `${v}%`; };
const ans = (n: number) => `${n} answer${n === 1 ? "" : "s"}`;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export async function monthlyPdf(m: MonthlyContent, domain: string | null): Promise<Buffer> {
  const serif = font("fraunces.ttf") ?? "Times-Bold", sans = font("dm-sans.ttf") ?? "Helvetica";
  const doc = new PDFDocument({ size: "A4", margins: { top: 40, left: 40, right: 40, bottom: 8 }, info: { Title: `${m.brand} · AI visibility · ${monthName(m.month)}`, Author: "TrueVisible by The Growth Lab" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => { doc.on("end", () => res(Buffer.concat(chunks))); doc.on("error", rej); });
  const W = doc.page.width, X = 40, CW = W - 80;

  doc.rect(0, 0, W, doc.page.height).fill(CREAM);
  // Header
  doc.fillColor(MUTED).font(sans).fontSize(8).text(`${(domain ?? "").toUpperCase()}  ·  MONTHLY REVIEW`, X, 40, { characterSpacing: 1 });
  doc.fillColor(INK).font(serif).fontSize(24).text(m.brand, X, 54);
  doc.font(sans).fontSize(11).fillColor(MUTED).text(`${monthName(m.month)} · ${short(m.start)} – ${short(m.end)} · ${m.days} days measured`, X, 86);
  doc.font(sans).fontSize(8).fillColor(CORAL).text("TRUEVISIBLE", W - 40 - 90, 44, { width: 90, align: "right", characterSpacing: 1.5 });
  doc.moveTo(X, 106).lineTo(W - 40, 106).lineWidth(1).strokeColor(INK).stroke();

  // KPI row
  const kpis = [
    { label: "ANSWERS NAMING YOU", big: p(m.overall), sub: `${r(m.overall)}${m.prevOverall ? ` · last month ${p(m.prevOverall)}` : ""}` },
    { label: "WITHOUT YOUR NAME IN THE QUESTION", big: p(m.unbranded), sub: r(m.unbranded) },
    ...m.engines.slice(0, 3).map((e) => ({ label: (ENGINE_LABEL[e.engine] ?? e.engine).toUpperCase(), big: p(e.week), sub: `${r(e.week)}${e.prev ? ` · was ${p(e.prev)}` : ""}` })),
  ];
  const kw = (CW - 8 * (kpis.length - 1)) / kpis.length;
  kpis.forEach((k, i) => {
    const x = X + i * (kw + 8), y = 118;
    doc.roundedRect(x, y, kw, 68, 6).fillAndStroke("#FFFFFF", LINE);
    doc.fillColor(MUTED).font(sans).fontSize(6.5).text(k.label, x + 8, y + 8, { width: kw - 16, characterSpacing: 0.5 });
    doc.fillColor(INK).font(serif).fontSize(20).text(k.big, x + 8, y + 26, { width: kw - 16 });
    doc.fillColor(MUTED).font(sans).fontSize(7).text(k.sub, x + 8, y + 52, { width: kw - 16 });
  });

  // Weekly trend (one line per engine, direct labels)
  let y = 200;
  doc.fillColor(INK).font(serif).fontSize(12).text("Week by week", X, y);
  const cx = X, cy = y + 20, cw = CW - 90, ch = 90;
  doc.lineWidth(0.5).strokeColor(LINE);
  [0, 25, 50, 75, 100].forEach((t) => { const yy = cy + ch - (t / 100) * ch; doc.moveTo(cx + 24, yy).lineTo(cx + cw, yy).stroke(); doc.fillColor(MUTED).font(sans).fontSize(6.5).text(`${t}%`, cx, yy - 3, { width: 20, align: "right" }); });
  const n = m.weeks.length, stepX = n > 1 ? (cw - 34) / (n - 1) : 0;
  m.weeks.forEach((w, i) => doc.fillColor(MUTED).font(sans).fontSize(6.5).text(short(w.start), cx + 24 + i * stepX - 20, cy + ch + 4, { width: 40, align: "center" }));
  const labels: { y: number; text: string; color: string }[] = [];
  for (const e of m.engines) {
    const color = ENGINE_COLOR[e.engine] ?? INK;
    const pts = m.weeks.map((w, i) => ({ x: cx + 24 + i * stepX, v: w.engines[e.engine] })).filter((q) => q.v != null) as { x: number; v: number }[];
    if (!pts.length) continue;
    doc.lineWidth(2).strokeColor(color);
    pts.forEach((q, i) => { const yy = cy + ch - (q.v / 100) * ch; if (i === 0) doc.moveTo(q.x, yy); else doc.lineTo(q.x, yy); });
    if (pts.length > 1) doc.stroke();
    pts.forEach((q) => doc.circle(q.x, cy + ch - (q.v / 100) * ch, 2.5).fill(color));
    const last = pts[pts.length - 1];
    labels.push({ y: cy + ch - (last.v / 100) * ch, text: `${ENGINE_LABEL[e.engine] ?? e.engine} ${last.v}%`, color });
  }
  labels.sort((a, b) => a.y - b.y).forEach((l, i, arr) => { if (i && l.y - arr[i - 1].y < 10) l.y = arr[i - 1].y + 10; doc.fillColor(INK).font(sans).fontSize(7.5).text(l.text, cx + cw + 6, l.y - 4, { width: 84 }); });

  // Two columns: questions | competitors & sources
  y = cy + ch + 26;
  const colW = (CW - 16) / 2, leftX = X, rightX = X + colW + 16;
  const section = (x: number, yy: number, title: string, lines: string[], empty: string) => {
    doc.fillColor(INK).font(serif).fontSize(11).text(title, x, yy, { width: colW });
    let ly = doc.y + 4;
    for (const l of lines.length ? lines : [empty]) { doc.fillColor(lines.length ? INK : MUTED).font(sans).fontSize(8.5).text(l, x, ly, { width: colW }); ly = doc.y + 3; }
    return ly + 8;
  };
  let ly = section(leftX, y, "Won this month", m.won.slice(0, 4).map((q) => `• ${clip(q, 90)}`), "No question newly won.");
  ly = section(leftX, ly, "Lost this month", m.lost.slice(0, 4).map((q) => `• ${clip(q, 90)}`), "None lost.");
  ly = section(leftX, ly, "Where AI names you most", m.strongest.map((s) => `• ${clip(s.prompt, 70)} — ${s.named} of ${s.of}`), "Not named on any question without your name yet.");
  let ry = section(rightX, y, "Who AI named instead", m.competitors.slice(0, 5).map((c) => `• ${c.name}: ${ans(c.answers)}`).concat(m.competitors.length ? [`• You: ${ans(m.brandAnswers)}`] : []), "No tracked competitor was named.");
  ry = section(rightX, ry, "Sites AI read most", m.topSites.map((s) => `• ${s.domain} — ${ans(s.answers)}`), "—");
  ry = section(rightX, ry, "Done this month", [m.recsDone ? `${m.recsDone} recommendation${m.recsDone === 1 ? "" : "s"} marked done` : "No recommendation marked done yet."], "");

  // Next month
  y = Math.max(ly, ry) + 4;
  doc.roundedRect(X, y, CW, 20 + Math.max(1, m.plan.length) * 14, 6).fillAndStroke("#FFFFFF", LINE);
  doc.fillColor(CORAL).font(sans).fontSize(7).text("NEXT MONTH", X + 10, y + 8, { characterSpacing: 1 });
  (m.plan.length ? m.plan : ["Recommendations appear on your dashboard after your setup is checked."]).forEach((t, i) => doc.fillColor(INK).font(sans).fontSize(9).text(`${i + 1}. ${clip(t, 110)}`, X + 10, y + 20 + i * 14, { width: CW - 20 }));

  doc.fillColor(MUTED).font(sans).fontSize(6.5).text("Every figure counts stored answers from ChatGPT, Gemini and Perplexity (their APIs with web search on): one answer per question, AI and day. Blanks are shown as —. TrueVisible by The Growth Lab.",
    X, doc.page.height - 52, { width: CW });
  doc.end();
  return done;
}
