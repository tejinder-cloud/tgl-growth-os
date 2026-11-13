// services/tgl-ops/src/test-researcher-published-email.ts
// Architect decisions of 13 Nov 2026: an owner-run business may be contacted on the email it publishes on its own
// website, and the researcher makes several area searches a run. Fixture checks only: no network, no Slack post,
// no prospect contact, no write to decisions/ or logs/.
import assert from "node:assert/strict";
import {
  PUBLISHED_EMAIL_SOURCE,
  assessPublishedEmail,
  assessWorkEmail,
  pickPublishedEmail,
} from "./agents/prospect-researcher/contact-rules.js";
import { extractNamedBusinesses } from "./agents/prospect-researcher/dim4.js";
import { validateProspectRecord } from "./agents/prospect-researcher/guardrails.js";
import { applyContactRuleToStoredDecisionMaker } from "./agents/prospect-researcher/probe-refresh.js";
import { evaluateProspectRubric, analyseDim4Answer } from "./agents/prospect-researcher/rubric.js";
import type { Dim4Probe } from "./agents/prospect-researcher/dim4.js";
import {
  buildPlacesQueries,
  searchPlacesCandidatesWide,
  searchesPerRun,
  type RawPlaceCandidate,
} from "./agents/prospect-researcher/sources/places.js";
import { extractEmailsFromHtml } from "./agents/prospect-researcher/sources/website-scraper.js";
import type { DecisionMaker, ProspectSignals } from "./agents/prospect-researcher/types.js";

const SITE = "https://www.brightsmiledental.example.in/";
const COMPANY = "Bright Smile Dental Clinic";
const QUESTION = "best dental implant clinic in Delhi NCR";
const ANSWER = ["Well-regarded clinics:", "", "1. **Smile Studio**: implants.", "2. **Dental Arts**: veneers."].join("\n");

function signals(over: Partial<ProspectSignals> = {}): ProspectSignals {
  return {
    meta_ads_active: false,
    meta_ad_count: 0,
    gbp_reviews: 180,
    gbp_owner_replies: true,
    hiring_marketing: false,
    review_surge: true,
    branch_count: 1,
    places_brand_count: 1,
    ...over,
  } as ProspectSignals;
}

function probe(): Dim4Probe {
  const a = analyseDim4Answer({ company: COMPANY, domain: SITE, answer: ANSWER });
  return {
    rubric_version: "v2",
    engine: "gemini",
    model: "fixture-model",
    question: QUESTION,
    answer: ANSWER,
    names_found: a.namesFound,
    prospect_named: a.prospectNamed,
    prospect_position: a.prospectPosition,
    competitor_named: a.competitorNamed,
    score: a.score,
    date: "2026-11-13T04:00:00.000Z",
    cost_usd: 0.04,
  };
}

function publishedDm(email: string, phone?: string): DecisionMaker {
  return {
    name: "Owner / Lead Doctor",
    role: "Owner / Lead Doctor",
    email,
    phone,
    source: `${PUBLISHED_EMAIL_SOURCE} (own domain; deliverability not checked)${phone ? " + places:phone (verified business line)" : ""}`,
  } as DecisionMaker;
}

