// Offline checks for the 26 Nov outreach changes: follow-ups before first emails, the new first email with its
// two subject lines, and a YES reply carrying the report. Nothing is sent.
import assert from "node:assert/strict";
import path from "node:path";
import { loadTemplates, renderFromTemplates, subjectVariant } from "./agents/outreach-sequencer/templates.js";
import { runTick } from "./agents/outreach-sequencer/worker.js";
import { suggestReply, handleSuggestedReplyAction, draftReply } from "./agents/outreach-sequencer/suggested-reply.js";

const AUDIT: any = { visibility_percent: 0, mentions: 0, total_queries: 15, mentions_by_engine: { gemini: 0, chatgpt: 0, perplexity: 0 }, top_competitors: ["The Smile Designers"], top_cited_domains: ["justdial.com"], audited_at: "2026-11-26T05:30:00Z", competitor_mentions: { "The Smile Designers": 6 }, weakest_query: "Best dental clinic in Chandigarh Tricity", weakest_competitor: "The Smile Designers" };

async function main() {
  // 1. Follow-ups take the daily slots before first emails.
  const sent: number[] = [];
  await runTick({
    now: () => new Date("2026-11-27T04:00:00Z"),
    env: { OUTREACH_LIVE: "1", OUTREACH_DAILY_SEND_CAP: "2" } as any,
    countToday: async () => 0,
    listDue: async () => [
      { prospectId: "new1", company: "A", touch: 1, channel: "Email", dueAt: "2026-11-25T04:00:00Z" },
      { prospectId: "new2", company: "B", touch: 1, channel: "Email", dueAt: "2026-11-25T04:01:00Z" },
      { prospectId: "rep1", company: "C", touch: 3, channel: "Email", dueAt: "2026-11-26T04:00:00Z" },
      { prospectId: "fu1", company: "D", touch: 5, channel: "Email", dueAt: "2026-11-27T03:00:00Z" },
    ] as any,
    execute: async (item: any) => { sent.push(item.touch); return { status: "sent" } as any; },
    alert: async () => {},
  });
  assert.deepEqual(sent, [3, 5], "the report and the follow-up go before new first emails");

  // 2. The new first email.
  const dir = path.resolve(__dirname, "assets/outreach-templates");
  const set = loadTemplates(dir);
  const ctx: any = { company: "Dental IQ | Best Dentist in Mohali", city: "Chandigarh Tricity", category: "cosmetic_dental", decisionMakerName: "Dr. Vivek Rana", senderName: "Tejinder Singh", audit: AUDIT };
  const m = renderFromTemplates(set, 1, "Email", ctx);
  assert.ok(m.text.includes("Dental IQ was named in 0 of 15 answers. The Smile Designers was named in 6."));
  assert.ok(m.text.includes("Would you like it? Reply YES and I will send it."));
  assert.ok(!/growing share|follows in a few days|No call needed/.test(m.text), "no unsupported claim, no 'wait for it'");
  assert.ok(/five questions/.test(m.text) && !/15 questions/.test(m.text), "five questions, 15 answers");
  const vA = subjectVariant("Dental IQ | Best Dentist in Mohali");
  assert.equal(m.variant, vA);
  assert.equal(m.subject, vA === "A" ? "Dental IQ in 0 of 15 AI answers" : "Who ChatGPT recommends for dental clinics in Chandigarh Tricity");
  // Stable for a business, and both variants occur across businesses.
  assert.equal(subjectVariant("Dental IQ"), subjectVariant("Dental IQ | Best Dentist in Mohali"));
  const names = ["Dental IQ", "Smile Hub", "Bloom IVF", "Care Clinic", "Shivalik Hospital", "Akash Surana", "Womb IVF", "Garg Dental"];
  const variants = new Set(names.map(subjectVariant));
  assert.deepEqual([...variants].sort(), ["A", "B"]);
  // A WhatsApp touch sent by email keeps the business's own subject on the thread.
  const fb = renderFromTemplates(set, 4, "Email", ctx);
  assert.equal(fb.subject, `Re: ${m.subject}`);
  assert.equal(fb.variant, vA);
  // The other variant, for a business that gets B.
  const bName = names.find((n) => subjectVariant(n) !== vA)!;
  const other = renderFromTemplates(set, 1, "Email", { ...ctx, company: bName });
  assert.notEqual(other.variant, vA);

  // 3. A YES to the first email: the suggested reply carries the report.
  const base = { name: "Dr. Vivek Rana", company: "Dental IQ", slots: ["2026-11-27T09:30:00.000Z"], bookingLink: "https://ops.example/book", senderName: "Tejinder Singh" };
  const withReport = draftReply({ ...base, intent: "positive_interest", withReport: true })!;
  assert.ok(withReport.text.includes("Thank you. The one-page result for Dental IQ is attached"));
  assert.equal(withReport.needsEdit, false);
  const saved: any[] = [];
  const sPorts: any = { now: () => new Date("2026-11-27T05:00:00Z"), slots: async () => base.slots, save: async (_id: string, st: any) => void saved.push(st), post: async () => ({ channel: "C1", ts: "1.1" }), senderName: "Tejinder Singh", bookingLink: base.bookingLink };
  const prospect: any = { id: "p1", company: "Dental IQ", decision_maker: { name: "Dr. Vivek Rana", email: "v@d.example" } };
  const stateNoReport: any = { state: "replied", touches: [{ n: 1, channel: "Email", sent_at: "2026-11-26T04:00:00Z", dry_run: false }], onepager_path: "tgl/dental-iq/x.pdf" };
  const r = await suggestReply({ prospect, state: stateNoReport, intent: "positive_interest", from: "v@d.example", subject: "Dental IQ in 0 of 15 AI answers" }, sPorts);
  assert.equal(r?.attach_path, "tgl/dental-iq/x.pdf");
  assert.ok(r?.text.includes("is attached"));
  const stateHadReport: any = { ...stateNoReport, touches: [...stateNoReport.touches, { n: 3, channel: "Email", sent_at: "2026-11-27T04:00:00Z", dry_run: false }] };
  const r2 = await suggestReply({ prospect, state: stateHadReport, intent: "positive_interest", from: "v@d.example" }, sPorts);
  assert.equal(r2?.attach_path, undefined, "already had the report: not attached again");
  const r3 = await suggestReply({ prospect, state: { ...stateNoReport, onepager_path: undefined }, intent: "positive_interest", from: "v@d.example" }, sPorts);
  assert.equal(r3?.attach_path, undefined, "no stored PDF: no promise of one");
  assert.ok(!r3?.text.includes("attached"));

  // Sending it attaches the PDF.
  let st: any = { ...stateNoReport, suggested_reply: r };
  const emails: any[] = [];
  const out = await handleSuggestedReplyAction({ user: { id: "U" }, channel: { id: "C1" }, container: { message_ts: "1.1" } }, { action_id: "reply_send", value: "p1" }, {
    now: () => new Date("2026-11-27T05:05:00Z"), isArchitect: async () => true, actorName: async () => "Tejinder",
    load: async () => ({ prospect, state: st }), save: async (_i, s) => { st = s; },
    send: async (e) => { emails.push(e); return { messageId: "re_9" }; },
    signReport: async (p) => `https://signed.example/${p}`,
    tell: async () => {}, openModal: async () => {}, recordSent: async () => {},
  });
  assert.equal(out, "sent");
  assert.equal(emails[0].attachmentUrl, "https://signed.example/tgl/dental-iq/x.pdf");
  assert.equal(emails[0].attachmentFilename, "Dental-IQ-AI-visibility.pdf");

  // 4. A rejected business is never sent anything, even with an active sequence.
  const { makeExecute } = await import("./agents/outreach-sequencer/execute.js");
  const res = await makeExecute({
      now: () => new Date("2026-11-27T05:00:00Z"),
      loadProspect: async () => ({ id: "rej", company: "JP's Academy", category: "high_ticket_coaching", city: "Mumbai", email: "a@b.example", status: "rejected", outreach: { state: "active", next_touch: 1, next_due_at: "2026-11-27T04:30:00Z", enrolled_at: "2026-11-20T00:00:00Z", touches: [] } as any }),
      saveState: async () => { throw new Error("must not save"); },
    } as any)({ prospectId: "rej", company: "JP's Academy", touch: 1, channel: "Email", dueAt: "2026-11-27T04:30:00Z" } as any, "live");
  assert.deepEqual(res, { status: "skipped", reason: "rejected by the Architect" });

  console.log("test-outreach-message-v2: all checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
