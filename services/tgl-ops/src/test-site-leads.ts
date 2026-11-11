// Website lead routes (launch package, 11 Nov 2026): POST /aeo/lead and POST /automation/lead through the
// real Express app with a fake store, fake GHL fetch and captured notifications. No network, no Slack,
// no decisions/ or logs/ writes.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { resetSiteLeadRateLimit, setSiteLeadDeps } from "./routes/site-leads.js";
import { validateSiteLead, buildSiteLeadNote, siteLeadCard, type SiteLead } from "./lib/site-leads.js";

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`ok - ${name}`);
}

function fakeStore(opts: { failInsert?: boolean } = {}) {
  const rows: any[] = [];
  const marks: any[] = [];
  return {
    rows,
    marks,
    async insert(lead: SiteLead, meta: any) {
      if (opts.failInsert) throw new Error("connection refused");
      rows.push({ lead, meta });
      return `row-${rows.length}`;
    },
    async markGhl(id: string, o: any) {
      marks.push({ id, ...o });
    },
  };
}

const aeoBody = {
  business_name: "Sunrise Dental",
  website: "https://www.sunrisedental.in/",
  industry: "healthcare",
  city: "Mohali",
  name: "Dr Neha Kapoor",
  email: "Neha@SunriseDental.in",
  phone: "",
  consent: true,
  source: "home_hero",
  for: "clinic",
  hp: "",
  page: "/aeo",
  utm_source: "linkedin",
  utm_campaign: "launch",
  gclid: "abc123",
};
const autoBody = {
  name: "Arjun Mehta",
  business_name: "Mehta Realty",
  email: "arjun@mehtarealty.com",
  phone: "98765 43210",
  job: "followup",
  message: "Leads from 99acres go cold because nobody calls back the same day.",
  consent: "on",
  source: "ai_automation_page",
  hp: "",
  page: "/ai-automation",
};

