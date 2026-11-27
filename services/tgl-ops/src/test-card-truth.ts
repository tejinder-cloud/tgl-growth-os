// Offline checks for the 27 Nov morning-card fixes: audit requests count only businesses on the outreach list,
// and the card's day count comes from the build plan in work blocks. Nothing is posted.
import assert from "node:assert/strict";
import { countRevenueProgress, hostOf } from "./agents/chief-of-staff/plain-card-data.js";
import { buildLine } from "./agents/chief-of-staff/dispatch.js";

function main() {
  // 1. Hosts compare without scheme, www, path or case.
  assert.equal(hostOf("https://www.Clinic.in/about"), "clinic.in");
  assert.equal(hostOf("clinic.in"), "clinic.in");
  assert.equal(hostOf(""), "");
  assert.equal(hostOf("not a url at all"), "");

  // 2. The Architect's own runs on clients do not count; a prospect's audit does.
  const rows = [
    { business_name: "Navkiran Nursing Classes", domain: "navkirannursingclasses.com", status: "ready" },
    { business_name: "ESM Overseas", domain: "esmoverseas.com", status: "ready" },
    { business_name: "Bright Smile Dental", domain: "www.brightsmile.in", status: "sent" },
    { business_name: "TEST 2", domain: "brightsmile.in", status: "sent" },
  ];
  const onList = new Set(["brightsmile.in", "otherclinic.in"]);
  assert.deepEqual(countRevenueProgress(rows, onList), { auditsRequested: 1, auditsSent: 1 });
  assert.deepEqual(countRevenueProgress(rows, new Set()), { auditsRequested: 0, auditsSent: 0 }, "today: none of the audits are prospects");
  assert.equal(countRevenueProgress(rows).auditsRequested, 3, "without a list the old count stands (tests, no database)");

  // 3. The build line: work blocks from the build plan, the next task with a readable date, the build page link.
  const b = buildLine(new Date("2026-11-27T03:00:00Z"), { OUTREACH_PUBLIC_URL: "https://ops.example.test/" } as any);
  assert.match(b.title, /^Build \d+ of \d+ work blocks done$/);
  assert.match(b.line, /^\*Build:\* \d+ of \d+ work blocks done\./);
  assert.ok(b.line.includes("<https://ops.example.test/pipeline/build|Open the build page>"));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(b.line), "dates are written as 8 Dec, not 2026-12-08");
  assert.ok(!buildLine(new Date(), {} as any).line.includes("<"), "no link when the public address is unknown");

  console.log("test-card-truth: all checks passed");
}

main();
