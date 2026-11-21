// services/tgl-ops/src/test-whatsapp-console.ts
// The private WhatsApp screen: signed-in only, Meta's answers passed through, input checked before any call.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { makeSession, SESSION_COOKIE } from "./agents/pipeline/auth.js";
import { normaliseIndianOrE164, placeholderCount, validateTemplate } from "./agents/whatsapp/graph.js";
import { setWhatsAppConsoleForTests } from "./routes/pipeline.js";

async function main() {
  assert.equal(placeholderCount("On {{1}} we asked {{2}} about {{3}}"), 3);
  assert.equal(normaliseIndianOrE164("98720 09997"), "919872009997");
  assert.equal(normaliseIndianOrE164("+44 7700 900123"), "447700900123");
  assert.equal(normaliseIndianOrE164("12345"), null);
  assert.match(validateTemplate({ name: "Bad Name", category: "MARKETING", language: "en", body: "x", examples: [] }) || "", /lowercase/);
  assert.match(validateTemplate({ name: "ok", category: "MARKETING", language: "en", body: "Hi {{1}} there", examples: [] }) || "", /example/);
  assert.equal(validateTemplate({ name: "ok", category: "MARKETING", language: "en", body: "Hi {{1}} there", examples: ["A"], quickReplies: ["Yes, send it"] }), null);

  const calls: { method: string; url: string; body?: any }[] = [];
  const meta = (async (url: any, init?: any) => {
    const u = String(url);
    calls.push({ method: init?.method || "GET", url: u, body: init?.body ? JSON.parse(init.body) : undefined });
    const j = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body }) as any;
    if (u.includes("/owned_whatsapp_business_accounts")) return j(200, { data: [] });
    if (u.includes("/me?")) return j(200, { id: "61596760381853", name: "tgl-ops" });
    if (u.includes("/debug_token")) return j(200, { data: { app_id: "1064181579968051", user_id: "61596760381853", type: "SYSTEM_USER", issued_at: 1795266000, expires_at: 0, granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["102499279250735", "222"] }, { scope: "business_management" }] } });
    if (/\/222\/phone_numbers/.test(u)) return j(200, { data: [{ id: "1487662067754793", display_phone_number: "+1 555 142 9904", verified_name: "Test Number" }] });
    if (/\/102499279250735\?fields/.test(u)) return j(200, { id: "102499279250735", name: "The Growth Lab" });
    if (/\/222\?fields/.test(u)) return j(200, { id: "222", name: "Test WhatsApp Business Account" });
    if (/\/1392003416260536\?fields/.test(u)) return j(200, { id: "1392003416260536", name: "unknown" });
    if (u.includes("/client_whatsapp_business_accounts")) return j(200, { data: [] });
    if (u.includes("/phone_numbers")) return j(200, { data: [{ id: "110035615150329", display_phone_number: "+91 98720 09997", verified_name: "The Growth Lab" }] });
    if (u.includes("/message_templates") && init?.method === "POST") return j(200, { id: "T1", status: "PENDING", category: "MARKETING" });
    if (u.includes("/message_templates")) return j(200, { data: [{ id: "T0", name: "hello_world", status: "APPROVED", category: "UTILITY", language: "en_US", components: [{ type: "BODY", text: "Hello {{1}}" }] }] });
    if (u.includes("/messages")) return String(init?.body || "").includes("919999999999") ? j(400, { error: { message: "Recipient phone number not in allowed list" } }) : j(200, { messages: [{ id: "wamid.X" }], contacts: [{ wa_id: "919872009997" }] });
    return j(404, {});
  }) as unknown as typeof fetch;

  const env = { ...process.env };
  Object.assign(process.env, { PIPELINE_ALLOWED_EMAILS: "me@x.example", PIPELINE_SESSION_SECRET: "s" });
  setWhatsAppConsoleForTests({ token: async () => "TOKEN", fetchImpl: meta });
  const server = createApp("x").listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(makeSession("me@x.example", "s"))}`;
  const j = { "Content-Type": "application/json", cookie };
  try {
    assert.equal((await fetch(`${base}/pipeline/whatsapp/api/accounts`)).status, 401, "signed out");
    assert.equal((await fetch(`${base}/pipeline/whatsapp/console`, { redirect: "manual" })).status, 302);
    const page = await (await fetch(`${base}/pipeline/whatsapp/console`, { headers: { cookie } })).text();
    assert.match(page, /Send a template message/);
    assert.doesNotMatch(page, /<script[^>]+src=/, "no outside scripts");

    const acc: any = await (await fetch(`${base}/pipeline/whatsapp/api/accounts`, { headers: { cookie } })).json();
    assert.equal(acc.accounts.length, 2, "accounts granted to the token are listed even when the business lists none");
    assert.ok(acc.notes.some((n: any) => n.call === "token identity" && /belongs to tgl-ops \(61596760381853\); app 1064181579968051; type SYSTEM_USER; issued 2026-11-21 \d\d:\d\d IST; expires never/.test(n.detail)), "token identity shown");
    assert.ok(acc.notes.some((n: any) => n.call === "token grants" && /WhatsApp account ids: 102499279250735, 222/.test(n.detail)), "Meta's answers are shown");
    assert.ok(!JSON.stringify(acc.notes).includes("TOKEN"), "the token is never shown");
    assert.equal(acc.accounts[0].name, "The Growth Lab");
    assert.equal(acc.accounts[1].numbers[0].display, "+1 555 142 9904");
    const byId: any = await (await fetch(`${base}/pipeline/whatsapp/api/accounts?add=1392003416260536,notanid`, { headers: { cookie } })).json();
    assert.ok(byId.accounts.some((a: any) => a.id === "1392003416260536"), "an account added by id is listed");
    assert.ok(byId.notes.some((n: any) => n.call === "account 1392003416260536" && n.ok));
    const tp: any = await (await fetch(`${base}/pipeline/whatsapp/api/templates?waba=102499279250735`, { headers: { cookie } })).json();
    assert.equal(tp.templates[0].placeholders, 1);

    const created: any = await (await fetch(`${base}/pipeline/whatsapp/api/templates`, { method: "POST", headers: j, body: JSON.stringify({ waba: "102499279250735", name: "tgl_first_touch", category: "MARKETING", language: "en", body: "Hello, on {{1}} we asked a question.", examples: ["20 Nov"], quickReplies: ["Yes, send it", "Not interested"] }) })).json();
    assert.equal(created.template.status, "PENDING");
    const post = calls.find((c) => c.method === "POST" && c.url.includes("message_templates"))!;
    assert.deepEqual(post.body.components[0].example, { body_text: [["20 Nov"]] });
    assert.equal(post.body.components[1].buttons.length, 2);

    const before = calls.length;
    const bad = await fetch(`${base}/pipeline/whatsapp/api/templates`, { method: "POST", headers: j, body: JSON.stringify({ waba: "102499279250735", name: "Bad Name", category: "MARKETING", body: "x" }) });
    assert.equal(bad.status, 400);
    assert.equal(calls.length, before, "invalid input never reaches Meta");

    const sent: any = await (await fetch(`${base}/pipeline/whatsapp/api/send`, { method: "POST", headers: j, body: JSON.stringify({ phone_number_id: "1487662067754793", to: "98720 09997", name: "hello_world", language: "en_US", values: ["Tejinder"] }) })).json();
    assert.equal(sent.messageId, "wamid.X");
    const msg = calls.find((c) => c.url.includes("/messages"))!;
    assert.equal(msg.body.to, "919872009997");
    assert.deepEqual(msg.body.template.components[0].parameters, [{ type: "text", text: "Tejinder" }]);
    const refused = await fetch(`${base}/pipeline/whatsapp/api/send`, { method: "POST", headers: j, body: JSON.stringify({ phone_number_id: "1487662067754793", to: "+91 99999 99999", name: "hello_world", values: [] }) });
    assert.equal(refused.status, 502);
    assert.match(((await refused.json()) as any).message, /^Meta: Recipient phone number not in allowed list/);
  } finally {
    server.close();
    process.env = env;
    setWhatsAppConsoleForTests(null);
  }
  console.log("test-whatsapp-console: all checks passed");
}
main().catch((err) => { console.error(err); process.exit(1); });
