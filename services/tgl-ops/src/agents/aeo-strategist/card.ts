// services/tgl-ops/src/agents/aeo-strategist/card.ts — the #approvals card for one setup review.
import type { Proposal, Selection, SetupSnapshot } from "./types.js";

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const opt = (value: string, text: string, description?: string) => ({
  value,
  text: { type: "plain_text", text: cut(text, 75), emoji: false },
  ...(description ? { description: { type: "plain_text", text: cut(description, 75), emoji: false } } : {}),
});

function group(blockId: string, label: string, options: ReturnType<typeof opt>[]): any[] {
  if (!options.length) return [];
  const capped = options.slice(0, 10); // Slack: max 10 options per checkbox group
  return [
    { type: "section", block_id: `${blockId}_label`, text: { type: "mrkdwn", text: `*${label}*` } },
    { type: "actions", block_id: blockId, elements: [{ type: "checkboxes", action_id: `setup_select_${blockId}`, options: capped, initial_options: capped }] },
  ];
}

export function buildReviewBlocks(s: SetupSnapshot, p: Proposal, reviewId: string, evidenceLine: string): any[] {
  const setup = [
    `*Brand:* ${esc(s.name)}${s.domain ? ` · <https://${s.domain}|${s.domain}>` : " · no website"} · ${s.platform ?? "—"}`,
    `*Workspace:* ${esc(s.tenantName)} (\`${s.tenantId}\`) · plan *${s.plan}* · ${s.promptLimit} prompts`,
    `*Market:* ${s.market ? `${esc(s.market.product)} · ${esc(s.market.icp)} · ${esc(s.market.location)}` : "—"} · *Languages:* ${s.languages.join(", ")}`,
    `*Competitors:* ${s.competitors.length ? s.competitors.map((c) => esc(c.name)).join(", ") : "none entered"}`,
    `*Prompts (${s.prompts.length}):*\n${s.prompts.map((x, i) => `${i + 1}. ${esc(cut(x.text, 110))} _(${x.language} · ${x.journey_phase})_`).join("\n")}`,
  ].join("\n");

  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: cut(`Setup check · ${s.name}`, 150) } },
    { type: "context", elements: [{ type: "mrkdwn", text: `*Agent:* \`aeo-strategist\` | *Door:* \`aeo\` | review \`${reviewId.slice(0, 8)}\` | ${evidenceLine}` }] },
    { type: "section", text: { type: "mrkdwn", text: cut(setup, 2900) } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: `*Strategist:* ${esc(p.summary)}` } },
  ];

  if (p.market) {
    const parts = (["product", "icp", "location"] as const).filter((k) => p.market![k]).map((k) => `${k}: ${p.market![k]}`);
    blocks.push(...group("setup_mk", "Market wording", [opt("mk:0", parts.join(" · "), p.market.reason)]));
  }
  blocks.push(...group("setup_ca", "Add competitors (named in the evidence)", p.competitorsAdd.map((c, i) => opt(`ca:${i}`, `+ ${c.name}${c.domain ? ` (${c.domain})` : ""}`, c.evidence ? `“${c.evidence}”` : undefined))));
  blocks.push(...group("setup_cr", "Remove competitors", p.competitorsRemove.map((c, i) => opt(`cr:${i}`, `− ${c.name}`, c.reason))));
  blocks.push(...group("setup_pr", "Retire prompts", p.promptsRetire.map((x, i) => opt(`pr:${i}`, `− ${x.text}`, x.reason))));
  blocks.push(...group("setup_pa", "Add prompts", p.promptsAdd.map((x, i) => opt(`pa:${i}`, `+ ${x.text}`, `${x.language} · ${x.journey_phase} — ${x.reason}`))));
  if (p.dropped.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: cut(`_Not offered (failed checks): ${p.dropped.map(esc).join("; ")}_`, 2900) }] });
  }

  const hasChanges = !!(p.market || p.competitorsAdd.length || p.competitorsRemove.length || p.promptsRetire.length || p.promptsAdd.length);
  blocks.push({
    type: "actions",
    block_id: "setup_decision",
    elements: [
      ...(hasChanges ? [{ type: "button", style: "primary", action_id: "setup_approve", value: reviewId, text: { type: "plain_text", text: "Approve ticked changes" } }] : []),
      { type: "button", ...(hasChanges ? {} : { style: "primary" }), action_id: "setup_approve_asis", value: reviewId, text: { type: "plain_text", text: hasChanges ? "Approve as entered" : "Approve setup" } },
      { type: "button", style: "danger", action_id: "setup_changes", value: reviewId, text: { type: "plain_text", text: "Needs changes" } },
    ],
  });
  return blocks;
}

/** Ticked options from a Slack block_actions payload (state.values). */
export function readSelection(stateValues: any): Selection {
  const sel: Selection = new Set();
  for (const block of Object.values(stateValues ?? {}) as any[]) {
    for (const el of Object.values(block ?? {}) as any[]) {
      if (el?.type === "checkboxes") for (const o of el.selected_options ?? []) sel.add(o.value);
    }
  }
  return sel;
}

/** Replaces the decision buttons and tick boxes with the outcome, keeping the setup summary. */
export function decidedBlocks(original: any[], outcome: string): any[] {
  const keep = (original ?? []).filter((b) => b.type !== "actions" && !(typeof b.block_id === "string" && b.block_id.endsWith("_label")));
  return [...keep, { type: "section", text: { type: "mrkdwn", text: outcome } }];
}
