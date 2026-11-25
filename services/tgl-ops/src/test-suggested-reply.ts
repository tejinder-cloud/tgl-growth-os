// Offline checks for suggested replies (25 Nov 2026): the draft, the slots, and every rule on sending.
// Nothing reaches Slack, email or the database.
import assert from "node:assert/strict";
import {
  blockedReason, draftReply, greetingName, handleSuggestedReplyAction, handleSuggestedReplyModal, pickSlots, PLACEHOLDER,
  replySubject, slotLabel, suggestReply, suggestedReplyModalResponse, suggestionBlocks, bookingLinkFor, type SuggestedReply,
} from "./agents/outreach-sequencer/suggested-reply.js";
import { handleReply } from "./agents/outreach-sequencer/reply.js";
import { createResendSender } from "./agents/outreach-sequencer/email.js";

const EMOJI = /(?:\p{Extended_Pictographic}|[\u{2600}-\u{27BF}])/u;
const S1 = "2026-11-26T09:30:00.000Z", S2 = "2026-11-27T10:00:00.000Z", S3 = "2026-11-30T10:30:00.000Z";

function prospect(over: any = {}): any {
  return { id: "p1", company: "Dental IQ | Best Dentist in Mohali", city: "Chandigarh Tricity", fit_score: 80, website: "https://dentaliq.example", decision_maker: { name: "Dr. Vivek Rana", email: "vivek@dentaliq.example" }, ...over };
}
function state(over: any = {}): any {
  return { state: "replied", enrolled_at: "2026-11-20T04:00:00Z", next_touch: 2, next_due_at: "2026-11-27T04:00:00Z", touches: [{ n: 1, channel: "Email", sent_at: "2026-11-24T04:00:00Z", dry_run: false }], ...over };
}