async function main() {
  // ---- which published addresses may be used ---------------------------------------------------
  const ownShared = assessPublishedEmail("info@brightsmiledental.example.in", SITE);
  assert.equal(ownShared.ok, true);
  assert.equal(ownShared.kind, "own_domain");
  assert.equal(ownShared.reason.includes("info@"), false, "the reason never carries the address");
  assert.equal(assessWorkEmail("info@brightsmiledental.example.in", SITE).ok, false, "still not a named work email");

  const free = assessPublishedEmail("brightsmile.delhi@gmail.com", SITE);
  assert.equal(free.ok, true);
  assert.equal(free.kind, "free_mail");

  assert.equal(assessPublishedEmail("hello@webagency.example.com", SITE).ok, false, "another organisation's domain is refused");
  assert.equal(assessPublishedEmail("noreply@brightsmiledental.example.in", SITE).ok, false);
  assert.equal(assessPublishedEmail("careers@brightsmiledental.example.in", SITE).ok, false);
  assert.equal(assessPublishedEmail("you@example.com", SITE).ok, false, "template placeholders are refused");
  assert.equal(assessPublishedEmail("yourname@gmail.com", SITE).ok, false);
  assert.equal(assessPublishedEmail("logo@2x.png", SITE).ok, false);
  assert.equal(assessPublishedEmail("abc123@sentry.wixpress.com", SITE).ok, false);
  assert.equal(assessPublishedEmail("info@brightsmiledental.example.in", "").ok, false, "no website, nothing was published on it");
  assert.equal(assessPublishedEmail("", SITE).ok, false);

  assert.equal(pickPublishedEmail(["brightsmile.delhi@gmail.com", "hello@webagency.example.com", "Contact@BrightSmileDental.example.in"], SITE)?.email, "contact@brightsmiledental.example.in", "the business's own domain wins over free-mail");
  assert.equal(pickPublishedEmail(["hello@webagency.example.com", "brightsmile.delhi@gmail.com"], SITE)?.kind, "free_mail");
  assert.equal(pickPublishedEmail(["hello@webagency.example.com", "noreply@brightsmiledental.example.in"], SITE), null);

  // ---- the website scrape keeps shared inboxes in a separate list -------------------------------
  {
    const named: string[] = [];
    const published: string[] = [];
    extractEmailsFromHtml('<a href="mailto:info@brightsmiledental.example.in">Write to us</a> or dr.asha@brightsmiledental.example.in', named, published);
    assert.deepEqual(named, ["dr.asha@brightsmiledental.example.in"], "the named-email list is unchanged");
    assert.ok(published.includes("info@brightsmiledental.example.in"));
    assert.ok(published.includes("dr.asha@brightsmiledental.example.in"));
    const legacy: string[] = [];
    extractEmailsFromHtml("info@brightsmiledental.example.in", legacy);
    assert.deepEqual(legacy, [], "callers that do not ask for published addresses get none");
  }

  // ---- scoring: reachable, and worth the same as the business phone -----------------------------
  const base = { company: COMPANY, domain: SITE, category: "cosmetic_dental", city: "Delhi NCR", dim4Probe: probe() };
  const emailOnly = evaluateProspectRubric({ ...base, signals: signals(), decisionMaker: publishedDm("info@brightsmiledental.example.in") });
  assert.equal(Boolean(emailOnly.disqualified), false, emailOnly.disqualificationReason);
  assert.ok(emailOnly.fitReasons.some((r) => /Dim 5 .*Published business email, on its own domain.*\[Score: 10\/15\]/.test(r)), emailOnly.fitReasons.join(" | "));
  assert.equal(emailOnly.fitReasons.some((r) => r.includes("info@")), false, "the address is never written into the reasons");

  const phoneOnly = evaluateProspectRubric({
    ...base,
    signals: signals(),
    decisionMaker: { name: "Owner / Lead Doctor", role: "Owner / Lead Doctor", email: "", phone: "011 5550 0100", source: "places:phone (verified business line) + website:owner" } as DecisionMaker,
  });
  const emailAndPhone = evaluateProspectRubric({ ...base, signals: signals(), decisionMaker: publishedDm("info@brightsmiledental.example.in", "011 5550 0100") });
  assert.equal(emailOnly.fitScore, phoneOnly.fitScore, "a published email scores the same as a phone-only prospect");
  assert.equal(emailAndPhone.fitScore, phoneOnly.fitScore, "and adds nothing on top of the phone: no rubric weight changed");

  const largeOrg = evaluateProspectRubric({ ...base, signals: signals({ is_large_org: true, branch_count: 3 }), decisionMaker: publishedDm("info@brightsmiledental.example.in") });
  assert.equal(largeOrg.disqualified, true, "a larger organisation still needs a named work email");

  const wrongDomain = evaluateProspectRubric({ ...base, signals: signals(), decisionMaker: publishedDm("hello@webagency.example.com") });
  assert.equal(wrongDomain.disqualified, true, "the source tag alone is not enough; the address is re-checked");

  // ---- write gate and stored-row re-check -------------------------------------------------------
  const record = {
    tenant_id: "tgl",
    company: COMPANY,
    category: "cosmetic_dental",
    city: "Delhi NCR",
    website: SITE,
    door: "aeo",
    fit_score: emailOnly.fitScore,
    fit_reasons: emailOnly.fitReasons,
    decision_maker: publishedDm("info@brightsmiledental.example.in"),
    signals: signals(),
    status: "new",
    source_refs: ["places:place_id:ChIJfixture", "dns:pass:203.0.113.10", publishedDm("info@brightsmiledental.example.in").source],
  };
  const gate = validateProspectRecord(record);
  assert.equal(gate.valid, true, gate.reason);
  const noContact = validateProspectRecord({ ...record, decision_maker: { ...record.decision_maker, email: "", source: "unverified:no_contact_found" } });
  assert.equal(noContact.valid, false);

  const kept = applyContactRuleToStoredDecisionMaker(publishedDm("info@brightsmiledental.example.in"), SITE, true);
  assert.equal(kept.email, "info@brightsmiledental.example.in", "the next day's re-check keeps a published address");
  const notOwnerRun = applyContactRuleToStoredDecisionMaker(publishedDm("info@brightsmiledental.example.in"), SITE, false);
  assert.equal(notOwnerRun.email, "", "but not for a larger organisation");
  const hunterShared = applyContactRuleToStoredDecisionMaker({ ...publishedDm("info@brightsmiledental.example.in"), source: "hunter:verified (status: deliverable, score: 90)" } as DecisionMaker, SITE, true);
  assert.equal(hunterShared.email, "", "a shared inbox that was stored as a named email is still removed");

  // ---- several searches a run -------------------------------------------------------------------
  assert.equal(searchesPerRun({}), 4);
  assert.equal(searchesPerRun({ PROSPECT_SEARCHES_PER_RUN: "6" }), 6);
  assert.equal(searchesPerRun({ PROSPECT_SEARCHES_PER_RUN: "40" }), 8, "clamped");
  assert.equal(searchesPerRun({ PROSPECT_SEARCHES_PER_RUN: "0" }), 4);

  const q0 = buildPlacesQueries("Delhi NCR", "cosmetic_dental", 4, 0);
  assert.equal(q0.length, 4);
  assert.equal(q0[0], "dental implant cosmetic clinic in Delhi NCR", "the metro-wide search always comes first");
  assert.equal(q0[1], "dental implant cosmetic clinic in South Delhi, Delhi NCR");
  const q1 = buildPlacesQueries("Delhi NCR", "cosmetic_dental", 4, 1);
  assert.notDeepEqual(q0.slice(1), q1.slice(1), "another day covers other areas");
  assert.equal(new Set(q0).size, 4);
  assert.deepEqual(buildPlacesQueries("Delhi NCR", "cosmetic_dental", 1, 0), ["dental implant cosmetic clinic in Delhi NCR"]);
  assert.equal(buildPlacesQueries("Chandigarh Tricity", "hospitals", 3, 0)[1], "super speciality hospital surgical clinic in Chandigarh");
  assert.equal(buildPlacesQueries("Some Other City", "ivf_fertility", 4, 0).length, 1, "a metro with no area list makes one search");

  {
    const asked: string[] = [];
    const cand = (id: string): RawPlaceCandidate => ({ placeId: id, name: `Clinic ${id}`, address: "x", city: "Delhi NCR", placeIdVerified: true }) as RawPlaceCandidate;
    const fake = async (_c: string, _k: string, o?: { query?: string }) => {
      asked.push(o?.query || "");
      return asked.length === 1 ? [cand("a"), cand("b")] : [cand("b"), cand(`c${asked.length}`)];
    };
    const wide = await searchPlacesCandidatesWide("Delhi NCR", "cosmetic_dental", { count: 3, now: new Date("2026-11-13T04:00:00Z"), search: fake as any, remaining: () => 90 });
    assert.equal(wide.queries.length, 3);
    assert.deepEqual(asked, wide.queries);
    assert.deepEqual(wide.candidates.map((c) => c.placeId), ["a", "b", "c2", "c3"], "the same listing from two searches is kept once");

    asked.length = 0;
    let left = 27;
    const tight = await searchPlacesCandidatesWide("Delhi NCR", "cosmetic_dental", {
      count: 4,
      reserve: 25,
      search: (async (c: string, k: string, o?: { query?: string }) => {
        left--;
        return fake(c, k, o);
      }) as any,
      remaining: () => left,
    });
    assert.equal(tight.queries.length, 2, "stops while enough quota is left for the details lookups");
  }

  // ---- group headings are not competitors -------------------------------------------------------
  {
    const names = extractNamedBusinesses(
      ["**For Smile Makeovers / Veneers / Luxury Aesthetics**", "1. **The Dental Roots**: Gurugram.", "2. **Dent Ally**: South Delhi.", "**Locations**", "**For Proximity & Routine Care**", "3. **Clove Dental**: many branches."].join("\n")
    ).map((n) => n.name);
    assert.deepEqual(names, ["The Dental Roots", "Dent Ally", "Clove Dental"]);
  }

  console.log("test-researcher-published-email: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
