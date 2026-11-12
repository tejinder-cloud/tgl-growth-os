// services/tgl-ops/src/test-prospect-audit-review.ts
// The Architect's review buttons on a prospect audit (decisions/2026-11-12.md): "Send on email" and
// "Needs refinement". In-memory store, fake mail provider, captured Slack calls. No network, no Slack, no email,
// no prospect contact, no write to decisions/ or logs/ on main.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateAuditPdf } from "./agents/aeo-audit-engine/pdf.js";
import { resetProspectAuditMemoryForTests, runProspectAudit, type ProspectAuditDeps, type ProspectAuditRequest } from "./agents/aeo-audit-engine/prospect-audit.js";
import { memoryProspectAuditStore } from "./agents/aeo-audit-engine/prospect-audit-store.js";
import {
  DEFAULT_BOOKING_LINK,
  DEFAULT_REPLY_TO,
  bookingLink,
  EMAIL_MODAL,
  REFINE_ACTION,
  REFINE_MODAL,
  SEND_ACTION,
  buildProspectAuditEmail,
  greetingName,
  handleProspectAuditAction,
  handleProspectAuditModal,
  isProspectAuditAction,
  isProspectAuditModal,
  prospectAuditFrom,
  prospectAuditModalResponse,
  type ReviewDeps,
} from "./agents/aeo-audit-engine/prospect-audit-review.js";
import type { EngineAnswer, EngineId } from "./agents/aeo-audit-engine/types.js";

if (process.env.TGL_TEST_MODE !== "1") {
  console.error("test-prospect-audit-review must run with TGL_TEST_MODE=1.");
  process.exit(1);
}

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`ok - ${name}`);
}

const ANSWER = "1. **Clove Dental**: chain.\n2. **Sunrise Dental**: single clinic.\n3. **Apollo White Dental**: chain.";
const engines = async (engine: EngineId): Promise<EngineAnswer> =>
  ({ engine, model: "fixture-model", text: ANSWER, citations: [], usage: {} as any, costUsd: 0.01, costSource: "computed", raw: null } as EngineAnswer);

const ENV = { RESEND_API_KEY: "re_fixture", REPORTS_FROM: "TrueVisible <reports@mail.example.in>" };
const ARCHITECT = { id: "U_ARCH", name: "tejinder" };

async function makeAudit(over: Partial<ProspectAuditRequest> = {}) {
  resetProspectAuditMemoryForTests();
  const store = memoryProspectAuditStore();
  const reviews: any[] = [];
  const lines: string[] = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prospect-review-"));
  const deps: Partial<ProspectAuditDeps> = {
    store,
    renderPdf: async (result, outFile) => generateAuditPdf(result, path.join(tmp, path.basename(outFile))),
    readPdf: (file) => fs.readFileSync(path.join(tmp, path.basename(file))),
    postFile: async () => ({ ok: true, fileId: "F-1" }),
    postLine: async (o) => {
      lines.push(o.text);
      return { ok: true };
    },
    postReview: async (o) => {
      reviews.push(o);
      return { ok: true, ts: "1700000000.000100", channelId: "C_REVENUE" };
    },
    getSpendUsd: async () => 0,
    getCapUsd: async () => 3,
    recordSpend: () => undefined,
    now: () => new Date("2026-11-12T10:00:00.000Z"),
  };
  const req: ProspectAuditRequest = { businessName: "Sunrise Dental", website: "sunrisedental.in", industry: "healthcare", city: "mohali", source: "site_lead", leadId: "lead-1", contactName: "Dr Neha Kapoor", contactEmail: "Neha@SunriseDental.in", ...over };
  const out = await runProspectAudit(req, deps, { engineMock: engines });
  return { store, reviews, lines, deps, out };
}

