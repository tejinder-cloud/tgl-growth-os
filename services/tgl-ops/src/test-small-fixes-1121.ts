// services/tgl-ops/src/test-small-fixes-1121.ts
// 21 Nov fixes: the paid audit is saved before the PDF upload; exam names in capitals in the audit email;
// agents that only work when given work are not flagged as silent.
import assert from "node:assert/strict";
import { makeExecute, type ExecutorPorts, type ProspectView } from "./agents/outreach-sequencer/execute.js";
import type { AuditSummary, OutreachState } from "./agents/outreach-sequencer/types.js";
import { article, buildProspectAuditEmail, fixAcronyms } from "./agents/aeo-audit-engine/prospect-audit-review.js";
import { isAgentScheduledOnDate, type AgentRecord } from "./lib/agents.js";

const AUDIT: AuditSummary = {
  visibility_percent: 20, mentions: 3, total_queries: 15, mentions_by_engine: { chatgpt: 1 },
  top_competitors: ["Rival Dental"], top_cited_domains: ["practo.com"], audited_at: "2026-11-21T08:00:00Z",
};

async function main() {
  // 1. Upload fails: the audit is kept, and the retry does not pay for it again.
  let state: OutreachState = { state: "active", enrolled_at: "2026-11-21T07:00:00Z", next_touch: 1, next_due_at: "2026-11-21T07:00:00Z", touches: [] };
  let audits = 0, uploads = 0, uploadFails = true;
  const view = (): ProspectView => ({ id: "p1", company: "Test Dental", category: "cosmetic_dental", city: "Hyderabad", decisionMakerName: "Dr. Test", outreach: state, email: "dr@test.example" } as any);
  const ports: ExecutorPorts = {
    now: () => new Date("2026-11-21T08:00:00Z"),
    senderName: "Tejinder",
    whatsappEnabled: false,
    auditEveryTouch: true,
    loadProspect: async () => view(),
    saveState: async (_id, s) => { state = s; },
    buildOnePager: async () => { throw new Error("must not be used when the split ports exist"); },
    runAudit: async () => { audits++; return AUDIT; },
    storeOnePager: async () => { uploads++; if (uploadFails) throw new Error("Bucket not found"); return "tgl/test/1.pdf"; },
    signOnePagerUrl: async (p) => `https://x.test/${p}`,
    upsertContact: async () => "",
    sendMessage: async () => ({ messageId: "m1" }),
  };
  const exec = makeExecute(ports);
  const item = { prospectId: "p1", company: "Test Dental", touch: 1 as const, channel: "email" as const, dueAt: state.next_due_at };
  const first = await exec(item, "live");
  assert.equal(first.status, "held");
  assert.equal(audits, 1);
  assert.deepEqual(state.audit, AUDIT, "audit saved even though the upload failed");
  assert.equal(state.onepager_path, undefined);
  uploadFails = false;
  const second = await exec(item, "live");
  assert.equal(second.status, "sent");
  assert.equal(audits, 1, "the retry did not run the paid audit again");
  assert.equal(uploads, 2);
  assert.equal(state.onepager_path, "tgl/test/1.pdf");

  // 2. Exam names in capitals, with the right article.
  assert.equal(fixAcronyms("nclex coaching centre"), "NCLEX coaching centre");
  assert.equal(fixAcronyms("neet and jee coaching"), "NEET and JEE coaching");
  assert.equal(fixAcronyms("ivf centre"), "IVF centre");
  assert.equal(fixAcronyms("dental clinic"), "dental clinic");
  assert.equal(fixAcronyms("catering service"), "catering service", "only whole words");
  assert.equal(article("NCLEX coaching centre"), "an");
  assert.equal(article("IVF centre"), "an");
  assert.equal(article("JEE coaching institute"), "a");
  assert.equal(article("dental clinic"), "a");
  assert.equal(article("eye hospital"), "an");
  const mail = buildProspectAuditEmail({ business_name: "Navkiran Nursing Classes", category_phrase: "nclex coaching centre", city: "Mohali", contact_name: "" }, {});
  assert.match(mail.text, /about an NCLEX coaching centre in Mohali/);

  // 3. Silence check skips agents that only work when given work.
  const idle = { name: "web-builder", status: "active", silence_check: false, routines: [{ name: "daily", frequency: "daily", schedule: "0 9 * * *" }] } as unknown as AgentRecord;
  const daily = { name: "aeo-audit-engine", status: "active", routines: [{ name: "daily", frequency: "daily", schedule: "0 6 * * *" }] } as unknown as AgentRecord;
  assert.equal(isAgentScheduledOnDate(idle, "2026-11-21"), false);
  assert.equal(isAgentScheduledOnDate(daily, "2026-11-21"), true);

  console.log("test-small-fixes-1121: all checks passed");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
