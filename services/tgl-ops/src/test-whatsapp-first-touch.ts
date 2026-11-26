// Offline checks for the WhatsApp first message (Build day 11, 26 Nov 2026): the words, who gets one, and the
// locks on sending. Nothing reaches Meta or the database.
import assert from "node:assert/strict";
import {
  fillTemplate, indianMobile, isWhatsAppAudience, planFirstTouch, runWhatsAppFirstTouch, TEMPLATE, whatsappMode, whatsappPerDay,
  type WaCandidate,
} from "./agents/outreach-sequencer/whatsapp-first-touch.js";
import { validateTemplate, placeholderCount } from "./agents/whatsapp/graph.js";
import { buildLiveView } from "./agents/pipeline/live-view.js";
import { renderOutreachMain } from "./agents/pipeline/outreach-page.js";

const EMOJI = /(?:\p{Extended_Pictographic}|[\u{2600}-\u{27BF}])/u;
const NOW = new Date("2026-11-26T06:00:00Z");
const CHECK = { mentions: 0, total_queries: 15, audited_at: "2026-11-25T05:30:00Z", mentions_by_engine: { gemini: 0, chatgpt: 0, perplexity: 0 }, weakest_competitor: "Fortis Mohali", competitor_mentions: { "Fortis Mohali": 10 } };

function biz(id: string, over: Partial<WaCandidate> = {}): WaCandidate {
  return { id, company: `Shivalik Hospital | Best Hospital in Mohali`, city: "Chandigarh Tricity", category: "hospitals", status: "reviewed", door: "aeo", fit_score: 80, decision_maker: { email: "", phone: "098765 43210" }, signals: { preaudit: { ...CHECK } }, ...over };
}