async function main(): Promise<void> {
  // ---- pure validation ----
  {
    const v = validateSiteLead("aeo", aeoBody);
    assert.ok(v.ok);
    if (v.ok) {
      assert.equal(v.lead.domain, "sunrisedental.in");
      assert.equal(v.lead.email, "neha@sunrisedental.in");
      assert.equal(v.lead.phone, null, "blank phone is allowed and stored as null");
      assert.equal(v.lead.industry, "healthcare");
      assert.deepEqual(v.lead.campaign, { utm_source: "linkedin", utm_campaign: "launch", gclid: "abc123" });
    }
    ok("aeo: valid body normalises domain, email, optional phone, campaign fields");

    const legacy = validateSiteLead("aeo", { ...aeoBody, industry: "coaching" });
    assert.ok(legacy.ok && legacy.lead.industry === "education");
    ok("aeo: legacy industry slug 'coaching' maps to 'education'");

    const bad = validateSiteLead("aeo", { ...aeoBody, industry: "pharma", website: "not a site", email: "x", consent: false });
    assert.ok(!bad.ok);
    if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ["consent", "email", "industry", "website"]);
    ok("aeo: unknown industry, bad website, bad email and missing consent each name their field");

    const alias = validateSiteLead("aeo", { ...aeoBody, business_name: undefined, institute: "Old Form Academy" });
    assert.ok(alias.ok && alias.lead.business_name === "Old Form Academy");
    ok("aeo: 'institute' still accepted as an alias for business_name");

    const a = validateSiteLead("automation", autoBody);
    assert.ok(a.ok);
    if (a.ok) {
      assert.equal(a.lead.phone, "+919876543210");
      assert.equal(a.lead.job, "followup");
      assert.equal(a.lead.website, null);
    }
    ok("automation: valid body; phone normalised to E.164; no website required");

    const badJob = validateSiteLead("automation", { ...autoBody, job: "magic" });
    assert.ok(!badJob.ok && "job" in (badJob as any).errors);
    ok("automation: unknown job rejected");

    const note = buildSiteLeadNote((a as any).lead);
    assert.ok(note.includes("Wants to automate: followup") && note.includes("+919876543210"));
    const card = siteLeadCard((v as any).lead, null, null);
    assert.ok(card.title.startsWith("Audit request: Sunrise Dental") && card.summary.includes("not configured"));
    ok("note and card carry the facts and say plainly when GHL is not configured");
  }

  // ---- HTTP path ----
  const origin = "https://falkanmedia.com";
  process.env.AEO_ALLOWED_ORIGINS = "https://thegrowthlab.co.in,https://www.thegrowthlab.co.in,https://falkanmedia.com";
  const server = createApp("test-signing-secret").listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...extra }, body: JSON.stringify(body) });

  try {
    // 1. No store: 503, never ok:true, alert sent
    {
      const notices: string[] = [];
      setSiteLeadDeps({ store: null, ghl: null, fetchFn: (async () => { throw new Error("no fetch"); }) as any, notify: async (t) => { notices.push(t); }, postLeadCard: async () => {}, now: () => 1_700_000_000_000 });
      resetSiteLeadRateLimit();
      const r = await post("/aeo/lead", aeoBody);
      assert.equal(r.status, 503);
      assert.equal(((await r.json()) as any).ok, false);
      assert.ok(notices.length === 1 && notices[0].includes("database not configured"));
      ok("no database: 503, ok:false, one alert");
    }

    // 2. Store ok, GHL unconfigured: 200 ok:true, row saved, card posted, no GHL mark
    {
      const store = fakeStore();
      const cards: any[] = [];
      setSiteLeadDeps({ store, ghl: null, fetchFn: (async () => { throw new Error("must not call GHL"); }) as any, notify: async () => {}, postLeadCard: async (c) => { cards.push(c); }, now: () => 1_700_000_000_000 });
      resetSiteLeadRateLimit();
      const r = await post("/aeo/lead", aeoBody);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { ok: true });
      assert.equal(store.rows.length, 1);
      assert.equal(store.rows[0].lead.domain, "sunrisedental.in");
      assert.ok(store.rows[0].meta.ipHash && store.rows[0].meta.ipHash.length === 32, "ip is stored hashed, never raw");
      assert.equal(store.marks.length, 0);
      assert.equal(cards.length, 1);
      assert.equal(cards[0].kind, "aeo");
      assert.ok(cards[0].summary.includes("Saved in the company database"));
      ok("aeo saved without GHL: 200 ok:true, row written, #revenue card says follow up by hand");
    }

    // 3. Store ok, GHL configured and succeeding: contact + note + opportunity; mark recorded
    {
      const store = fakeStore();
      const calls: string[] = [];
      const fetchFn: any = async (url: string, init: any) => {
        calls.push(url.replace("https://services.leadconnectorhq.com", ""));
        const body = JSON.parse(init.body);
        if (url.endsWith("/contacts/upsert")) {
          assert.equal(body.companyName, "Mehta Realty");
          assert.equal(body.phone, "+919876543210");
          return { ok: true, status: 200, json: async () => ({ contact: { id: "c_1" } }), text: async () => "" };
        }
        if (url.includes("/notes")) return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
        if (url.endsWith("/opportunities/")) return { ok: true, status: 200, json: async () => ({ opportunity: { id: "o_1" } }), text: async () => "" };
        throw new Error("unexpected " + url);
      };
      const cards: any[] = [];
      setSiteLeadDeps({
        store,
        ghl: { apiKey: "k", locationId: "L", automationPipelineId: "P", automationStageNewId: "S" },
        fetchFn,
        notify: async () => {},
        postLeadCard: async (c) => { cards.push(c); },
        now: () => 1_700_000_000_000,
      });
      resetSiteLeadRateLimit();
      const r = await post("/automation/lead", autoBody);
      assert.equal(r.status, 200);
      assert.deepEqual(calls, ["/contacts/upsert", "/contacts/c_1/notes", "/opportunities/"]);
      assert.deepEqual(store.marks[0], { id: "row-1", contactId: "c_1", opportunityId: "o_1", error: null });
      assert.ok(cards[0].summary.includes("contact c_1, opportunity o_1"));
      ok("automation with GHL: saved, contact + note + opportunity, outcome recorded on the row");
    }

    // 4. Store ok, GHL fails: still 200 ok:true; error recorded; alert sent; card says not written
    {
      const store = fakeStore();
      const notices: string[] = [];
      const cards: any[] = [];
      setSiteLeadDeps({
        store,
        ghl: { apiKey: "k", locationId: "L" },
        fetchFn: (async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "unauthorized" })) as any,
        notify: async (t) => { notices.push(t); },
        postLeadCard: async (c) => { cards.push(c); },
        now: () => 1_700_000_000_000,
      });
      resetSiteLeadRateLimit();
      const r = await post("/aeo/lead", aeoBody);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { ok: true });
      assert.equal(store.marks[0].contactId, null);
      assert.ok(store.marks[0].error.includes("401"));
      assert.ok(notices[0].includes("saved but not written to GoHighLevel"));
      assert.ok(cards[0].summary.includes("not written"));
      ok("GHL failure never loses a saved lead: 200 ok:true, error on the row, alert, honest card");
    }

    // 5. Store fails: 503 ok:false, alert, no card
    {
      const store = fakeStore({ failInsert: true });
      const notices: string[] = [];
      const cards: any[] = [];
      setSiteLeadDeps({ store, ghl: null, fetchFn: (async () => { throw new Error("no"); }) as any, notify: async (t) => { notices.push(t); }, postLeadCard: async (c) => { cards.push(c); }, now: () => 1_700_000_000_000 });
      resetSiteLeadRateLimit();
      const r = await post("/automation/lead", autoBody);
      assert.equal(r.status, 503);
      assert.equal(((await r.json()) as any).ok, false);
      assert.ok(notices[0].includes("could not be saved"));
      assert.equal(cards.length, 0);
      ok("database failure: 503 ok:false, alert, no card, no false success");
    }

    // 6. Validation, honeypot, origin, preflight, rate limit
    {
      const store = fakeStore();
      setSiteLeadDeps({ store, ghl: null, fetchFn: (async () => { throw new Error("no"); }) as any, notify: async () => {}, postLeadCard: async () => {}, now: () => 1_700_000_000_000 });
      resetSiteLeadRateLimit();

      const inv = await post("/aeo/lead", { ...aeoBody, email: "nope", industry: "" });
      assert.equal(inv.status, 400);
      const invJson: any = await inv.json();
      assert.equal(invJson.ok, false);
      assert.ok(invJson.errors.email && invJson.errors.industry);
      ok("invalid body: 400 with per-field errors");

      const hp = await post("/aeo/lead", { ...aeoBody, hp: "filled by a bot" });
      assert.equal(hp.status, 200);
      assert.equal(store.rows.length, 0, "honeypot hit saves nothing");
      ok("honeypot: 200 to the bot, nothing saved");

      const foreign = await fetch(`${base}/automation/lead`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify(autoBody) });
      assert.equal(foreign.status, 403);
      ok("unknown origin: 403");

      const pre = await fetch(`${base}/automation/lead`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
      assert.equal(pre.status, 204);
      assert.equal(pre.headers.get("access-control-allow-origin"), origin);
      ok("preflight from the test domain: 204 with CORS headers");

      resetSiteLeadRateLimit();
      let last = 0;
      for (let i = 0; i < 7; i++) last = (await post("/aeo/lead", aeoBody)).status;
      assert.equal(last, 429);
      ok("rate limit: sixth request in an hour from one IP is 429");
    }
  } finally {
    setSiteLeadDeps(null);
    resetSiteLeadRateLimit();
    server.close();
  }

  console.log(`\nSite leads: ${passed} tests passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
