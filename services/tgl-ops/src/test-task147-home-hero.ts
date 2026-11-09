// Task 147: Home hero form -> POST /aeo/lead, end to end through createApp() with a fake GHL.
// Proves the two-field home_hero payload is accepted (ok:true, contact + note + opportunity written), that the
// /aeo landing form still requires its full field set, that bad input never returns ok:true, and that the hero
// pattern posts exactly what the endpoint accepts. Also checks config/agents.yaml statuses are well formed.
// No network: GHL and Slack are injected.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { parse as parseYaml } from "yaml";
import { createApp } from "./app.js";
import { setAeoLeadDeps, resetAeoRateLimit } from "./routes/aeo.js";

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`PASS ${name}`);
}

function findUp(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) return p;
    dir = path.dirname(dir);
  }
  throw new Error(`cannot find ${rel} from ${process.cwd()}`);
}

interface Call { url: string; body: any }

async function main(): Promise<void> {
  const calls: Call[] = [];
  const notices: string[] = [];
  let failGhl = false;
  const fakeFetch: any = async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (failGhl) return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" };
    let payload: any = {};
    if (url.endsWith("/contacts/upsert")) payload = { contact: { id: "c_1" } };
    else if (url.includes("/notes")) payload = { note: { id: "n_1" } };
    else if (url.endsWith("/opportunities/")) payload = { opportunity: { id: "o_1" } };
    return { ok: true, status: 200, json: async () => payload, text: async () => "" };
  };
  const liveDeps = {
    ghl: { apiKey: "k", locationId: "loc", pipelineId: "pipe", stageNewId: "stage" },
    fetchFn: fakeFetch,
    notify: async (t: string) => {
      notices.push(t);
    },
    now: () => 1_700_000_000_000,
  };
  setAeoLeadDeps(liveDeps);
  resetAeoRateLimit();

  const server = createApp("test-signing-secret").listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const origin = "https://thegrowthlab.co.in";
  // The per-IP limiter is covered by the Task 107 test; reset it so these cases are independent.
  const post = (body: unknown) => {
    resetAeoRateLimit();
    return fetch(`${base}/aeo/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    });
  };

  try {
    // 1. Two-field hero payload with a website: accepted, written to GHL, alert posted.
    const hero = await post({
      source: "home_hero",
      business: "https://www.sharmaclinic.in/about",
      website: "https://www.sharmaclinic.in/about",
      phone: "98765 43210",
      hp: "",
      utm: { utm_source: "meta", utm_campaign: "aeo-audit" },
      pagePath: "/",
    });
    assert.equal(hero.status, 200);
    assert.deepEqual(await hero.json(), { ok: true });
    assert.equal(calls.length, 3, "contact upsert, note, opportunity");
    const upsert = calls[0].body;
    assert.equal(upsert.phone, "+919876543210");
    assert.equal(upsert.website, "sharmaclinic.in");
    assert.equal("email" in upsert, false, "no email key when none was collected");
    assert.ok(upsert.tags.includes("source:home-hero"));
    assert.match(calls[1].body.body, /Home hero form/);
    assert.match(calls[1].body.body, /Consent checkbox: not on this form/);
    assert.equal(calls[2].body.pipelineStageId, "stage");
    assert.match(notices[0], /Home hero/);
    ok("home_hero two-field payload returns ok:true and writes contact, note and opportunity");

    // 2. Business name instead of a website: accepted, no website key written.
    calls.length = 0;
    const named = await post({ source: "home_hero", business: "Sharma Dental Care", phone: "+44 7700 900123", hp: "", utm: {}, pagePath: "/" });
    assert.equal(named.status, 200);
    assert.equal(calls[0].body.phone, "+447700900123");
    assert.equal("website" in calls[0].body, false);
    assert.equal(calls[0].body.companyName, "Sharma Dental Care");
    ok("home_hero accepts a business name and a +country-code number");

    // 3. Bad hero input is a 422, never ok:true, and never reaches GHL.
    calls.length = 0;
    const badPhone = await post({ source: "home_hero", business: "Sharma Dental Care", phone: "12345" });
    assert.equal(badPhone.status, 422);
    const badJson: any = await badPhone.json();
    assert.equal(badJson.ok, false);
    assert.ok(badJson.errors.phone);
    const noBiz = await post({ source: "home_hero", business: "", phone: "9876543210" });
    assert.equal(noBiz.status, 422);
    assert.equal(calls.length, 0);
    ok("home_hero with a bad number or empty business returns 422 and writes nothing");

    // 4. The lighter rules apply only to home_hero: the /aeo form still needs every field.
    const aeoPartial = await post({ business: "Sharma Dental Care", phone: "9876543210" });
    assert.equal(aeoPartial.status, 422);
    const aeoSpoof = await post({ source: "something_else", business: "Sharma Dental Care", phone: "9876543210" });
    assert.equal(aeoSpoof.status, 422);
    assert.equal(calls.length, 0);
    ok("without source=home_hero the full /aeo field set is still required");

    // 5. GHL failure is a 502 with ok:false (the form must not show success).
    failGhl = true;
    const down = await post({ source: "home_hero", business: "sharmaclinic.in", phone: "9876543210", hp: "" });
    assert.equal(down.status, 502);
    assert.equal(((await down.json()) as any).ok, false);
    failGhl = false;
    ok("GHL failure returns 502 and ok:false");

    // 6. GHL unconfigured fails closed.
    setAeoLeadDeps({ ...liveDeps, ghl: null });
    const closed = await post({ source: "home_hero", business: "sharmaclinic.in", phone: "9876543210", hp: "" });
    assert.equal(closed.status, 503);
    assert.equal(((await closed.json()) as any).ok, false);
    ok("GHL unconfigured returns 503 and ok:false");
  } finally {
    setAeoLeadDeps(null);
    resetAeoRateLimit();
    server.close();
  }

  // 7. The hero pattern posts what the endpoint accepts, and only shows success on ok:true.
  const heroPattern = fs.readFileSync(findUp("tgl-theme/patterns/home-hero.php"), "utf8");
  assert.match(heroPattern, /source:\s*'home_hero'/);
  assert.match(heroPattern, /phone:\s*phone/);
  assert.match(heroPattern, /r\.data\.ok === true/);
  assert.equal((heroPattern.match(/<input /g) || []).length, 3, "business, phone and the honeypot only");
  ok("hero pattern posts source=home_hero with two visible fields and gates success on ok:true");

  // 8. agents.yaml: every agent has a valid status, and the daily Citation Tracker owner is active.
  const agents: any[] = parseYaml(fs.readFileSync(findUp("config/agents.yaml"), "utf8"));
  for (const a of agents) assert.ok(["active", "planned"].includes(a.status), `${a.name} has status ${a.status}`);
  assert.equal(agents.find((a) => a.name === "aeo-audit-engine")?.status, "active");
  ok("agents.yaml statuses are well formed and aeo-audit-engine is active");

  console.log(`\n${passed} checks passed`);
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
