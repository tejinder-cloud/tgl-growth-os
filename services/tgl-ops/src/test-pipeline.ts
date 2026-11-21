// services/tgl-ops/src/test-pipeline.ts
// Sales pipeline: automatic stages only move forward; the Architect's taps after a call; Won goes to Finance.
import assert from "node:assert/strict";
import { createPipeline } from "./agents/pipeline/service.js";
import { createMemoryDealStore } from "./agents/pipeline/store.js";
import { canAdvance, money } from "./agents/pipeline/stages.js";
import { afterCallBlocks, handlePipelineAction, handlePipelineModal, pipelineModalResponse, stageBlocks, PROPOSAL_MODAL, LOST_MODAL, type SlackPorts } from "./agents/pipeline/slack.js";

async function main() {
  assert.equal(canAdvance("in_outreach", "replied"), true);
  assert.equal(canAdvance("call_booked", "replied"), false, "never backward");
  assert.equal(canAdvance("won", "replied"), false, "closed stays closed");
  assert.equal(money(25000, "INR"), "Rs 25,000 a month");
  assert.equal(money(500, "USD"), "$500 a month");

  let now = new Date("2026-11-21T08:00:00Z");
  const store = createMemoryDealStore();
  const asked: string[] = [];
  const notes: string[] = [];
  const wonCalls: string[] = [];
  const pl = createPipeline({
    store,
    now: () => now,
    notify: async (t) => { notes.push(t); },
    askAfterCall: async (d) => { asked.push(d.id); },
    onWon: async (d) => { wonCalls.push(d.id); return "Finance drafted invoice TGL/26-27/0001."; },
  });
  const c = { company: "Luma Fertility", name: "Neha", email: "Neha@Luma.example", city: "Mumbai" };

  // Outreach starts, they reply, they book: one deal moving forward.
  const d1 = await pl.outreachStarted(c, "p1");
  assert.equal(d1.stage, "in_outreach");
  await pl.replied(c, "p1");
  assert.equal(store.rows[0].stage, "replied");
  await pl.callBooked(c, "b1", "2026-11-23T09:30:00.000Z", "p1");
  assert.equal(store.rows.length, 1, "one deal per business");
  assert.equal(store.rows[0].stage, "call_booked");
  assert.equal(store.rows[0].booking_id, "b1");
  await pl.replied(c, "p1");
  assert.equal(store.rows[0].stage, "call_booked", "a late reply does not move it back");

  // Cancelled booking: back to where it was.
  await pl.bookingCancelled("b1");
  assert.equal(store.rows[0].stage, "replied");
  await pl.callBooked({ ...c, email: "neha@luma.example" }, "b2", "2026-11-23T10:00:00.000Z");
  assert.equal(store.rows[0].stage, "call_booked", "matched by email when the booking has no prospect id");

  // After the call: asked once, 30 minutes after it starts.
  now = new Date("2026-11-23T10:20:00Z");
  assert.equal(await pl.askAboutEndedCalls(), 0, "not yet");
  now = new Date("2026-11-23T10:31:00Z");
  assert.equal(await pl.askAboutEndedCalls(), 1);
  assert.equal(await pl.askAboutEndedCalls(), 0, "asked only once");

  // Taps.
  assert.equal((await pl.won(d1.id, "Tejinder")).ok, false, "no Won before a proposal with an amount");
  assert.equal((await pl.callHappened(d1.id, "Tejinder")).ok, true);
  const prop = await pl.proposalSent(d1.id, 30000, "INR", "Tejinder");
  assert.equal(prop.ok, true);
  assert.equal(store.rows[0].amount, 30000);
  const won = await pl.won(d1.id, "Tejinder");
  assert.equal(won.ok, true);
  assert.deepEqual(wonCalls, [d1.id]);
  assert.match(notes.at(-1)!, /^Deal won: Luma Fertility, Rs 30,000 a month\. Finance drafted invoice/);
  assert.equal((await pl.lost(d1.id, "x", "Tejinder")).ok, false, "a won deal cannot be lost");
  assert.deepEqual(store.rows[0].history.map((h) => h.stage), ["in_outreach", "replied", "call_booked", "replied", "call_booked", "call_done", "proposal_sent", "won"]);

  // A new signal for the same person after Won opens a new deal.
  await pl.auditRequested({ ...c }, "s1");
  assert.equal(store.rows.length, 2);
  assert.equal(store.rows[1].stage, "audit_requested");
  assert.equal((await pl.noShow(store.rows[1].id, "T")).ok, false);
  const lost = await pl.lost(store.rows[1].id, "Budget", "Tejinder");
  assert.equal(lost.ok, true);
  assert.equal((await pl.proposalSent(store.rows[1].id, 0, "USD", "T")).ok, false);
  assert.deepEqual(await store.counts(), { proposalsSent: 1, won: 1 });

  // --- Slack ---
  const d3 = await pl.callBooked({ company: "Dr Sris Dental", name: "Dr Sris", email: "drsris@x.example" }, "b3", "2026-11-23T11:00:00.000Z");
  const posted: string[] = [];
  const updated: { text: string; blocks: any[] }[] = [];
  const modals: any[] = [];
  let architect = true;
  const ports: SlackPorts = {
    pipeline: pl,
    getDeal: (id) => store.get(id),
    isArchitect: async () => architect,
    actorName: async () => "Tejinder Singh",
    updateMessage: async (_c, _t, text, blocks) => { updated.push({ text, blocks: blocks as any[] }); },
    postThread: async (_c, _t, text) => { posted.push(text); },
    openModal: async (_t, view) => { modals.push(view); },
  };
  const payload = (action_id: string) => ({ user: { id: "U1" }, channel: { id: "C1" }, container: { message_ts: "1.1" }, trigger_id: "T", actions: [{ action_id, value: d3.id }] });
  assert.equal(JSON.stringify(afterCallBlocks(d3)).includes("pipeline_call_done"), true);

  architect = false;
  assert.equal(await handlePipelineAction(payload("pipeline_call_done"), payload("pipeline_call_done").actions[0], ports), "not_architect");
  assert.equal(d3.stage, "call_booked");
  architect = true;
  assert.equal(await handlePipelineAction(payload("pipeline_call_done"), payload("pipeline_call_done").actions[0], ports), "call_done");
  assert.match(JSON.stringify(updated.at(-1)!.blocks), /pipeline_proposal/);
  assert.equal(await handlePipelineAction(payload("pipeline_proposal"), payload("pipeline_proposal").actions[0], ports), "modal");
  assert.equal(modals.at(-1).callback_id, PROPOSAL_MODAL);

  const submit = (callback_id: string, values: any) => ({ user: { id: "U1" }, view: { callback_id, private_metadata: JSON.stringify({ id: d3.id, channel: "C1", ts: "1.1" }), state: { values } } });
  assert.equal(pipelineModalResponse(submit(PROPOSAL_MODAL, { amount: { v: { value: "" } } })).response_action, "errors");
  const usd = submit(PROPOSAL_MODAL, { amount: { v: { value: "750" } }, currency: { v: { selected_option: { value: "USD" } } } });
  assert.equal(pipelineModalResponse(usd).response_action, "clear");
  assert.equal(await handlePipelineModal(usd, ports), "proposal_sent");
  assert.equal(d3.currency, "USD");
  assert.match(updated.at(-1)!.blocks[0].text.text, /Proposal sent: \$750 a month/);
  assert.match(JSON.stringify(updated.at(-1)!.blocks), /pipeline_won/);
  assert.equal(pipelineModalResponse(submit(LOST_MODAL, { reason: { v: { value: " " } } })).response_action, "errors");
  assert.equal(await handlePipelineModal(submit(LOST_MODAL, { reason: { v: { value: "Chose another agency" } } }), ports), "lost");
  assert.equal(stageBlocks(d3, "x").length, 1, "no buttons on a closed deal");

  console.log("test-pipeline: all checks passed");
}
main().catch((err) => { console.error(err); process.exit(1); });
