// services/tgl-ops/src/test-card-button-size.ts
// A card whose summary is long (the 13 Nov Mumbai prospect card listed eight businesses) must still post:
// Slack rejects the whole message when a button value is over 2000 characters. Offline: builds blocks only.
import assert from "node:assert/strict";
import { buildCardBlocks, buttonMetadata, SLACK_BUTTON_VALUE_MAX } from "./lib/post.js";

const row = (i: number) =>
  `*${i}. <https://clinic${i}.example.in/|Fertility Clinic ${i} : Top IVF Centre in Bandra Mumbai l Best IVF Treatment>* (Score: *80*) · Mumbai\n` +
  `   ↳ *Owner / Lead Doctor* (Owner / Lead Doctor) · \`info@clinic${i}.example.in\` · [phone]\n` +
  `   ↳ _AI visibility: gemini asked "best ivf clinic in Mumbai" on 2026-11-13: prospect not named; names found: ${'Clinic "Quoted" Name, '.repeat(12)}_`;
const summary = `*Top 25 Prospects — Mumbai (ivf_fertility)*\n\n${Array.from({ length: 8 }, (_, i) => row(i + 1)).join("\n\n")}`;
assert.ok(summary.length > 4000, "fixture is longer than Slack allows in a button");

const blocks = buildCardBlocks({ channel: "C1", agent: "prospect-researcher", door: "aeo", title: "Top 25 Prospects — Mumbai (ivf_fertility)", summary, actions: ["approve", "reject", "discuss"], extraMeta: { city: "Mumbai", category: "ivf_fertility" } } as any);
const buttons = blocks.filter((b) => b.type === "actions").flatMap((b) => b.elements);
assert.equal(buttons.length, 3);
for (const btn of buttons) {
  assert.ok(btn.value.length <= SLACK_BUTTON_VALUE_MAX, `button value ${btn.value.length} characters`);
  const meta = JSON.parse(btn.value);
  assert.equal(meta.agent, "prospect-researcher");
  assert.equal(meta.city, "Mumbai");
  assert.ok(summary.startsWith(meta.summary.replace(/…$/, "")), "the start of the summary is kept");
}
// The card text itself is complete.
assert.equal(blocks.filter((b) => b.type === "section").map((b) => b.text.text).join("").includes("Fertility Clinic 8"), true);

// Short metadata is untouched; absurd metadata still fits.
const short = { agent: "a", title: "t", summary: "short" };
assert.equal(buttonMetadata(short), JSON.stringify(short));
assert.ok(buttonMetadata({ agent: "a", title: "x".repeat(5000), summary: "y".repeat(5000) }).length <= SLACK_BUTTON_VALUE_MAX);

console.log("test-card-button-size: all checks passed");
