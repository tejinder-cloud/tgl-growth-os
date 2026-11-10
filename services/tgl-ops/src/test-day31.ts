process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { dueKind, riskFlags, type JourneyState } from "./agents/aeo-concierge/journey.js";
import { journeyEmail } from "./agents/aeo-concierge/emails.js";

let passed = 0;
function t(name: string, fn: () => void) { try { fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }
const NOW = Date.parse("2026-11-20T06:00:00Z");
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const base = (o: Partial<JourneyState>): JourneyState => ({ now: NOW, tenantCreatedAt: ago(10), plan: "trial", status: "trialing", trialStartedAt: null, trialEndsAt: null,
  brand: { onboardingStep: 4, setupStatus: "verified", updatedAt: ago(9) }, lastSeenAt: ago(0), diyStale: 0, managedAskedRecently: false, sent: new Set(), ...o });

t("setup not finished: day 1 and day 3 reminders, nothing after a week", () => {
  assert.equal(dueKind(base({ tenantCreatedAt: ago(0.5), brand: null })), null);
  assert.equal(dueKind(base({ tenantCreatedAt: ago(1.2), brand: { onboardingStep: 2, setupStatus: null, updatedAt: ago(1) } })), "finish_setup_24h");
  assert.equal(dueKind(base({ tenantCreatedAt: ago(3.5), brand: null, sent: new Set(["finish_setup_24h"]) })), "finish_setup_72h");
  assert.equal(dueKind(base({ tenantCreatedAt: ago(3.5), brand: null, sent: new Set(["finish_setup_24h", "finish_setup_72h"]) })), null);
  assert.equal(dueKind(base({ tenantCreatedAt: ago(9), brand: null })), null);
});

t("setup sent back: once per send-back after two quiet days", () => {
  const b = { onboardingStep: 4, setupStatus: "needs_changes", updatedAt: "2026-11-17T10:00:00Z" };
  assert.equal(dueKind(base({ brand: b })), "needs_changes:2026-11-17");
  assert.equal(dueKind(base({ brand: b, sent: new Set(["needs_changes:2026-11-17"]) })), null);
  assert.equal(dueKind(base({ brand: { ...b, updatedAt: ago(1) } })), null);
});

t("trial: day 3 then day 5; after it ends: day 3 and day 14, then nothing", () => {
  assert.equal(dueKind(base({ trialStartedAt: ago(2), trialEndsAt: ago(-5) })), null);
  assert.equal(dueKind(base({ trialStartedAt: ago(3.1), trialEndsAt: ago(-4) })), "trial_day3");
  assert.equal(dueKind(base({ trialStartedAt: ago(5.2), trialEndsAt: ago(-2), sent: new Set(["trial_day3"]) })), "trial_day5");
  assert.equal(dueKind(base({ status: "expired", trialStartedAt: ago(9), trialEndsAt: ago(2) })), null);
  assert.equal(dueKind(base({ status: "expired", trialStartedAt: ago(11), trialEndsAt: ago(4) })), "trial_ended_3d");
  assert.equal(dueKind(base({ status: "expired", trialStartedAt: ago(22), trialEndsAt: ago(15), sent: new Set(["trial_ended_3d"]) })), "trial_ended_14d");
  assert.equal(dueKind(base({ status: "expired", trialStartedAt: ago(40), trialEndsAt: ago(33) })), null);
});

t("paying: managed offer once a quarter for stuck DIY items; away 14+ days once a month", () => {
  const paid = { plan: "track", status: "active", tenantCreatedAt: ago(40) };
  assert.equal(dueKind(base({ ...paid, diyStale: 3 })), "managed_offer:2026-Q4");
  assert.equal(dueKind(base({ ...paid, diyStale: 3, managedAskedRecently: true })), null);
  assert.equal(dueKind(base({ ...paid, lastSeenAt: ago(15) })), "inactive:2026-11");
  assert.equal(dueKind(base({ ...paid, lastSeenAt: ago(15), sent: new Set(["inactive:2026-11"]) })), null);
  assert.equal(dueKind(base({ ...paid, plan: "managed", diyStale: 5 })), null);   // managed: we do the work
});

t("health flags for the team", () => {
  const f = riskFlags(base({ trialStartedAt: ago(5), trialEndsAt: ago(-2), lastSeenAt: ago(4) }));
  assert.deepEqual(f, ["trial: not opened in 3+ days"]);
  assert.deepEqual(riskFlags(base({ plan: "track", status: "past_due" })), ["payment failed"]);
  assert.deepEqual(riskFlags(base({ plan: "track", status: "active", lastSeenAt: ago(20), diyStale: 4 })), ["paid: not opened in 14+ days", "4 DIY items stuck — managed candidate"]);
});

t("emails: measured numbers only, no blank lines, the right next step", () => {
  const f = { brand: "Acme Clinic", named: 3, answers: 90, topRec: "Add FAQ schema to your services page", diy: ["A", "B", "C"], note: "Please add your city", thisWeek: { n: 2, of: 45 }, lastWeek: { n: 1, of: 45 } };
  const d3 = journeyEmail("trial_day3", f, "https://app", "https://site/aeo")!;
  assert.match(d3.text, /named in 3 of 90 AI answers/); assert.match(d3.text, /Add FAQ schema/); assert.match(d3.html, /dashboard\/recommendations/);
  const none = journeyEmail("trial_day3", { ...f, named: null, answers: null, topRec: null }, "https://app", "x")!;
  assert.doesNotMatch(none.text, /named in/); assert.match(none.text, /Your first answers are in/);
  assert.match(journeyEmail("inactive:2026-11", f, "https://app", "x")!.text, /named in 2 of 45 AI answers \(the week before: 1 of 45\)/);
  assert.match(journeyEmail("needs_changes:2026-11-17", f, "https://app", "x")!.text, /“Please add your city”/);
  const offer = journeyEmail("managed_offer:2026-Q4", f, "https://app", "https://site/aeo")!;
  assert.match(offer.text, /• A\n• B\n• C/); assert.match(offer.html, /site\/aeo/);
  assert.doesNotMatch(journeyEmail("trial_day5", f, "https://app", "x")!.text, /₹|\$/);   // no prices in emails
  assert.equal(journeyEmail("unknown", f, "https://app", "x"), null);
});

console.log(`\nDay 31: ${passed} checks passed`);
