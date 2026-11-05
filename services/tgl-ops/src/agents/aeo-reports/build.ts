// Daily digest and weekly trend (plan Day 23). Pure functions over stored answers: every number is a count of
// answers from completed runs; nothing is estimated. One answer per question × engine × day (the latest that day).

export type AnswerRow = { prompt_id: string; prompt_text: string; engine: string; date: string; mentioned: boolean; competitors: string[]; created_at: string };
export type Ratio = { n: number; of: number };
export const ENGINE_ORDER = ["chatgpt", "gemini", "perplexity", "ai_overviews", "copilot"];
export const ENGINE_LABEL: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", ai_overviews: "AI Overviews", copilot: "Copilot" };

/** Latest answer per question × engine × day. */
export function dedupe(rows: AnswerRow[]): AnswerRow[] {
  const m = new Map<string, AnswerRow>();
  for (const r of rows) { const k = `${r.prompt_id}|${r.engine}|${r.date}`; const p = m.get(k); if (!p || r.created_at > p.created_at) m.set(k, r); }
  return [...m.values()];
}
const ratio = (rows: AnswerRow[]): Ratio => ({ n: rows.filter((r) => r.mentioned).length, of: rows.length });
const engines = (rows: AnswerRow[]) => ENGINE_ORDER.filter((e) => rows.some((r) => r.engine === e));

export type DailyContent = {
  kind: "daily"; brand: string; date: string; prevDate: string | null;
  overall: Ratio; prevOverall: Ratio | null;
  engines: { engine: string; today: Ratio; prev: Ratio | null }[];
  gained: { prompt: string; engine: string }[]; lost: { prompt: string; engine: string }[]; comparedPairs: number;
  competitors: { name: string; today: number; prev: number | null }[];
  newSites: string[]; openRecs: number; topRec: string | null;
};

export function buildDaily(p: { brand: string; date: string; today: AnswerRow[]; prev: AnswerRow[]; prevDate: string | null; competitorNames: string[];
  sitesToday: string[]; sitesBefore: string[]; openRecs: number; topRec: string | null }): DailyContent {
  const t = dedupe(p.today), y = dedupe(p.prev);
  const yKey = new Map(y.map((r) => [`${r.prompt_id}|${r.engine}`, r]));
  const pairs = t.filter((r) => yKey.has(`${r.prompt_id}|${r.engine}`));   // only questions asked on both days
  const gained = pairs.filter((r) => r.mentioned && !yKey.get(`${r.prompt_id}|${r.engine}`)!.mentioned).map((r) => ({ prompt: r.prompt_text, engine: r.engine }));
  const lost = pairs.filter((r) => !r.mentioned && yKey.get(`${r.prompt_id}|${r.engine}`)!.mentioned).map((r) => ({ prompt: r.prompt_text, engine: r.engine }));
  const before = new Set(p.sitesBefore);
  return {
    kind: "daily", brand: p.brand, date: p.date, prevDate: y.length ? p.prevDate : null,
    overall: ratio(t), prevOverall: y.length ? ratio(y) : null,
    engines: engines(t).map((e) => ({ engine: e, today: ratio(t.filter((r) => r.engine === e)), prev: y.some((r) => r.engine === e) ? ratio(y.filter((r) => r.engine === e)) : null })),
    gained, lost, comparedPairs: pairs.length,
    competitors: p.competitorNames.map((name) => ({ name, today: t.filter((r) => r.competitors.includes(name)).length, prev: y.length ? y.filter((r) => r.competitors.includes(name)).length : null }))
      .filter((c) => c.today || c.prev).sort((a, b) => b.today - a.today || a.name.localeCompare(b.name)),
    // New today, most-cited first (alphabetical order put arbitrary sites on top).
    newSites: [...p.sitesToday.reduce((m, d) => m.set(d, (m.get(d) ?? 0) + 1), new Map<string, number>())]
      .filter(([d]) => !before.has(d)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([d]) => d),
    openRecs: p.openRecs, topRec: p.topRec,
  };
}

/** Anything worth an email today? (The report is stored either way.) */
export function dailyHasNews(d: DailyContent): boolean {
  return d.gained.length > 0 || d.lost.length > 0 || d.newSites.length > 0 || !d.prevOverall
    || d.competitors.some((c) => c.prev != null && c.today !== c.prev);
}

export type WeeklyContent = {
  kind: "weekly"; brand: string; start: string; end: string;
  overall: Ratio; prevOverall: Ratio | null;
  engines: { engine: string; week: Ratio; prev: Ratio | null }[];
  unbranded: Ratio; days: number;
  strongest: { prompt: string; named: number; of: number }[]; neverNamed: string[];
  competitors: { name: string; answers: number }[]; brandAnswers: number;
  topSites: { domain: string; answers: number }[];
  recsDone: number; openRecs: number; topRec: string | null;
};