function reviewDeps(store: ReturnType<typeof memoryProspectAuditStore>, over: Partial<ReviewDeps> = {}) {
  const mails: any[] = [];
  const updates: any[] = [];
  const threads: string[] = [];
  const modals: any[] = [];
  const leads: string[] = [];
  const reruns: ProspectAuditRequest[] = [];
  const deps: Partial<ReviewDeps> = {
    store,
    env: ENV,
    fetchFn: async (url, init) => {
      mails.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "mail-123" }) };
    },
    isArchitect: async (user) => user?.id === ARCHITECT.id,
    actorName: async () => "Tejinder Singh",
    updateMessage: async (channel, ts, text, blocks) => void updates.push({ channel, ts, text, blocks }),
    postThread: async (_c, _ts, text) => void threads.push(text),
    openModal: async (_t, view) => void modals.push(view),
    rerun: async (req) => {
      reruns.push(req);
      return { status: "needs_input", reason: "fixture" };
    },
    markLeadSent: async (id) => void leads.push(id),
    now: () => new Date("2026-11-12T10:30:00.000Z"),
    ...over,
  };
  return { deps, mails, updates, threads, modals, leads, reruns };
}

function tap(actionId: string, auditId: string, summary: string, user: any = ARCHITECT) {
  return {
    payload: { type: "block_actions", user, trigger_id: "T-1", channel: { id: "C_REVENUE" }, container: { message_ts: "1700000000.000100" }, message: { blocks: [{ type: "section", text: { type: "mrkdwn", text: summary } }] } },
    action: { action_id: actionId, value: auditId },
  };
}

function submit(callbackId: string, meta: object, values: Record<string, string>, user: any = ARCHITECT) {
  const state: any = { values: {} };
  for (const [k, v] of Object.entries(values)) state.values[k] = { v: { value: v } };
  return { type: "view_submission", user, view: { callback_id: callbackId, private_metadata: JSON.stringify(meta), state } };
}