async function main() {
  // Names, slots, labels, subject.
  assert.equal(greetingName("Dr. Vivek Rana"), "Dr Rana");
  assert.equal(greetingName("Neha Motwani"), "Neha");
  assert.equal(greetingName("Owner / Lead Doctor"), "");
  assert.equal(greetingName("Contact found, DM unknown"), "");
  assert.deepEqual(pickSlots([{ date: "a", slots: [S1, "x"] }, { date: "b", slots: [] }, { date: "c", slots: [S2] }, { date: "d", slots: [S3] }, { date: "e", slots: ["y"] }]), [S1, S2, S3], "first free slot of each day, three days");
  assert.equal(slotLabel(S1), "Thu 26 Nov, 3:00 pm");
  assert.equal(replySubject("Your AI visibility check"), "Re: Your AI visibility check");
  assert.equal(replySubject("RE: hello"), "RE: hello");
  assert.equal(replySubject(""), "Re: your reply");
  assert.equal(bookingLinkFor({}, "https://ops.example"), "https://ops.example/book");
  assert.equal(bookingLinkFor({ OUTREACH_BOOKING_LINK: "https://cal.example/x" }, "https://ops.example"), "https://cal.example/x");
  assert.equal(bookingLinkFor({}, ""), undefined);

  // Drafts.
  const base = { name: "Dr. Vivek Rana", company: "Dental IQ | Best Dentist in Mohali", slots: [S1, S2, S3], bookingLink: "https://ops.example/book", senderName: "Tejinder Singh" };
  const yes = draftReply({ ...base, intent: "positive_interest" })!;
  assert.equal(yes.needsEdit, false);
  assert.equal(yes.text, `Hi Dr Rana,

Thank you for getting back to me. I would be glad to take you through what we found for Dental IQ and what to fix first. It takes 20 minutes.

Would one of these times suit you?

- Thu 26 Nov, 3:00 pm
- Fri 27 Nov, 3:30 pm
- Mon 30 Nov, 4:00 pm
(all times IST)

Or pick any time that suits you here: https://ops.example/book

Tejinder Singh`);
  const q = draftReply({ ...base, intent: "question" })!;
  assert.equal(q.needsEdit, true);
  assert.ok(q.text.includes(PLACEHOLDER) && q.text.includes("If it is easier to talk it through"));
  assert.ok(draftReply({ ...base, intent: "referral" })!.text.includes("Could you share their name and email"));
  assert.equal(draftReply({ ...base, intent: "not_interested" }), null);
  assert.equal(draftReply({ ...base, intent: "opt_out" }), null);
  assert.equal(draftReply({ ...base, intent: "out_of_office" }), null);
  const noCal = draftReply({ ...base, intent: "meeting_request", slots: [], bookingLink: undefined, name: "Owner" })!;
  assert.ok(noCal.text.startsWith("Hello,") && noCal.text.includes("When would suit you for a 20-minute call?"), "no calendar: still a usable draft");
  for (const d of [yes, q, noCal]) {
    assert.ok(!EMOJI.test(d.text));
    assert.ok(!/\d+ of \d+|named in/i.test(d.text), "no numbers or claims in a draft");
  }

  // Drafting: posts, then saves; never for an opt-out.
  const saved: any[] = [], posts: any[] = [];
  const sPorts = { now: () => new Date("2026-11-25T11:00:00Z"), slots: async () => [S1, S2, S3], save: async (id: string, st: any) => void saved.push({ id, st }), post: async (text: string, blocks: any[]) => { posts.push({ text, blocks }); return { channel: "C1", ts: "111.1" }; }, senderName: "Tejinder Singh", bookingLink: "https://ops.example/book" };
  const r = await suggestReply({ prospect: prospect(), state: state(), intent: "meeting_request", from: "vivek@dentaliq.example", subject: "Your AI check", messageId: "<abc@mail.example>" }, sPorts);
  assert.equal(r?.status, "draft");
  assert.equal(r?.in_reply_to, "<abc@mail.example>");
  assert.equal(saved[0].st.suggested_reply.ts, "111.1");
  assert.equal(saved[0].st.state, "replied", "the rest of the state is kept");
  assert.equal(posts[0].text, "Suggested reply to Dental IQ");
  const actions = posts[0].blocks.find((b: any) => b.type === "actions").elements.map((e: any) => e.action_id);
  assert.deepEqual(actions, ["reply_send", "reply_edit"]);
  assert.equal(await suggestReply({ prospect: prospect(), state: state({ state: "opted_out" }), intent: "question", from: "x@y.example" }, sPorts), null);
  const r2 = await suggestReply({ prospect: prospect(), state: state(), intent: "question", from: "x@y.example", messageId: "not-a-message-id" }, sPorts);
  assert.equal(r2?.in_reply_to, undefined, "only a real Message-ID is used for threading");
  assert.deepEqual(suggestionBlocks("X", { ...r2!, needs_edit: true }, "p1").find((b: any) => b.type === "actions").elements.map((e: any) => e.action_id), ["reply_edit"], "a draft needing your answer has no Send as written");
  // A calendar failure still drafts.
  const r3 = await suggestReply({ prospect: prospect(), state: state(), intent: "positive_interest", from: "x@y.example" }, { ...sPorts, slots: async () => { throw new Error("calendar down"); } });
  assert.ok(r3?.text.includes("https://ops.example/book") && !r3.text.includes("IST)"));

  // The reply handler calls the drafter only for a matched, replied prospect.
  const calls: any[] = [];
  const store: any = { findByEmail: async () => ({ ...prospect(), signals: { outreach: state({ state: "active" }) } }), findByGhlContactId: async () => null, saveState: async () => {} };
  const notify = async () => {};
  await handleReply({ email: "vivek@dentaliq.example", text: "Yes, interested. Let's talk.", messageId: "<m1@x>", subject: "Your AI check" }, { store, notify, suggest: async (i: any) => void calls.push(i) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, "vivek@dentaliq.example");
  assert.equal(calls[0].subject, "Your AI check");
  calls.length = 0;
  await handleReply({ email: "vivek@dentaliq.example", text: "Please unsubscribe me", messageId: "<m2@x>" }, { store, notify, suggest: async (i: any) => void calls.push(i) });
  assert.equal(calls.length, 0, "no draft for an opt-out");
  await handleReply({ email: "vivek@dentaliq.example", text: "Yes please", messageId: "<m3@x>" }, { store, notify, suggest: async () => { throw new Error("boom"); } });

  // Sending.
  const draft: SuggestedReply = { text: yes.text, subject: "Re: Your AI check", to: "vivek@dentaliq.example", in_reply_to: "<abc@mail.example>", intent: "meeting_request", needs_edit: false, created_at: "2026-11-25T11:00:00Z", status: "draft", channel: "C1", ts: "111.1" };
  let st: any = state({ suggested_reply: draft });
  const sent: any[] = [], told: string[] = [], modals: any[] = [], events: any[] = [];
  const ports = {
    now: () => new Date("2026-11-25T11:05:00Z"),
    isArchitect: async (u: any) => u?.id === "UARCH",
    actorName: async () => "Tejinder",
    load: async (id: string) => (id === "p1" ? { prospect: prospect(), state: st } : null),
    save: async (_id: string, s: any) => { st = s; },
    send: async (e: any) => { sent.push(e); return { messageId: "re_123" }; },
    tell: async (_c: string, _t: string | undefined, text: string) => void told.push(text),
    openModal: async (_t: string, v: any) => void modals.push(v),
    recordSent: async (p: any) => void events.push(p.id),
  };
  const click = (action_id: string, user = "UARCH") => ({ user: { id: user }, channel: { id: "C1" }, container: { message_ts: "111.1" }, trigger_id: "T1", actions: [{ action_id, value: "p1" }] });

  assert.equal(await handleSuggestedReplyAction(click("reply_send", "UOTHER"), { action_id: "reply_send", value: "p1" }, ports), "not_architect");
  assert.equal(sent.length, 0);
  assert.equal(await handleSuggestedReplyAction(click("reply_send"), { action_id: "reply_send", value: "p1" }, ports), "sent");
  assert.deepEqual(sent[0], { prospectId: "p1", to: "vivek@dentaliq.example", subject: "Re: Your AI check", text: yes.text, inReplyTo: "<abc@mail.example>" });
  assert.equal(st.suggested_reply.status, "sent");
  assert.equal(st.suggested_reply.message_id, "re_123");
  assert.deepEqual(events, ["p1"]);
  assert.match(told[told.length - 1], /^Sent to Dental IQ at Wed 25 Nov, 4:35 pm by Tejinder\.$/);
  assert.equal(await handleSuggestedReplyAction(click("reply_send"), { action_id: "reply_send", value: "p1" }, ports), "blocked");
  assert.equal(sent.length, 1, "never sent twice");

  // Blocked cases.
  assert.match(blockedReason(prospect(), state({ state: "opted_out" }), draft, draft.text) || "", /opted out/);
  assert.match(blockedReason(prospect(), state(), { ...draft, status: "sending" }, draft.text) || "", /being sent/);
  assert.match(blockedReason(prospect(), state(), draft, `Hi\n\n${PLACEHOLDER}\n\nT`) || "", /placeholder/);
  assert.match(blockedReason(prospect(), state(), { ...draft, to: "" }, draft.text) || "", /no address/);
  assert.equal(blockedReason(prospect(), state(), draft, draft.text), null);

  // A failed send keeps the draft and says so plainly.
  st = state({ suggested_reply: draft });
  const failPorts = { ...ports, send: async () => { throw new Error('HTTP 500: {"x":1}'); } };
  assert.equal(await handleSuggestedReplyAction(click("reply_send"), { action_id: "reply_send", value: "p1" }, failPorts), "failed");
  assert.equal(st.suggested_reply.status, "draft");
  assert.equal(told[told.length - 1], "Not sent: HTTP 500. The draft is kept; try again.");

  // Edit and send: the box opens with the draft; the edited text is what goes out.
  st = state({ suggested_reply: { ...draft, needs_edit: true, text: q.text } });
  assert.equal(await handleSuggestedReplyAction(click("reply_edit"), { action_id: "reply_edit", value: "p1" }, ports), "edit_modal");
  assert.equal(modals[0].callback_id, "reply_edit_modal");
  assert.equal(modals[0].blocks[1].element.initial_value, q.text);
  const submit = (text: string) => ({ user: { id: "UARCH" }, view: { callback_id: "reply_edit_modal", private_metadata: modals[0].private_metadata, state: { values: { body: { v: { value: text } } } } } });
  assert.deepEqual(suggestedReplyModalResponse(submit(q.text)), { response_action: "errors", errors: { body: "Replace the placeholder with your answer." } });
  assert.deepEqual(suggestedReplyModalResponse(submit("ok")), { response_action: "errors", errors: { body: "The reply is too short." } });
  const edited = q.text.replace(PLACEHOLDER, "We work with clinics across Mohali; I can share examples on the call.");
  assert.deepEqual(suggestedReplyModalResponse(submit(edited)), { response_action: "clear" });
  assert.equal(await handleSuggestedReplyModal(submit(edited), ports), "sent");
  assert.equal(sent[sent.length - 1].text, edited);

  // Threading headers reach Resend.
  let body: any = null;
  const resend = createResendSender({ apiKey: "k", from: "Tejinder <t@mail.example>", via: "resend", publicUrl: "", unsubscribeSecret: "" } as any, (async (_u: any, init: any) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); }) as any);
  await resend.send({ prospectId: "p1", to: "vivek@dentaliq.example", subject: "Re: x", text: "Hello there, a test reply.", inReplyTo: "<abc@mail.example>" });
  assert.equal(body.headers["In-Reply-To"], "<abc@mail.example>");
  assert.equal(body.headers["References"], "<abc@mail.example>");

  console.log("test-suggested-reply: all checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
