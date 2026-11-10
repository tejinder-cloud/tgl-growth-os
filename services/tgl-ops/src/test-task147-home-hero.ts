// Task 147: Home hero and Client Zero feed.
// - The Home hero submits no lead: it is a plain GET form that opens /aeo?site=...&source=home_hero#audit.
// - POST /aeo/lead is unchanged: it still requires the full /aeo field set, and source=home_hero does not relax it.
// - GET /home/stats is read-only and fails closed (503, no figures) without a provider or on bad data.
// - config/agents.yaml: aeo-audit-engine is active and every status is active or planned.
// - The founder photo is WebP with an @2x srcset and no PNG reference.
// No network: GHL and Slack are injected.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { parse as parseYaml } from "yaml";
import { createApp } from "./app.js";
import { setAeoLeadDeps, resetAeoRateLimit } from "./routes/aeo.js";
import { setHomeStatsProvider } from "./routes/home-stats.js";

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
  const fakeFetch: any = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    let payload: any = {};
    if (url.endsWith("/contacts/upsert")) payload = { contact: { id: "c_1" } };
    else if (url.endsWith("/opportunities/")) payload = { opportunity: { id: "o_1" } };
    return { ok: true, status: 200, json: async () => payload, text: async () => "" };
  };
  setAeoLeadDeps({
    ghl: { apiKey: "k", locationId: "loc", pipelineId: "pipe", stageNewId: "stage" },
    fetchFn: fakeFetch,
    notify: async () => undefined,
    now: () => 1_700_000_000_000,
  });
  resetAeoRateLimit();

  const server = createApp("test-signing-secret").listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const origin = "https://thegrowthlab.co.in";
  const post = (body: unknown) => {
    resetAeoRateLimit();
    return fetch(`${base}/aeo/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    });
  };

  try {
    // 1. The endpoint keeps requiring the full /aeo fields, even when a caller claims source=home_hero.
    const heroShape = await post({ source: "home_hero", business: "sharmaclinic.in", website: "sharmaclinic.in", phone: "9876543210" });
    assert.equal(heroShape.status, 422);
    const heroJson: any = await heroShape.json();
    assert.equal(heroJson.ok, false);
    for (const k of ["name", "institute", "email", "consent"]) assert.ok(heroJson.errors[k], `${k} still required`);
    assert.equal(calls.length, 0, "nothing reaches GHL from a two-field payload");
    ok("two-field home_hero payload is rejected with 422 and writes nothing");

    // 2. The full /aeo payload (with the website the Home hero passes along) is accepted.
    const full = await post({
      name: "Asha Sharma",
      institute: "Sharma Dental Care",
      website: "https://www.sharmaclinic.in/about",
      phone: "98765 43210",
      email: "asha@sharmaclinic.in",
      consent: true,
      pagePath: "/aeo",
    });
    assert.equal(full.status, 200);
    assert.deepEqual(await full.json(), { ok: true });
    assert.equal(calls.length, 3, "contact upsert, note, opportunity");
    assert.equal(calls[0].body.phone, "+919876543210");
    assert.equal(calls[0].body.website, "sharmaclinic.in");
    assert.deepEqual(calls[0].body.tags, ["aeo-audit-request", "source:aeo-page"]);
    ok("full /aeo payload returns ok:true and writes contact, note and opportunity");

    // 3. Read-only stats route: fails closed with no provider.
    setHomeStatsProvider(null);
    const none = await fetch(`${base}/home/stats`, { headers: { Origin: origin } });
    assert.equal(none.status, 503);
    assert.deepEqual(await none.json(), { ok: false, error: "stats unavailable" });
    ok("GET /home/stats with no provider returns 503 and no figures");

    // 4. Provider data is passed through, trimmed to the six public keys, never cached.
    setHomeStatsProvider(async () => ({
      questions_tracked: 16,
      engines_checked: 3,
      times_named_latest: 2,
      first_run_figure: 0,
      first_run_date: "2025-10-01",
      last_run_date: "2025-11-09",
      secret: "must not leak",
    } as any));
    const live = await fetch(`${base}/home/stats`, { headers: { Origin: origin } });
    assert.equal(live.status, 200);
    assert.equal(live.headers.get("cache-control"), "no-store");
    assert.equal(live.headers.get("access-control-allow-origin"), origin);
    const liveJson: any = await live.json();
    assert.deepEqual(Object.keys(liveJson).sort(), ["engines_checked", "first_run_date", "first_run_figure", "last_run_date", "questions_tracked", "times_named_latest"]);
    ok("GET /home/stats returns only the six public keys, no-store, CORS for the site origin");

    // 5. Bad data or a throwing provider: 503, never a partial or typed fallback.
    setHomeStatsProvider(async () => ({ questions_tracked: "16" } as any));
    assert.equal((await fetch(`${base}/home/stats`)).status, 503);
    setHomeStatsProvider(async () => {
      throw new Error("db down");
    });
    assert.equal((await fetch(`${base}/home/stats`)).status, 503);
    ok("GET /home/stats fails closed on malformed data or a provider error");

    // 6. Read-only: no write verbs.
    const w = await fetch(`${base}/home/stats`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.notEqual(w.status, 200);
    ok("POST to /home/stats is not accepted");
  } finally {
    setHomeStatsProvider(null);
    setAeoLeadDeps(null);
    resetAeoRateLimit();
    server.close();
  }

  // 7. Hero pattern: one website field, GET to /aeo#audit with source=home_hero, no endpoint, no fetch.
  const hero = fs.readFileSync(findUp("tgl-theme/patterns/home-hero.php"), "utf8");
  assert.match(hero, /method="get"/);
  assert.match(hero, /action="\/aeo#audit"/);
  assert.match(hero, /name="site"/);
  assert.match(hero, /name="source" value="home_hero"/);
  assert.equal((hero.match(/<input /g) || []).length, 2, "one visible website field plus the hidden source");
  assert.equal((hero.match(/type="text"/g) || []).length, 1, "exactly one visible field");
  assert.doesNotMatch(hero, /fetch\(|<script|TGL_AEO_ENDPOINT|\/aeo\/lead|name="phone"/);
  ok("hero is a one-field GET form that opens /aeo?site=...&source=home_hero#audit and submits no lead");

  // 8. Founder photo: WebP + @2x srcset, PNG dropped from the page.
  const founder = fs.readFileSync(findUp("tgl-theme/patterns/home-founder-faq-cta.php"), "utf8");
  assert.match(founder, /tejinder-stage\.webp/);
  assert.match(founder, /tejinder-stage@2x\.webp/);
  assert.match(founder, /srcset=/);
  assert.doesNotMatch(founder, /tejinder-stage\.png/);
  ok("founder image uses tejinder-stage.webp and @2x via srcset, no PNG reference");

  // 9. agents.yaml: statuses well formed, aeo-audit-engine active.
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
