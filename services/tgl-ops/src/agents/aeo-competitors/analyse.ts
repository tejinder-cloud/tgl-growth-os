// Competitor intelligence (plan Day 30). Pure and tested: who AI names, where they win and you don't, and which sites
// the answers naming them cite. Every number is a count of stored answers; the model never supplies one.
import { containsName } from "../aeo-recommender/gather.js";

export type Ans = { id: string; prompt_id: string; prompt: string; engine: string; run_date: string; mentioned: boolean; text: string; tracked: string[] };
export type Cit = { answer_id: string; domain: string };

export type Rival = {
  name: string; tracked: boolean;
  answers: number;                   // answers naming them
  winsOverYou: number;               // answers naming them and not you
  engines: string[];
  questions: { prompt: string; answers: number }[];   // where they're named and you aren't, most first
  sites: { domain: string; answers: number }[];       // cited in the answers that name them and not you
};

/** Answers naming a name: tracked names from the tracker's own match; others by whole-word match in the text. */
function names(a: Ans, name: string, tracked: boolean): boolean {
  return tracked ? a.tracked.includes(name) : containsName(a.text, [name]);
}

export function rivals(answers: Ans[], cits: Cit[], tracked: string[], discovered: string[], ownDomain: string | null): Rival[] {
  const citeBy = new Map<string, string[]>();
  for (const c of cits) { const d = c.domain.replace(/^www\./, ""); if (ownDomain && d.endsWith(ownDomain.replace(/^www\./, ""))) continue; citeBy.set(c.answer_id, [...(citeBy.get(c.answer_id) ?? []), d]); }
  const all = [...tracked.map((n) => ({ n, t: true })), ...discovered.filter((d) => !tracked.some((t) => t.toLowerCase() === d.toLowerCase())).map((n) => ({ n, t: false }))];
  return all.map(({ n, t }) => {
    const mine = answers.filter((a) => names(a, n, t));
    const wins = mine.filter((a) => !a.mentioned);
    const q = new Map<string, number>(); for (const a of wins) q.set(a.prompt, (q.get(a.prompt) ?? 0) + 1);
    const s = new Map<string, number>(); for (const a of wins) for (const d of new Set(citeBy.get(a.id) ?? [])) s.set(d, (s.get(d) ?? 0) + 1);
    return {
      name: n, tracked: t, answers: mine.length, winsOverYou: wins.length,
      engines: [...new Set(mine.map((a) => a.engine))].sort(),
      questions: [...q.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([prompt, answers]) => ({ prompt, answers })),
      sites: [...s.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([domain, answers]) => ({ domain, answers })),
    };
  }).sort((a, b) => b.winsOverYou - a.winsOverYou || b.answers - a.answers);
}

/** Names the model proposed, kept only if they really appear (whole word) in at least `min` answers and aren't the
 *  brand, a tracked competitor, an AI product or a listing site. */
const NOT_RIVALS = /^(chatgpt|openai|gemini|google|perplexity|copilot|microsoft|bing|meta|facebook|instagram|linkedin|youtube|reddit|quora|wikipedia|semrush|ahrefs|hubspot|justdial|sulekha|indiamart|clutch|sortlist|goodfirms|upwork|fiverr|amazon|flipkart|shopify|wordpress|wix)$/i;
export function verifyDiscovered(proposed: string[], answers: Ans[], brandNames: string[], tracked: string[], min = 2): { name: string; answers: number }[] {
  const seen = new Set<string>();
  const out: { name: string; answers: number }[] = [];
  for (const raw of proposed) {
    const name = raw.replace(/\s+/g, " ").trim().slice(0, 80);
    const key = name.toLowerCase();
    if (name.length < 3 || seen.has(key) || NOT_RIVALS.test(name)) continue;
    seen.add(key);
    if (brandNames.some((b) => b.toLowerCase() === key || containsName(name, [b]))) continue;
    if (tracked.some((t) => t.toLowerCase() === key)) continue;
    const n = answers.filter((a) => containsName(a.text, [name])).length;
    if (n >= min) out.push({ name, answers: n });
  }
  return out.sort((a, b) => b.answers - a.answers).slice(0, 8);
}
