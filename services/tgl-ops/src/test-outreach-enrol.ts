// services/tgl-ops/src/test-outreach-enrol.ts
// Only prospects with an email address are enrolled while every touch goes by email (13 Nov 2026).
import assert from "node:assert/strict";
import { createMemoryStore, isEnrollable, type OutreachProspect } from "./agents/outreach-sequencer/store.js";

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
  console.log("test-outreach-enrol: all checks passed");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
