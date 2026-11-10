// The Slack card for one 90-day plan (plan Day 29b).
import type { Checks, Item, Month, Scope } from "./plan.js";

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const PATH: Record<string, string> = { wordpress: "WP", change_pack: "pack", offsite: "off-site", gbp: "GBP", team: "team" };

export function planBlocks(o: { planId: string; brand: string; domain: string | null; tier: string; scope: Scope; baseline: any; summary: string; months: Month[]; items: Item[]; checks: Checks; why: string; costUsd: number; buttons: boolean }): any[] {
  const head = [
    `*${esc(o.brand)}*${o.domain ? ` · <https://${o.domain}|${o.domain}>` : ""} · ${o.tier === "managed_plus" ? "Managed Plus" : "Managed"}`,
    `*Scope / month:* ${o.scope.pages_per_month} pages · ${o.scope.outreach_per_month} outreach/listings · ${o.scope.gbp_profiles} GBP profile${o.scope.gbp_profiles === 1 ? "" : "s"} · ${o.scope.prompts_in_scope} questions`,
    `*Baseline (measured ${o.baseline.from} – ${o.baseline.to}):* named in ${o.baseline.named} of ${o.baseline.answers} answers · own site cited in ${o.baseline.own_site_cited}`,
  ].join("\n");
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: cut(`90-day plan · ${o.brand}`, 150) } },
    { type: "context", elements: [{ type: "mrkdwn", text: `*Agent:* \`aeo-planner\` | plan \`${o.planId.slice(0, 8)}\` | ${o.why} | $${o.costUsd.toFixed(3)}` }] },
    { type: "section", text: { type: "mrkdwn", text: cut(head, 2900) } },
    { type: "section", text: { type: "mrkdwn", text: cut(`*Summary:* ${esc(o.summary)}`, 2900) } },
  ];
  for (const m of o.months) {
    const weeks = o.items.filter((i) => (m.month === 1 ? i.week <= 4 : m.month === 2 ? i.week >= 5 && i.week <= 8 : i.week >= 9));
    const use = o.checks.usage.find((u) => u.month === m.month);
    blocks.push({ type: "section", text: { type: "mrkdwn", text: cut(
      `*Month ${m.month} — ${esc(m.theme)}* _(${use?.pages ?? 0} pages · ${use?.outreach ?? 0} outreach)_\n${esc(m.focus)}\n` +
      weeks.map((i) => `• W${i.week} [${i.kind}·${PATH[i.path] ?? i.path}${i.count > 1 ? `·×${i.count}` : ""}] ${esc(i.title)}${i.recommendation_id ? " ↔ rec" : ""}`).join("\n"), 2900) } });
  }
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: o.checks.passed ? "✅ Passed every check (scope, foundations first, no promises or unmeasured numbers, linked recommendations open)" : cut(`⚠️ *Checks:* ${o.checks.problems.map(esc).join("; ")}`, 2900) }] });
  if (o.buttons) {
    blocks.push({ type: "actions", elements: [
      { type: "button", style: "primary", action_id: "plan_approve", value: o.planId, text: { type: "plain_text", text: "Approve — show the client" } },
      { type: "button", style: "danger", action_id: "plan_changes", value: o.planId, text: { type: "plain_text", text: "Needs changes" } },
    ] });
  }
  return blocks;
}

export function decided(original: any[], outcome: string): any[] {
  return [...(original ?? []).filter((b) => b.type !== "actions"), { type: "section", text: { type: "mrkdwn", text: outcome } }];
}
