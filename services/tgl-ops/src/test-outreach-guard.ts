// services/tgl-ops/src/test-outreach-guard.ts
// The last check before an outreach email is sent: the two false emails of 21 Nov would have been held.
import assert from "node:assert/strict";
import { checkMessage } from "./agents/outreach-sequencer/guard.js";
import { makeExecute, type ExecutorPorts, type ProspectView } from "./agents/outreach-sequencer/execute.js";
import type { AuditSummary, OutreachState } from "./agents/outreach-sequencer/types.js";

const audit: AuditSummary = { visibility_percent: 20, mentions: 3, total_queries: 15, mentions_by_engine: {}, top_competitors: ["The Smile Designers"], competitor_mentions: { "The Smile Designers": 4 }, top_cited_domains: [], audited_at: "2026-11-21T08:00:00Z" };
const ctx = { company: "Chandigarh Dental Clinic", city: "Chandigarh Tricity", audit };

// The email that went out on 21 Nov.
const sent = "Dr Bhalla, I asked ChatGPT, Gemini and Perplexity five questions a customer in Chandigarh Tricity asks before choosing a dental clinic. Chandigarh Dental Clinic was named in 3 of 15 answers. Panchkula was named in 12.";
assert.ok(checkMessage(sent, ctx).some((p) => /Panchkula/.test(p)));
const hyd = "Dr Sris, I asked ChatGPT, Gemini and Perplexity five questions. Dr Sris Dental & Implant Clinic was named in 0 of 15 answers. Hyderabad was named in 14.";
assert.ok(checkMessage(hyd, { company: "Dr Sris Dental & Implant Clinic - Gachibowli, Hyderabad", city: "Hyderabad", audit: { ...audit, mentions: 0 } }).some((p) => /Hyderabad/.test(p)));

// Correct emails pass.
assert.deepEqual(checkMessage("Dr Bhalla, I asked five questions. Chandigarh Dental Clinic was named in 3 of 15 answers. The Smile Designers was named in 4.", ctx), []);
assert.deepEqual(checkMessage('Dr Bhalla, one line from the report: for "Which dental clinic in Chandigarh Tricity should I trust", The Smile Designers is named and Chandigarh Dental Clinic is not. Want the walkthrough?', ctx), []);
assert.deepEqual(checkMessage("Dr Bhalla, last note from me. Reply STOP and I will not write again.", ctx), []);

// Wrong numbers are caught.
assert.ok(checkMessage("Chandigarh Dental Clinic was named in 5 of 15 answers.", ctx).length > 0);
assert.ok(checkMessage("Chandigarh Dental Clinic was named in 3 of 20 answers.", ctx).length > 0);
assert.ok(checkMessage("Hello. The Smile Designers was named in 9.", ctx).length > 0);

// In the executor: held, paused, alerted, nothing sent; a good message is sent and shown.
async function main() {
  let state: OutreachState = { state: "active", enrolled_at: "2026-11-21T07:00:00Z", next_touch: 1, next_due_at: "2026-11-21T07:00:00Z", touches: [], audit, onepager_path: "x.pdf" };
  const sentMsgs: string[] = [];
  const shown: string[] = [];
  const guarded: string[][] = [];
  let body = sent;
  const ports: ExecutorPorts = {
    now: () => new Date("2026-11-21T08:00:00Z"),
    senderName: "Tejinder", whatsappEnabled: false, auditEveryTouch: true,
    render: () => ({ subject: "Chandigarh Dental Clinic in 3 of 15 AI answers", text: body, html: "" }),
    loadProspect: async () => ({ id: "p1", company: "Chandigarh Dental Clinic", category: "cosmetic_dental", city: "Chandigarh Tricity", decisionMakerName: "Dr. Vivek Bhalla", outreach: state, email: "dr@x.example" } as ProspectView),
    saveState: async (_id, s) => { state = s; },
    buildOnePager: async () => ({ audit, path: "x.pdf" }),
    signOnePagerUrl: async () => "https://x.test/x.pdf",
    upsertContact: async () => "",
    sendMessage: async (m) => { sentMsgs.push(m.message.text); return { messageId: "m1" }; },
    onSent: async ({ message }) => { shown.push(message.text); },
    onGuard: async ({ problems }) => { guarded.push(problems); },
  };
  const exec = makeExecute(ports);
  const item = { prospectId: "p1", company: "Chandigarh Dental Clinic", touch: 1 as const, channel: "email" as const, dueAt: state.next_due_at };
  const held = await exec(item, "live");
  assert.equal(held.status, "held");
  assert.equal(sentMsgs.length, 0, "nothing sent");
  assert.equal(state.state, "paused");
  assert.equal(guarded.length, 1);

  state = { ...state, state: "active", pause_reason: undefined };
  body = "Dr Bhalla, I asked five questions. Chandigarh Dental Clinic was named in 3 of 15 answers. The Smile Designers was named in 4.";
  const ok = await exec(item, "live");
  assert.equal(ok.status, "sent");
  assert.deepEqual(shown, [body], "every sent email is shown in #revenue");
  console.log("test-outreach-guard: all checks passed");
}
main().catch((err) => { console.error(err); process.exit(1); });
