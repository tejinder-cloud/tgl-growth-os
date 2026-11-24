// Offline checks for the advance AI checks on phone-only businesses (24 Nov 2026). Nothing is sent; no network.
import assert from "node:assert/strict";
import { pickPreauditTargets, runPreaudits, preauditsPerDay, type PreauditCandidate } from "./agents/outreach-sequencer/preaudit.js";
import type { AuditSummary } from "./agents/outreach-sequencer/types.js";

const NOW = new Date("2026-11-25T05:30:00Z");
function p(id: string, over: Partial<PreauditCandidate> = {}): PreauditCandidate {
  return { id, company: `Biz ${id}`, website: `https://${id}.example`, city: "Mohali", category: "dental", status: "reviewed", door: "aeo", fit_score: 70, decision_maker: { email: "", phone: "098765 43210" }, signals: {}, ...over };
}

async function main() {
  const rows = [
    p("a", { fit_score: 72 }),
    p("b", { fit_score: 90 }),
    p("email", { decision_maker: { email: "info@x.example", phone: "098765 43210" } }),
    p("nophone", { decision_maker: { email: "", phone: "" } }),
    p("nosite", { website: "" }),
    p("low", { fit_score: 60 }),
    p("new", { status: "new" }),
    p("sent", { signals: { outreach: { touch: 1 } } }),
    p("fresh", { signals: { preaudit: { audited_at: "2026-11-20T00:00:00Z" } } }),
    p("stale", { fit_score: 66, signals: { preaudit: { audited_at: "2026-10-01T00:00:00Z" } } }),
    p("other", { door: "ads" }),
  ];
  assert.deepEqual(pickPreauditTargets(rows, NOW, 10).map((r) => r.id), ["b", "a", "stale"], "phone-only, approved, unchecked or stale; highest fit first");
  assert.deepEqual(pickPreauditTargets(rows, NOW, 2).map((r) => r.id), ["b", "a"], "daily limit");

  assert.equal(preauditsPerDay({}), 5);
  assert.equal(preauditsPerDay({ PREAUDITS_PER_DAY: "0" }), 0);
  assert.equal(preauditsPerDay({ PREAUDITS_PER_DAY: "99" }), 20);
  assert.equal(preauditsPerDay({ PREAUDITS_PER_DAY: "x" }), 5);

  const saved: string[] = [];
  const run = await runPreaudits({
    list: async () => rows,
    now: () => NOW,
    limit: 5,
    audit: async (x) => {
      if (x.company === "Biz a") throw new Error("Gemini 402");
      return { mentions: 1, total_queries: 15 } as AuditSummary;
    },
    save: async (id) => { saved.push(id); },
  });
  assert.deepEqual(saved, ["b", "stale"], "a failed check is not saved");
  assert.deepEqual(run.done.map((d) => d.company), ["Biz b", "Biz stale"]);
  assert.deepEqual(run.failed, [{ company: "Biz a", error: "Gemini 402" }]);
  console.log("test-preaudit: all checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
