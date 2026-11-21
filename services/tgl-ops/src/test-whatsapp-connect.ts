// services/tgl-ops/src/test-whatsapp-connect.ts
// Connecting the WhatsApp number: only a signed-in allowed account; each step reported as Meta answered it.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { completeConnection, type ConnectStore } from "./agents/whatsapp/connect.js";
import { makeSession, SESSION_COOKIE } from "./agents/pipeline/auth.js";
import { setWhatsAppConnectForTests } from "./routes/pipeline.js";

function memStore() {
  const s = { token: "", row: null as any };
  const store: ConnectStore = { setToken: async (t) => { s.token = t; }, saveConnection: async (r) => { s.row = r; } };
  return { s, store };
}
const cfg = { appId: "1064181579968051", appSecret: "sec", configId: "cfg1", graphVersion: "v23.0" };

function fakeMeta(opts: { tokenOk?: boolean; subOk?: boolean } = {}) {
  const calls: string[] = [];
  const f = (async (url: any, init?: any) => {
    const u = String(url);
    calls.push(`${init?.method || "GET"} ${u.replace(/client_secret=[^&]+/, "client_secret=***")}`);
    const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body }) as any;
    if (u.includes("/oauth/access_token")) return opts.tokenOk === false ? json(400, { error: { message: "Invalid code" } }) : json(200, { access_token: "BIZTOKEN" });
    if (u.includes("/phone_numbers")) return json(200, { data: [{ id: "110035615150329", display_phone_number: "+91 98720 09997", verified_name: "The Growth Lab" }] });
    if (u.includes("/subscribed_apps")) return opts.subOk === false ? json(400, { error: { message: "Permission denied" } }) : json(200, { success: true });
    return json(404, {});
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function main() {
  const { s, store } = memStore();
  const m = fakeMeta();
  const r = await completeConnection({ code: "C", wabaId: "1392003416260536", phoneNumberId: "110035615150329" }, cfg, store, "me@x.example", m.f);
  assert.equal(r.ok, true);
  assert.equal(s.token, "BIZTOKEN");
  assert.equal(s.row.display_number, "+91 98720 09997");
  assert.equal(s.row.webhooks_subscribed, true);
  assert.ok(m.calls[0].startsWith("GET https://graph.facebook.com/v23.0/oauth/access_token"));

  const bad = memStore();
  const r2 = await completeConnection({ code: "C", wabaId: "1392003416260536" }, cfg, bad.store, "me", fakeMeta({ tokenOk: false }).f);
  assert.equal(r2.ok, false);
  assert.equal(bad.s.token, "", "nothing saved when Meta refuses the code");
  assert.match(r2.steps[0].detail || "", /Invalid code/);

  const part = memStore();
  const r3 = await completeConnection({ code: "C", wabaId: "1392003416260536" }, cfg, part.store, "me", fakeMeta({ subOk: false }).f);
  assert.equal(r3.ok, false, "not reported as connected when webhooks fail");
  assert.equal(part.s.row.webhooks_subscribed, false);
  assert.equal((await completeConnection({ code: "C", wabaId: "x" }, cfg, memStore().store, "me", m.f)).ok, false);

  // Routes.
  const env = { ...process.env };
  Object.assign(process.env, { PIPELINE_ALLOWED_EMAILS: "me@x.example", PIPELINE_SESSION_SECRET: "s", META_APP_ID: cfg.appId, META_APP_SECRET: "sec", META_ES_CONFIG_ID: "cfg1" });
  const routeStore = memStore();
  setWhatsAppConnectForTests({ store: () => routeStore.store, read: async () => null, fetchImpl: fakeMeta().f });
  const server = createApp("x").listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(makeSession("me@x.example", "s"))}`;
  try {
    assert.equal((await fetch(`${base}/pipeline/whatsapp`, { redirect: "manual" })).status, 302, "signed out: back to sign-in");
    const page = await (await fetch(`${base}/pipeline/whatsapp`, { headers: { cookie } })).text();
    assert.match(page, /whatsapp_business_app_onboarding/);
    assert.match(page, /"cfg1"/);
    assert.doesNotMatch(page, /sec"/, "the app secret never reaches the page");
    const anon = await fetch(`${base}/pipeline/whatsapp/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "C", waba_id: "1392003416260536" }) });
    assert.equal(anon.status, 401);
    const ok = await fetch(`${base}/pipeline/whatsapp/exchange`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ code: "C", waba_id: "1392003416260536", phone_number_id: "110035615150329" }) });
    assert.equal(ok.status, 200);
    assert.equal(routeStore.s.row.connected_by, "me@x.example");
  } finally {
    server.close();
    process.env = env;
    setWhatsAppConnectForTests(null);
  }
  console.log("test-whatsapp-connect: all checks passed");
}
main().catch((err) => { console.error(err); process.exit(1); });