async function main() {
  // The template itself is valid for Meta, and every value has an example.
  assert.equal(validateTemplate({ ...TEMPLATE, examples: TEMPLATE.examples }), null);
  assert.equal(placeholderCount(TEMPLATE.body), 7);
  assert.ok(!EMOJI.test(TEMPLATE.body + TEMPLATE.footer));

  // Mobile numbers only.
  assert.equal(indianMobile("098765 43210"), "919876543210");
  assert.equal(indianMobile("+91 98765-43210"), "919876543210");
  assert.equal(indianMobile("9876543210"), "919876543210");
  assert.equal(indianMobile("0172 2700 123"), null, "a landline has no WhatsApp");
  assert.equal(indianMobile(""), null);

  // The message, from the business's own check.
  const plan = planFirstTouch(biz("a"), NOW);
  assert.ok(plan.ok);
  if (plan.ok) {
    assert.equal(plan.touch.to, "919876543210");
    assert.deepEqual(plan.touch.values, ["25 Nov", "15", "hospitals", "Chandigarh Tricity", "Shivalik Hospital", "none of the answers", "Fortis Mohali was named in 10."]);
    assert.equal(plan.touch.text, "Hello, this is Tejinder Singh from The Growth Lab. On 25 Nov we asked ChatGPT, Gemini and Perplexity 15 questions people ask when looking for hospitals in Chandigarh Tricity. Shivalik Hospital was named in none of the answers. Fortis Mohali was named in 10. Would you like the one-page report? Reply YES and I will send it here.");
    assert.equal(fillTemplate(plan.touch.values), plan.touch.text);
  }
  const some = planFirstTouch(biz("b", { category: "ivf_fertility", signals: { preaudit: { ...CHECK, mentions: 3, weakest_competitor: undefined, competitor_mentions: {} } } }), NOW);
  assert.ok(some.ok && some.touch.text.includes("IVF centres") && some.touch.text.includes("named in 3 of the answers. No other business was named often enough to compare."));

  // Who does not get one, and why (in plain words).
  const reason = (p: WaCandidate) => { const r = planFirstTouch(p, NOW); return r.ok ? "" : r.reason; };
  assert.equal(reason(biz("c", { decision_maker: { phone: "0172 2700 123" } })), "The number is not a mobile, so it has no WhatsApp");
  assert.equal(reason(biz("d", { signals: {} })), "AI check not run yet");
  assert.equal(reason(biz("e", { signals: { preaudit: { ...CHECK, audited_at: "2026-10-01T00:00:00Z" } } })), "AI check is older than 30 days; it runs again first");
  assert.equal(reason(biz("f", { signals: { preaudit: { ...CHECK, mentions_by_engine: { gemini: 0 } } } })), "The AI check did not ask all three assistants", "never claim engines that were not asked");
  assert.equal(reason(biz("g", { signals: { preaudit: { ...CHECK }, whatsapp: { first_touch_at: "2026-11-25T06:00:00Z" } } })), "First message already sent");
  assert.equal(reason(biz("h", { signals: { preaudit: { ...CHECK }, whatsapp: { opted_out: true } } })), "Opted out");
  assert.equal(isWhatsAppAudience(biz("i", { decision_maker: { email: "x@y.example", phone: "9876543210" } })), false, "has email: email outreach instead");
  assert.equal(isWhatsAppAudience(biz("j", { signals: { outreach: { state: "active" } } })), false, "already in email outreach");
  assert.equal(isWhatsAppAudience(biz("k", { status: "new" })), false, "not approved");

  // Settings.
  assert.equal(whatsappMode({}), "dry_run");
  assert.equal(whatsappMode({ WHATSAPP_OUTREACH_MODE: "LIVE" }), "live");
  assert.equal(whatsappPerDay({}), 5);
  assert.equal(whatsappPerDay({ WHATSAPP_PER_DAY: "50" }), 20);

  // Runs.
  const list = async () => [biz("a", { fit_score: 70 }), biz("b", { fit_score: 90 }), biz("c", { decision_maker: { phone: "0172 2700 123" } })];
  const sent: any[] = [], marked: any[] = [], recorded: any[] = [];
  const ports = (env: any, status: string | null = "APPROVED", failFor?: string) => ({
    now: () => NOW, env, list, templateStatus: async () => status,
    send: async (to: string, values: string[]) => { if (failFor && values[4] && to && sent.length === 0 && failFor === "first") { sent.push({ fail: true }); throw new Error('HTTP 400: {"error":{"message":"Recipient phone number not in allowed list"}}'); } sent.push({ to, values }); return { messageId: `wamid.${sent.length}` }; },
    markSent: async (id: string, info: any) => void marked.push({ id, ...info }),
    record: async (t: any) => void recorded.push(t.id),
  });
  const dry = await runWhatsAppFirstTouch(ports({}));
  assert.equal(dry.mode, "dry_run");
  assert.deepEqual(dry.wouldSend.map((t) => t.id), ["b", "a"], "highest fit first");
  assert.equal(sent.length + marked.length, 0, "dry run sends nothing and marks nothing");
  assert.deepEqual(dry.skipped, [{ company: "Shivalik Hospital", reason: "The number is not a mobile, so it has no WhatsApp" }]);

  const noNumber = await runWhatsAppFirstTouch(ports({ WHATSAPP_OUTREACH_MODE: "live" }));
  assert.equal(noNumber.stopped, "WHATSAPP_PHONE_NUMBER_ID is not set");
  const pending = await runWhatsAppFirstTouch(ports({ WHATSAPP_OUTREACH_MODE: "live", WHATSAPP_PHONE_NUMBER_ID: "123" }, "PENDING"));
  assert.equal(pending.stopped, "the template tgl_ai_visibility_first_touch is pending at Meta, not approved");
  const missing = await runWhatsAppFirstTouch(ports({ WHATSAPP_OUTREACH_MODE: "live", WHATSAPP_PHONE_NUMBER_ID: "123" }, null));
  assert.match(missing.stopped || "", /not found at Meta/);
  assert.equal(sent.length, 0, "no send until the template is approved");

  const live = await runWhatsAppFirstTouch(ports({ WHATSAPP_OUTREACH_MODE: "live", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_PER_DAY: "1" }));
  assert.deepEqual(live.sent.map((t) => t.id), ["b"], "the daily limit holds");
  assert.deepEqual(marked.map((m) => [m.id, m.messageId]), [["b", "wamid.1"]]);
  assert.deepEqual(recorded, ["b"]);
  assert.equal(sent[0].to, "919876543210");

  sent.length = 0; marked.length = 0;
  const failing = await runWhatsAppFirstTouch(ports({ WHATSAPP_OUTREACH_MODE: "live", WHATSAPP_PHONE_NUMBER_ID: "123" }, "APPROVED", "first"));
  assert.deepEqual(failing.failed, [{ company: "Shivalik Hospital", error: "Recipient phone number not in allowed list" }]);
  assert.deepEqual(marked.map((m) => m.id), ["a"], "a failed send is not marked; the next one still goes");

  // The Outreach page shows each business's exact message, or why there is none.
  const v = buildLiveView({ now: NOW, prospects: [biz("a") as any, biz("c", { decision_maker: { phone: "0172 2700 123" } }) as any], deals: [], agents: [], spend: null, capToday: 5 });
  assert.equal(v.whatsappReady, 1);
  const html = renderOutreachMain(v);
  assert.ok(html.includes("WhatsApp message ready") && html.includes("Shivalik Hospital was named in none of the answers."));
  assert.ok(html.includes("The number is not a mobile, so it has no WhatsApp"));
  assert.ok(html.includes("<b>1</b> message is ready") && html.includes("Nothing is sent yet."));
  assert.ok(!EMOJI.test(html));

  console.log("test-whatsapp-first-touch: all checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
