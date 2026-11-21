// services/tgl-ops/src/test-outreach-enrol.ts
// Only prospects with an email address are enrolled while every touch goes by email (13 Nov 2026).
import assert from "node:assert/strict";
import { createMemoryStore, getOutreachState, isEnrollable, type OutreachProspect } from "./agents/outreach-sequencer/store.js";
import { enrolNewProspects } from "./agents/outreach-sequencer/live.js";

const row = (id: string, over: Partial<{ email: string; phone: string; status: string; fit: number; door: string }> = {}) =>
  ({
    id,
    tenant_id: "tgl",
    company: `Clinic ${id}`,
    website: "https://clinic.example",
    category: "ivf_fertility",
    city: "Mumbai",
    door: over.door ?? "aeo",
    status: over.status ?? "reviewed",
    fit_score: over.fit ?? 80,
    fit_reasons: [],
    decision_maker: { name: "Owner / Lead Doctor", email: over.email ?? "", phone: over.phone ?? "022 5550 0100" },
    signals: {},
  }) as unknown as OutreachProspect;

async function main() {
  assert.equal(isEnrollable(row("a", { email: "info@clinic.example" })), true);
  assert.equal(isEnrollable(row("b")), false, "phone only: waits for the WhatsApp flow");
  assert.equal(isEnrollable(row("c", { email: "not an email" })), false);
  assert.equal(isEnrollable(row("d", { email: "info@clinic.example", status: "new" })), false, "only after the Architect's approval");
  assert.equal(isEnrollable(row("e", { email: "info@clinic.example", fit: 60 })), false);
  const store = createMemoryStore([row("a", { email: "info@clinic.example" }), row("b"), row("f", { email: "dr@clinic.example" })]);
  assert.deepEqual((await store.loadEnrollable(10)).map((p) => p.id).sort(), ["a", "f"]);

  // The tick starts the sequence for approved prospects: touch 1 due at once, status handed_to_outreach.
  const at = new Date("2026-11-20T05:00:00Z"); // 10:30 IST
  const pool = createMemoryStore([
    row("g", { email: "a@x.example", fit: 85 }),
    row("h", { email: "b@x.example", fit: 75 }),
    row("i", { email: "c@x.example", fit: 72 }),
    row("j"), // phone only
    row("k", { email: "d@x.example", status: "new" }), // not approved
  ]);
  const first = await enrolNewProspects(pool, at, 2);
  assert.deepEqual(first.map((p) => p.id), ["g", "h"], "highest fit first, at most the daily number");
  const g = pool.rows.find((p) => p.id === "g")!;
  assert.equal(g.status, "handed_to_outreach");
  const st = getOutreachState(g)!;
  assert.equal(st.state, "active");
  assert.equal(st.next_touch, 1);
  assert.equal(st.next_due_at, at.toISOString());
  assert.deepEqual(st.touches, []);
  assert.equal((await enrolNewProspects(pool, new Date("2026-11-20T08:00:00Z"), 2)).length, 0, "the day's number is already used");
  const next = await enrolNewProspects(pool, new Date("2026-11-21T05:00:00Z"), 2);
  assert.deepEqual(next.map((p) => p.id), ["i"], "next day: the rest; never the phone-only or unapproved rows");
  assert.equal((await enrolNewProspects(pool, new Date("2026-11-22T05:00:00Z"), 2)).length, 0, "never enrolled twice");

  console.log("test-outreach-enrol: all checks passed");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