export function buildWeekly(p: { brand: string; start: string; end: string; week: AnswerRow[]; prevWeek: AnswerRow[]; isBranded: (text: string) => boolean;
  competitorNames: string[]; sites: { domain: string; answers: number }[]; recsDone: number; openRecs: number; topRec: string | null }): WeeklyContent {
  const w = dedupe(p.week), pw = dedupe(p.prevWeek);
  const byPrompt = new Map<string, { prompt: string; named: number; of: number; branded: boolean }>();
  for (const r of w) {
    const e = byPrompt.get(r.prompt_id) ?? { prompt: r.prompt_text, named: 0, of: 0, branded: p.isBranded(r.prompt_text) };
    e.of++; if (r.mentioned) e.named++; byPrompt.set(r.prompt_id, e);
  }
  const unb = [...byPrompt.values()].filter((x) => !x.branded);
  return {
    kind: "weekly", brand: p.brand, start: p.start, end: p.end,
    overall: ratio(w), prevOverall: pw.length ? ratio(pw) : null,
    engines: engines(w).map((e) => ({ engine: e, week: ratio(w.filter((r) => r.engine === e)), prev: pw.some((r) => r.engine === e) ? ratio(pw.filter((r) => r.engine === e)) : null })),
    unbranded: { n: unb.reduce((s, x) => s + x.named, 0), of: unb.reduce((s, x) => s + x.of, 0) }, days: new Set(w.map((r) => r.date)).size,
    strongest: unb.filter((x) => x.named > 0).sort((a, b) => b.named / b.of - a.named / a.of || b.named - a.named).slice(0, 3).map(({ prompt, named, of }) => ({ prompt, named, of })),
    neverNamed: unb.filter((x) => x.named === 0).map((x) => x.prompt).slice(0, 5),
    competitors: p.competitorNames.map((name) => ({ name, answers: w.filter((r) => r.competitors.includes(name)).length })).filter((c) => c.answers).sort((a, b) => b.answers - a.answers),
    brandAnswers: w.filter((r) => r.mentioned).length,
    topSites: [...p.sites].sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain)).slice(0, 5),
    recsDone: p.recsDone, openRecs: p.openRecs, topRec: p.topRec,
  };
}

export const pct = (r: Ratio | null) => (r && r.of ? Math.round((r.n / r.of) * 100) : null);

export type MonthlyContent = Omit<WeeklyContent, "kind"> & {
  kind: "monthly"; month: string;                                   // "2026-11"
  weeks: { start: string; engines: Record<string, number | null> }[];   // % of answers naming you per engine per week
  won: string[]; lost: string[];                                    // unbranded questions: named this month but not last / the reverse
  plan: string[];                                                   // top open recommendations for next month
};

/** Monthly review = the weekly shape over a calendar month, plus a weekly trend line and won/lost questions. */
export function buildMonthly(p: { brand: string; month: string; start: string; end: string; rows: AnswerRow[]; prevRows: AnswerRow[]; isBranded: (text: string) => boolean;
  competitorNames: string[]; sites: { domain: string; answers: number }[]; recsDone: number; openRecs: number; plan: string[] }): MonthlyContent {
  const base = buildWeekly({ ...p, week: p.rows, prevWeek: p.prevRows, topRec: p.plan[0] ?? null });
  const rows = dedupe(p.rows), prev = dedupe(p.prevRows);
  const weekStart = (d: string) => { const dow = new Date(d + "T00:00:00Z").getUTCDay(); return new Date(Date.parse(d + "T00:00:00Z") - ((dow + 6) % 7) * 86_400_000).toISOString().slice(0, 10); };
  const starts = [...new Set(rows.map((r) => weekStart(r.date)))].sort();
  const weeks = starts.map((s) => {
    const inWeek = rows.filter((r) => weekStart(r.date) === s);
    return { start: s, engines: Object.fromEntries(base.engines.map((e) => {
      const x = inWeek.filter((r) => r.engine === e.engine);
      return [e.engine, x.length ? Math.round((x.filter((r) => r.mentioned).length / x.length) * 100) : null];
    })) };
  });
  const namedSet = (xs: AnswerRow[]) => new Set(xs.filter((r) => r.mentioned && !p.isBranded(r.prompt_text)).map((r) => r.prompt_text));
  const askedPrev = new Set(prev.map((r) => r.prompt_text));
  const now = namedSet(rows), before = namedSet(prev);
  return {
    ...base, kind: "monthly", month: p.month, weeks,
    won: [...now].filter((q) => askedPrev.has(q) && !before.has(q)).sort(),
    lost: [...before].filter((q) => rows.some((r) => r.prompt_text === q) && !now.has(q)).sort(),
    plan: p.plan.slice(0, 3),
  };
}

/** First and last day of the month before `today`, plus the month before that (pure). */
export function previousMonth(today: string): { month: string; start: string; end: string; prevStart: string; prevEnd: string } {
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1)), last = new Date(Date.UTC(y, m - 1, 0));
  const pFirst = new Date(Date.UTC(y, m - 3, 1)), pLast = new Date(Date.UTC(y, m - 2, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { month: iso(first).slice(0, 7), start: iso(first), end: iso(last), prevStart: iso(pFirst), prevEnd: iso(pLast) };
}
