// Day 27 — agency client brands follow the agency's subscription.
process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { brandsDueToday } from "./agents/aeo-audit-engine/cadence.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }

function sb(data: Record<string, any[]>) {
  const q = (table: string) => { const api: any = { select: () => api, eq: () => api, is: () => api, in: () => api, order: () => api, limit: () => api, then: (r: any) => r({ data: data[table] ?? [] }) }; return api; };
  return { from: q } as any;
}

async function main() {
await t("client brands run on their agency's plan; suspended agency stops them; direct brands use their own", async () => {
  const data = {
    brands: [{ id: "b_client", tenant_id: "c1" }, { id: "b_direct", tenant_id: "d1" }, { id: "b_susp", tenant_id: "c2" }],
    subscriptions: [
      { tenant_id: "a1", plan: "agency", status: "active", trial_started_at: null, trial_ends_at: null },
      { tenant_id: "a2", plan: "agency", status: "suspended", trial_started_at: null, trial_ends_at: null },
      { tenant_id: "d1", plan: "track", status: "active", trial_started_at: null, trial_ends_at: null },
    ],
    runs: [],
    tenants: [{ id: "c1", kind: "agency_client", parent_tenant_id: "a1" }, { id: "c2", kind: "agency_client", parent_tenant_id: "a2" }, { id: "d1", kind: "direct", parent_tenant_id: null }],
  };
  const { due } = await brandsDueToday(sb(data), "2026-11-09");   // Monday
  assert.deepEqual([...due].sort(), ["b_client", "b_direct"]);
});
console.log(`\nDay 27: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