async function main(): Promise<void> {
  // ---- the audit is posted with its record and two buttons ----
  {
    const a = await makeAudit();
    assert.equal(a.out.status, "posted");
    const id = (a.out as any).auditId as string;
    assert.ok(id);
    const row = a.store.rows.get(id)!;
    assert.equal(row.status, "ready");
    assert.equal(row.business_name, "Sunrise Dental");
    assert.equal(row.domain, "sunrisedental.in");
    assert.equal(row.category_phrase, "dental clinic");
    assert.equal(row.phrase_from, "name");
    assert.equal(row.city, "Mohali");
    assert.equal(row.site_lead_id, "lead-1");
    assert.equal(row.contact_email, "neha@sunrisedental.in");
    assert.equal(row.total_queries, 15);
    assert.equal(Buffer.from(row.pdf_base64, "base64").subarray(0, 4).toString(), "%PDF");
    assert.equal(row.slack_ts, "1700000000.000100");
    assert.equal(row.slack_file_id, "F-1");
    assert.equal(a.reviews.length, 1);
    assert.equal(a.lines.length, 0, "the summary is posted once, with the buttons");
    const actions = (a.reviews[0].blocks as any[]).find((b) => b.type === "actions");
    assert.deepEqual(actions.elements.map((e: any) => [e.action_id, e.value, e.text.text]), [[SEND_ACTION, id, "Send on email"], [REFINE_ACTION, id, "Needs refinement"]]);
    assert.ok(a.reviews[0].text.includes("*Not sent to the prospect.*") && a.reviews[0].text.includes("Send on email goes to neha@sunrisedental.in."));
    ok("posted for review: record saved with the PDF and contact, summary carries Send on email and Needs refinement");

    const b = await makeAudit({ source: "architect", leadId: null, contactEmail: null, contactName: null });
    assert.ok(b.reviews[0].text.includes("No email is on record for this request: Send on email will ask for one."));
    const c = await makeAudit();
    const noButtons = await runProspectAudit({ businessName: "Lotus IVF", website: "lotusivf.in", industry: "healthcare", city: "Pune", source: "architect" }, { ...c.deps, store: null }, { engineMock: engines });
    assert.equal(noButtons.status, "posted");
    assert.equal((noButtons as any).auditId, undefined);
    assert.ok(c.lines[0].includes("send it yourself"), "without a record the plain summary is used, with no buttons that could not work");
    ok("no email on record is said up front; without a database the audit is posted without buttons");
  }

  // ---- the email: the approved wording and nothing else ----
  {
    const e = buildProspectAuditEmail({ business_name: "Sunrise Dental", category_phrase: "dental clinic", city: "Mohali", contact_name: "Dr Neha Kapoor" }, { PROSPECT_AUDIT_BOOKING_LINK: "off" });
    assert.equal(e.subject, "Your AI visibility check: Sunrise Dental");
    assert.equal(
      e.text,
      [
        "Hi Dr. Neha,",
        "Thank you for asking. Your one-page AI visibility check is attached.",
        "We asked ChatGPT, Gemini and Perplexity five questions a customer would ask about a dental clinic in Mohali. The report shows where they named Sunrise Dental, who they named instead, and which websites they took their answers from.",
        "If you'd like to know what to fix first, reply to this email and we'll set up a 20-minute call.",
        "Tejinder Singh\nThe Growth Lab",
      ].join("\n\n")
    );
    assert.ok(e.html.includes("Tejinder Singh<br>The Growth Lab") && !e.html.includes("<script"));
    // With the booking page (the default since 12 Nov): the sentence the Architect approved, with the link.
    const withLink = buildProspectAuditEmail({ business_name: "Sunrise Dental", category_phrase: "dental clinic", city: "Mohali", contact_name: "Dr Neha Kapoor" }, {});
    assert.ok(withLink.text.includes(`If you'd like to know what to fix first, reply to this email or pick a time here: ${DEFAULT_BOOKING_LINK}`));
    assert.ok(!withLink.text.includes("we'll set up a 20-minute call"));
    assert.ok(withLink.html.includes(`<a href="${DEFAULT_BOOKING_LINK}"`) && withLink.html.includes("pick a time here</a>."));
    assert.equal(bookingLink({ PROSPECT_AUDIT_BOOKING_LINK: "https://cal.example.in/tgl" }), "https://cal.example.in/tgl");
    assert.equal(bookingLink({ PROSPECT_AUDIT_BOOKING_LINK: "OFF" }), null);
    assert.equal(bookingLink({ PROSPECT_AUDIT_BOOKING_LINK: "javascript:alert(1)" }), DEFAULT_BOOKING_LINK, "anything that is not an https link is ignored");
    assert.ok(buildProspectAuditEmail({ business_name: "Lotus", category_phrase: "IVF clinic", city: null, contact_name: null }).text.includes("Hi,\n\n") );
    assert.ok(buildProspectAuditEmail({ business_name: "Lotus", category_phrase: "IVF clinic", city: null, contact_name: null }).text.includes("about an IVF clinic in India."));
    assert.ok(buildProspectAuditEmail({ business_name: "A <b>B</b>", category_phrase: "hotel", city: "Goa", contact_name: "Arjun Mehta" }).html.includes("A &lt;b&gt;B&lt;/b&gt;"));
    assert.equal(greetingName("Arjun Mehta"), "Arjun");
    assert.equal(greetingName("Dr. R"), "Dr. R");
    assert.equal(greetingName("Dr"), "");
    assert.equal(greetingName("  "), "");
    assert.equal(prospectAuditFrom(ENV), "Tejinder Singh - The Growth Lab <reports@mail.example.in>");
    assert.equal(prospectAuditFrom({ ...ENV, PROSPECT_AUDIT_FROM: "Tejinder <t@example.in>" }), "Tejinder <t@example.in>");
    assert.equal(prospectAuditFrom({}), null);
    assert.ok(isProspectAuditAction(SEND_ACTION) && isProspectAuditAction(REFINE_ACTION) && !isProspectAuditAction("action_approve"));
    assert.ok(isProspectAuditModal(EMAIL_MODAL) && isProspectAuditModal(REFINE_MODAL) && !isProspectAuditModal("modal_reject_reason"));
    ok("email: the approved wording, a plain greeting when no name is known, sender shown as the Architect");
  }

  // ---- Send on email ----
  {
    const a = await makeAudit();
    const id = (a.out as any).auditId as string;
    const summary = a.reviews[0].text as string;
    const r = reviewDeps(a.store);

    const stranger = tap(SEND_ACTION, id, summary, { id: "U_OTHER", name: "rahul" });
    assert.equal(await handleProspectAuditAction(stranger.payload, stranger.action, r.deps), "not_architect");
    assert.equal(r.mails.length, 0);
    assert.equal(a.store.rows.get(id)!.status, "ready");
    assert.ok(r.threads[0].includes("Only the Architect"));
    ok("only the Architect's tap sends: anyone else gets a line in the thread and nothing leaves");

    const t = tap(SEND_ACTION, id, summary);
    assert.equal(await handleProspectAuditAction(t.payload, t.action, r.deps), "sent");
    assert.equal(r.mails.length, 1);
    const mail = r.mails[0];
    assert.equal(mail.url, "https://api.resend.com/emails");
    assert.equal(mail.headers.authorization, "Bearer re_fixture");
    assert.deepEqual(mail.body.to, ["neha@sunrisedental.in"]);
    assert.equal(mail.body.from, "Tejinder Singh - The Growth Lab <reports@mail.example.in>");
    assert.equal(mail.body.reply_to, DEFAULT_REPLY_TO);
    assert.equal(mail.body.reply_to, "aeoaudits@thegrowthlab.co.in");
    assert.equal(mail.body.subject, "Your AI visibility check: Sunrise Dental");
    assert.equal(mail.body.attachments.length, 1);
    assert.equal(mail.body.attachments[0].filename, "sunrise-dental-ai-visibility-audit-2026-11-12.pdf");
    assert.equal(mail.body.attachments[0].content, a.store.rows.get(id)!.pdf_base64);
    const row = a.store.rows.get(id)!;
    assert.equal(row.status, "sent");
    assert.equal(row.sent_to, "neha@sunrisedental.in");
    assert.equal(row.email_id, "mail-123");
    assert.equal(row.decided_by, "Tejinder Singh");
    assert.deepEqual(r.leads, ["lead-1"]);
    assert.equal(r.updates.length, 1);
    const blocks = r.updates[0].blocks as any[];
    assert.ok(!blocks.some((b) => b.type === "actions"), "the buttons are gone once it is sent");
    assert.ok(blocks[1].elements[0].text.includes("*Sent to neha@sunrisedental.in*") && blocks[1].elements[0].text.includes("mail id mail-123") && blocks[1].elements[0].text.includes("IST"));
    assert.equal(blocks[0].text.text, summary, "the summary stays on the message");
    ok("send: one email to the address on record, PDF attached, replies to aeoaudits@, row and Slack message say Sent with the provider's id");

    assert.equal(await handleProspectAuditAction(t.payload, t.action, r.deps), "already_sent");
    assert.equal(r.mails.length, 1, "a second tap never sends a second email");
    assert.ok(r.threads[r.threads.length - 1].includes("Already sent to neha@sunrisedental.in"));
    const refineAfter = tap(REFINE_ACTION, id, summary);
    assert.equal(await handleProspectAuditAction(refineAfter.payload, refineAfter.action, r.deps), "already_sent");
    ok("one email per audit: a second tap, or a refine after sending, does nothing but say so");

    const o = reviewDeps(a.store, { env: { ...ENV, PROSPECT_AUDIT_REPLY_TO: "tejinder@example.in" } });
    const again = await makeAudit();
    const id2 = (again.out as any).auditId as string;
    const o2 = reviewDeps(again.store, { env: { ...ENV, PROSPECT_AUDIT_REPLY_TO: "tejinder@example.in" } });
    const t2 = tap(SEND_ACTION, id2, again.reviews[0].text);
    await handleProspectAuditAction(t2.payload, t2.action, o2.deps);
    assert.equal(o2.mails[0].body.reply_to, "tejinder@example.in");
    assert.equal(o.mails.length, 0);
    ok("reply-to can be changed with PROSPECT_AUDIT_REPLY_TO");
  }

  // ---- the mail provider says no ----
  {
    const a = await makeAudit();
    const id = (a.out as any).auditId as string;
    let refuse = true;
    const r = reviewDeps(a.store);
    const mails: any[] = [];
    r.deps.fetchFn = async (_url, init) => {
      mails.push(JSON.parse(init.body));
      return refuse ? { ok: false, status: 422, text: async () => '{"message":"domain not verified"}' } : { ok: true, status: 200, text: async () => '{"id":"mail-9"}' };
    };
    const t = tap(SEND_ACTION, id, a.reviews[0].text);
    assert.equal(await handleProspectAuditAction(t.payload, t.action, r.deps), "send_failed");
    assert.equal(a.store.rows.get(id)!.status, "send_failed");
    assert.ok(a.store.rows.get(id)!.send_error!.includes("422"));
    assert.equal(r.updates.length, 0, "the message keeps its buttons");
    assert.ok(r.threads[0].includes("*Email not sent*") && r.threads[0].includes("domain not verified") && r.threads[0].includes("Nothing reached the prospect"));
    assert.deepEqual(r.leads, []);
    refuse = false;
    assert.equal(await handleProspectAuditAction(t.payload, t.action, r.deps), "sent");
    assert.equal(mails.length, 2);
    assert.equal(a.store.rows.get(id)!.status, "sent");
    assert.equal(a.store.rows.get(id)!.send_error, null);
    ok("provider refusal: reported as not sent with the provider's reason, never shown as Sent, and the tap works again after the fix");

    const b = await makeAudit();
    const idb = (b.out as any).auditId as string;
    const rb = reviewDeps(b.store, { env: {} });
    const tb = tap(SEND_ACTION, idb, b.reviews[0].text);
    assert.equal(await handleProspectAuditAction(tb.payload, tb.action, rb.deps), "send_failed");
    assert.equal(rb.mails.length, 0);
    assert.ok(rb.threads[0].includes("email is not configured"));
    ok("email not configured: said plainly, nothing attempted");
  }

  // ---- two taps at once ----
  {
    const a = await makeAudit();
    const id = (a.out as any).auditId as string;
    const r = reviewDeps(a.store);
    const t = tap(SEND_ACTION, id, a.reviews[0].text);
    const results = await Promise.all([handleProspectAuditAction(t.payload, t.action, r.deps), handleProspectAuditAction(t.payload, t.action, r.deps)]);
    assert.equal(r.mails.length, 1, `two taps at once sent ${r.mails.length} emails`);
    assert.ok(results.includes("sent"));
    ok("two taps at the same moment send one email");
  }

  // ---- no email on record: the box asks for it ----
  {
    const a = await makeAudit({ source: "architect", leadId: null, contactEmail: null, contactName: null });
    const id = (a.out as any).auditId as string;
    const r = reviewDeps(a.store);
    const t = tap(SEND_ACTION, id, a.reviews[0].text);
    assert.equal(await handleProspectAuditAction(t.payload, t.action, r.deps), "email_modal");
    assert.equal(r.mails.length, 0);
    assert.equal(r.modals.length, 1);
    assert.equal(r.modals[0].callback_id, EMAIL_MODAL);
    const meta = JSON.parse(r.modals[0].private_metadata);
    assert.equal(meta.id, id);

    assert.deepEqual(prospectAuditModalResponse(submit(EMAIL_MODAL, meta, { email: "not-an-email" })), { response_action: "errors", errors: { email: "Enter a full email address, for example name@business.com." } });
    assert.deepEqual(prospectAuditModalResponse(submit(EMAIL_MODAL, meta, { email: "owner@sunrisedental.in" })), { response_action: "clear" });
    assert.equal(await handleProspectAuditModal(submit(EMAIL_MODAL, meta, { email: " Owner@SunriseDental.in ", name: "Neha Kapoor" }), r.deps), "sent");
    assert.deepEqual(r.mails[0].body.to, ["owner@sunrisedental.in"]);
    assert.ok(r.mails[0].body.text.startsWith("Hi Neha,"));
    const row = a.store.rows.get(id)!;
    assert.equal(row.status, "sent");
    assert.equal(row.contact_email, "owner@sunrisedental.in");
    assert.equal(r.updates.length, 1);
    assert.equal(await handleProspectAuditModal(submit(EMAIL_MODAL, meta, { email: "x@y.in" }, { id: "U_OTHER" }), r.deps), "not_architect");
    assert.equal(r.mails.length, 1);
    ok("no email on record: a box asks for it, a bad address keeps the box open, the typed address gets the one email");
  }

  // ---- Needs refinement ----
  {
    const a = await makeAudit();
    const id = (a.out as any).auditId as string;
    const summary = a.reviews[0].text as string;
    const r = reviewDeps(a.store);
    const t = tap(REFINE_ACTION, id, summary);
    assert.equal(await handleProspectAuditAction(t.payload, t.action, r.deps), "refine_modal");
    const modal = r.modals[0];
    assert.equal(modal.callback_id, REFINE_MODAL);
    const what = modal.blocks.find((b: any) => b.block_id === "what");
    const city = modal.blocks.find((b: any) => b.block_id === "city");
    assert.equal(what.element.initial_value, "dental clinic");
    assert.equal(city.element.initial_value, "Mohali");
    const meta = JSON.parse(modal.private_metadata);

    assert.deepEqual(prospectAuditModalResponse(submit(REFINE_MODAL, meta, { what: "x" })), { response_action: "errors", errors: { what: "Say what they are in a few words, for example dental clinic." } });
    assert.equal(await handleProspectAuditModal(submit(REFINE_MODAL, meta, { what: "cosmetic dentist", city: "Chandigarh" }), r.deps), "refined:needs_input");
    assert.equal(a.store.rows.get(id)!.status, "refined");
    assert.equal(r.mails.length, 0, "refining never emails anyone");
    assert.deepEqual(r.reruns, [{ businessName: "Sunrise Dental", website: "sunrisedental.in", what: "cosmetic dentist", city: "Chandigarh", source: "architect", leadId: "lead-1", contactName: "Dr Neha Kapoor", contactEmail: "neha@sunrisedental.in", refinedFrom: id }]);
    const blocks = r.updates[0].blocks as any[];
    assert.ok(!blocks.some((b) => b.type === "actions"));
    assert.ok(blocks[1].elements[0].text.includes('*Replaced by a refined audit* ("cosmetic dentist", Chandigarh)') && blocks[1].elements[0].text.includes("This one was not sent."));
    const stale = tap(SEND_ACTION, id, summary);
    assert.equal(await handleProspectAuditAction(stale.payload, stale.action, r.deps), "already_refined");
    assert.equal(r.mails.length, 0);
    ok("refine: the box opens filled in, the old audit is marked replaced and cannot be sent, the rerun carries the contact and the link to the old one");

    // The rerun, run for real, produces a new record that points back at the old one.
    const fresh = await runProspectAudit(r.reruns[0], a.deps, { engineMock: engines });
    assert.equal(fresh.status, "posted");
    const newRow = a.store.rows.get((fresh as any).auditId)!;
    assert.equal(newRow.refined_from, id);
    assert.equal(newRow.category_phrase, "cosmetic dentist");
    assert.equal(newRow.phrase_from, "architect");
    assert.equal(newRow.city, "Chandigarh");
    assert.equal(newRow.contact_email, "neha@sunrisedental.in");
    assert.equal(newRow.status, "ready");
    assert.equal(a.reviews.length, 2);
    ok("the refined audit is a new record, ready for review, linked to the one it replaced");
  }

  // ---- missing record ----
  {
    const store = memoryProspectAuditStore();
    const r = reviewDeps(store);
    const t = tap(SEND_ACTION, "audit-does-not-exist", "summary");
    assert.equal(await handleProspectAuditAction(t.payload, t.action, r.deps), "not_found");
    const none = reviewDeps(store, { store: null });
    assert.equal(await handleProspectAuditAction(t.payload, t.action, none.deps), "no_store");
    assert.equal(r.mails.length + none.mails.length, 0);
    ok("missing record or no database: nothing is sent and the thread says why");
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((err) => {
  console.error("test-prospect-audit-review FAILED:", err);
  process.exit(1);
});
