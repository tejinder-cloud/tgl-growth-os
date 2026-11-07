// Task 107 (PLAN-D11): proves POST /aeo/lead is mounted in createApp() and behaves correctly behind the
// app's raw-body parsing pipeline. No network, no GHL: deps are overridden.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { setAeoLeadDeps, resetAeoRateLimit } from "./routes/aeo.js";

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`PASS ${name}`);
}

async function main(): Promise<void> {
  const notices: string[] = [];
  setAeoLeadDeps({
    ghl: null,
    fetchFn: (async () => {
      throw new Error("fetch must not be called when GHL is unconfigured");
    }) as any,
    notify: async (t: string) => {
      notices.push(t);
    },
    now: () => 1_700_000_000_000,
  });
  resetAeoRateLimit();

  const server = createApp("test-signing-secret").listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const origin = "https://thegrowthlab.co.in";
  const validBody = {
    name: "Rohit Sharma",
    institute: "Sharma Academy",
    website: "sharmaacademy.com",
    phone: "9876543210",
    email: "rohit@sharmaacademy.com",
    question: "",
    consent: true,
    hp: "",
    utm: { utm_source: "meta", utm_medium: "paid", utm_campaign: "aeo-audit" },
    pagePath: "/aeo",
  };

  try {
    // 1. CORS preflight from the site origin
    const pre = await fetch(`${base}/aeo/lead`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), origin);
    ok("OPTIONS /aeo/lead returns 204 with CORS for the site origin");

    // 2. Foreign origin is refused
    const bad = await fetch(`${base}/aeo/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify(validBody),
    });
    assert.equal(bad.status, 403);
    ok("foreign origin gets 403");

    // 3. Honeypot answers 200 and does nothing
    const hp = await fetch(`${base}/aeo/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ ...validBody, hp: "bot" }),
    });
    assert.equal(hp.status, 200);
    assert.equal(notices.length, 0);
    ok("honeypot returns 200 and sends no alert");

    // 4. Invalid payload gets 422 with field errors
    const inv = await fetch(`${base}/aeo/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name: "", institute: "", website: "", phone: "1", email: "x", consent: false }),
    });
    assert.equal(inv.status, 422);
    const invJson: any = await inv.json();
    assert.equal(invJson.ok, false);
    assert.ok(invJson.errors && Object.keys(invJson.errors).length > 0);
    ok("invalid payload returns 422 with field errors");

    // 5. Valid payload with GHL unconfigured fails closed: 503, never ok:true
    const closed = await fetch(`${base}/aeo/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(validBody),
    });
    assert.equal(closed.status, 503);
    const closedJson: any = await closed.json();
    assert.equal(closedJson.ok, false);
    ok("valid payload with GHL unconfigured returns 503 and ok:false (no false success)");
  } finally {
    setAeoLeadDeps(null);
    resetAeoRateLimit();
    server.close();
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
