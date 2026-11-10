// The 90-day plan's rules (plan Day 29b, SPEC §8). Pure and tested: scope by tier, which month a week is in,
// and the checks every drafted plan must pass before anyone sees it.

export type Tier = "managed" | "managed_plus";
export type Scope = { pages_per_month: number; outreach_per_month: number; gbp_profiles: number; prompts_in_scope: number };
/** Scope limits (Architect, 10 Nov 2026): Managed 4 pages / 10 outreach / 1 profile; Plus 8 / 20 / up to 5. TGL follows Plus. */
export function scopeFor(tier: Tier, prompts: number): Scope {
  return tier === "managed_plus"
    ? { pages_per_month: 8, outreach_per_month: 20, gbp_profiles: 5, prompts_in_scope: Math.min(prompts, 100) }
    : { pages_per_month: 4, outreach_per_month: 10, gbp_profiles: 1, prompts_in_scope: Math.min(prompts, 50) };
}
export function tierFor(plan: string): Tier | null {
  return plan === "managed_plus" || plan === "internal" ? "managed_plus" : plan === "managed" ? "managed" : null;
}

export const KINDS = ["page", "technical", "outreach", "listing", "gbp", "review", "measure"] as const;
export type Kind = (typeof KINDS)[number];
export const PATHS = ["wordpress", "change_pack", "offsite", "gbp", "team"] as const;
export type Item = { id: string; week: number; title: string; detail: string; kind: Kind; path: (typeof PATHS)[number]; count: number; recommendation_id: string | null };
export type Month = { month: 1 | 2 | 3; theme: string; focus: string };

/** Weeks 1–4 are month 1, 5–8 month 2, 9–13 month 3. */
export const monthOf = (week: number): 1 | 2 | 3 => (week <= 4 ? 1 : week <= 8 ? 2 : 3);
const PAGES = new Set<Kind>(["page"]);
const OUTREACH = new Set<Kind>(["outreach", "listing"]);

/** Words a plan must never use: placement guarantees and invented results (excluded everywhere per the tiers decision). */
const PROMISE = /\b(guarantee[ds]?|guaranteed|assure[ds]?|promise[ds]?|rank(?:ed|ing)? #?1|top (?:spot|position)|will (?:be )?(?:named|cited|recommended|rank))\b/i;
/** Saying there is NO guarantee is honest, not a promise: drop negated phrases before looking for promises. */
const denied = (t: string) => t.replace(/\b(?:no|not(?: a| an)?|nothing(?: here)? is a|never(?: a)?|without(?: a)?|isn't a|is not a)\s+(?:\w+\s+){0,2}?(?:guarantee[ds]?|promise[ds]?)(?:\s+of\s+\w+)?/gi, " ");
const MADE_UP_NUMBER = /\b\d+(?:\.\d+)?\s?(?:%|percent|x\b|times)/i;

export type Checks = { passed: boolean; problems: string[]; usage: { month: number; pages: number; outreach: number }[] };

/** Every rule a plan must meet; any problem sends it to a person (pure; tested). */
export function checkPlan(p: { summary: string; months: Month[]; items: Item[] }, scope: Scope, openRecIds: Set<string>): Checks {
  const problems: string[] = [];
  if (p.months.length !== 3 || [1, 2, 3].some((m) => !p.months.find((x) => x.month === m))) problems.push("needs exactly three months");
  if (p.items.length < 9) problems.push(`only ${p.items.length} items for 13 weeks`);
  for (const w of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
    const n = p.items.filter((i) => i.week === w).length;
    if (n > 4) problems.push(`week ${w} has ${n} items (max 4)`);
  }
  if (!p.items.some((i) => i.week <= 2 && (i.kind === "technical" || i.kind === "page"))) problems.push("weeks 1–2 should fix the site foundations first");
  const usage = ([1, 2, 3] as const).map((m) => {
    const mine = p.items.filter((i) => monthOf(i.week) === m);
    return { month: m, pages: mine.filter((i) => PAGES.has(i.kind)).reduce((s, i) => s + i.count, 0), outreach: mine.filter((i) => OUTREACH.has(i.kind)).reduce((s, i) => s + i.count, 0) };
  });
  for (const u of usage) {
    if (u.pages > scope.pages_per_month) problems.push(`month ${u.month}: ${u.pages} pages, scope is ${scope.pages_per_month}`);
    if (u.outreach > scope.outreach_per_month) problems.push(`month ${u.month}: ${u.outreach} outreach/listings, scope is ${scope.outreach_per_month}`);
  }
  for (const i of p.items) {
    if (i.recommendation_id && !openRecIds.has(i.recommendation_id)) problems.push(`"${i.title}" points at a recommendation that isn't open`);
    if (i.kind === "page" && i.path === "offsite") problems.push(`"${i.title}" is a page but marked off-site`);
  }
  for (const [where, text] of [["summary", p.summary], ...p.months.map((m) => [`month ${m.month}`, `${m.theme} ${m.focus}`]), ...p.items.map((i) => [`"${i.title}"`, `${i.title} ${i.detail}`])] as [string, string][]) {
    if (PROMISE.test(denied(text))) problems.push(`${where} promises a result`);
    if (MADE_UP_NUMBER.test(text)) problems.push(`${where} quotes a number we didn't measure`);
  }
  return { passed: problems.length === 0, problems: [...new Set(problems)].slice(0, 20), usage };
}

/** Review mode (env AEO_PLAN_REVIEW): "all" — a person approves every plan; "flagged" — plans that pass every check go
 *  live by themselves, only flagged ones need a person, and every Nth auto-approved plan is still sampled for a person. */
export function needsPerson(o: { mode: string; passed: boolean; autoApprovedSoFar: number; sampleEvery: number }): { person: boolean; why: string } {
  if (o.mode !== "flagged") return { person: true, why: "review mode: every plan" };
  if (!o.passed) return { person: true, why: "failed checks" };
  if (o.sampleEvery > 0 && (o.autoApprovedSoFar + 1) % o.sampleEvery === 0) return { person: true, why: `spot check (1 in ${o.sampleEvery})` };
  return { person: false, why: "passed every check" };
}
