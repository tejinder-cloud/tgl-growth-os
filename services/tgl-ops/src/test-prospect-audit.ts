// services/tgl-ops/src/test-prospect-audit.ts
// Prospect audits (decisions/2026-11-12.md): free first audit without a verified setup profile, posted to #revenue
// for the Architect's review, never sent by the service. Fixture engines only: no live engine call, no Slack post,
// no prospect contact, no write to decisions/ or logs/ on main (raw answers go to logs/.test/ under TGL_TEST_MODE).
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runShortFormAudit, analyzeProspectAnswer, type ShortFormAuditResult } from "./agents/aeo-audit-engine/short-form.js";
import { businessNamesInAnswer, looksLikeBusinessName, canonicalBusinessName } from "./agents/aeo-audit-engine/named-businesses.js";
import {
  buildProspectAuditPrompts,
  parseAuditCommand,
  prospectAuditSummary,
  prospectCategoryPhrase,
  prospectDomain,
  isBroaderThan,
  tidyCity,
  resetProspectAuditMemoryForTests,
  runProspectAudit,
  type ProspectAuditDeps,
  type ProspectAuditRequest,
} from "./agents/aeo-audit-engine/prospect-audit.js";
import { auditWording, generateAuditPdf, promptsLabel, queryColumnLabel, renderAuditHtml } from "./agents/aeo-audit-engine/pdf.js";
import { runProspectAudit as runOutreachProspectAudit } from "./agents/outreach-sequencer/onepager.js";
import type { EngineAnswer, EngineId } from "./agents/aeo-audit-engine/types.js";
import { createApp } from "./app.js";
import { resetSiteLeadRateLimit, setSiteLeadDeps } from "./routes/site-leads.js";

if (process.env.TGL_TEST_MODE !== "1") {
  console.error("test-prospect-audit must run with TGL_TEST_MODE=1 (it would otherwise write traces outside logs/.test).");
  process.exit(1);
}

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`ok - ${name}`);
}

const BUSINESS = "Sunrise Dental";
const SITE = "https://www.sunrisedental.in/";

// Answers in the shapes the engines actually use: bold names in bullets, numbered lists, headings and labels.
const ANSWER_OTHERS = [
  "### Top Private Dental Clinics",
  "",
  "*   **Clove Dental, Sector 35, Chandigarh**",
  "    *   **Best for:** implants and aligners.",
  "*   **Apollo White Dental**",
  "    *   **Highlights:** NABH accredited. **NABH**",
  "",
  "### Summary Recommendation",
  "*   **For budget care:** Clove Dental.",
].join("\n");
const ANSWER_SECOND = "1. **Clove Dental**: national chain.\n2. **Sunrise Dental**: single clinic in Mohali.\n3. **Apollo White Dental**: chain.";
const ANSWER_FIRST = "1. **Sunrise Dental**: strong reviews.\n2. **Clove Dental**: chain.";
const ANSWER_RUNNING_TEXT = "Many patients mention sunrisedental.in in reviews. **Clove Dental** and **Apollo White Dental** are the larger names.";

function answer(engine: EngineId, text: string, costUsd = 0.01): EngineAnswer {
  return { engine, model: "fixture-model", text, citations: [{ url: "https://www.practo.com/chandigarh/dentist", title: "Practo" }], usage: {} as any, costUsd, costSource: "computed", raw: null } as EngineAnswer;
}

/** ChatGPT never names the prospect; Gemini names it second; Perplexity names it first on question 1 only. */
const fixtureEngines = async (engine: EngineId, prompt: string): Promise<EngineAnswer> => {
  if (engine === "chatgpt") return answer(engine, ANSWER_OTHERS);
  if (engine === "gemini") return answer(engine, ANSWER_SECOND);
  return answer(engine, prompt.startsWith("best ") ? ANSWER_FIRST : ANSWER_OTHERS);
};

function fakeDeps(over: Partial<ProspectAuditDeps> = {}) {
  const lines: string[] = [];
  const files: any[] = [];
  const spends: Array<{ usd: number; details: string }> = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prospect-audit-"));
  const deps: Partial<ProspectAuditDeps> = {
    renderPdf: async (result, outFile) => generateAuditPdf(result, path.join(tmp, path.basename(outFile))),
    postFile: async (o) => {
      files.push(o);
      return { ok: true, fileId: "F-FIXTURE" };
    },
    postLine: async (o) => {
      lines.push(o.text);
      return { ok: true };
    },
    getSpendUsd: async () => 0,
    getCapUsd: async () => 1,
    recordSpend: (usd, details) => void spends.push({ usd, details }),
    now: () => new Date("2026-11-12T09:00:00.000Z"),
    ...over,
  };
  return { deps, lines, files, spends };
}

const baseReq: ProspectAuditRequest = { businessName: BUSINESS, website: SITE, industry: "healthcare", city: "Mohali", source: "site_lead", leadId: "row-1" };

async function main(): Promise<void> {
  // ---- what the business is, and the five questions ----
  {
    assert.deepEqual(prospectCategoryPhrase({ businessName: BUSINESS, industry: "healthcare" }), { phrase: "dental clinic", from: "name" });
    assert.deepEqual(prospectCategoryPhrase({ businessName: "Dr. A Sharma | Laparoscopic Surgeon", industry: "healthcare" }), { phrase: "laparoscopic surgeon", from: "name" });
    assert.deepEqual(prospectCategoryPhrase({ businessName: "Hotel Skyline", industry: "hospitality" }), { phrase: "hotel", from: "industry" });
    assert.deepEqual(prospectCategoryPhrase({ businessName: "Heart of the Hills Resort", industry: "hospitality" }), { phrase: "hotel", from: "industry" }, "a hotel is not a heart hospital");
    assert.deepEqual(prospectCategoryPhrase({ businessName: "Bright IELTS Academy", industry: "education" }), { phrase: "IELTS coaching institute", from: "name" });
    assert.deepEqual(prospectCategoryPhrase({ businessName: "Aarogya Wellness", industry: "healthcare", what: "  a physiotherapy clinic " }), { phrase: "physiotherapy clinic", from: "architect" });
    assert.equal(prospectCategoryPhrase({ businessName: "Aarogya Wellness", industry: "healthcare" }), null, "healthcare with no specialty in the name is not guessed");
    assert.equal(prospectCategoryPhrase({ businessName: "Nimbus", industry: "saas" }), null);
    assert.equal(prospectCategoryPhrase({ businessName: "Kora", industry: "ecommerce" }), null);
    // First live audit, 12 Nov: "coaching institute" was typed for a nursing-exam institute and every engine
    // answered "it depends on the course". The name already says more, so the narrower phrase is asked.
    assert.deepEqual(prospectCategoryPhrase({ businessName: "Navkiran Nursing Classes", what: "coaching institute" }), { phrase: "nursing exam coaching institute", from: "name" });
    assert.deepEqual(prospectCategoryPhrase({ businessName: "Navkiran Nursing Classes", what: "nursing coaching institute" }), { phrase: "nursing coaching institute", from: "architect" }, "the Architect's own narrower words are kept");
    assert.equal(isBroaderThan("coaching institute", "IELTS coaching institute"), true);
    assert.equal(isBroaderThan("dental clinic", "dental clinic"), false);
    assert.equal(isBroaderThan("skin clinic", "dental clinic"), false);
    assert.deepEqual(prospectCategoryPhrase({ businessName: "Sunrise Dental", what: "cosmetic dentist" }), { phrase: "cosmetic dentist", from: "architect" });
    ok("category phrase: architect's words, then the name (clinics and institutes only), then the industry; otherwise not guessed");

    const prompts = buildProspectAuditPrompts("dental clinic", "Mohali");
    assert.equal(prompts.length, 5);
    assert.equal(new Set(prompts).size, 5);
    assert.ok(prompts.every((p) => p.includes("dental clinic") && p.includes("Mohali")));
    assert.ok(prompts.every((p) => !p.toLowerCase().includes("sunrise")));
    assert.equal(prompts[0], "best dental clinic in Mohali");
    assert.ok(buildProspectAuditPrompts("online saree store", null).every((p) => p.includes("in India")));
    assert.equal(buildProspectAuditPrompts("dental clinic", "mohali")[0], "best dental clinic in Mohali", "a city typed in lower case is capitalised");
    assert.equal(tidyCity("new delhi"), "New Delhi");
    assert.equal(tidyCity("Navi Mumbai"), "Navi Mumbai");
    assert.ok(Math.max(...buildProspectAuditPrompts("dental clinic", "Mohali").map((p) => p.length)) <= 65, "typical questions fit one table row");
    ok("five distinct buyer questions from the phrase and city, none with the business name; no city means India");

    assert.equal(prospectDomain(SITE), "sunrisedental.in");
    assert.equal(prospectDomain("not a url at all"), "");
    assert.deepEqual(parseAuditCommand("audit | Sunrise Dental | sunrisedental.in | dental clinic | Mohali"), { businessName: "Sunrise Dental", website: "sunrisedental.in", what: "dental clinic", city: "Mohali", source: "architect" });
    assert.deepEqual(parseAuditCommand("AUDIT|Sunrise Dental|sunrisedental.in"), { businessName: "Sunrise Dental", website: "sunrisedental.in", what: null, city: null, source: "architect" });
    assert.equal(parseAuditCommand("audit | Sunrise Dental"), null);
    assert.equal(parseAuditCommand("@web-builder | core | audit the page"), null);
    ok("Slack command parses: audit | business | website | what | city (last two optional)");
  }

  // ---- reading business names out of an answer ----
  {
    const names = businessNamesInAnswer(ANSWER_OTHERS).map((n) => n.name);
    assert.deepEqual(names, ["Clove Dental", "Apollo White Dental"], names.join(" | "));
    for (const junk of ["Best for", "Highlights", "NABH", "Eye Care", "Mother & Child Care / Maternity", "Top Private Dental Clinics", "For budget care", "Summary Recommendation", "Why it matters?", "JEE/NEET", "IELTS", "NORCET", "UPSC CSE", "NEET UG"]) {
      assert.equal(looksLikeBusinessName(junk), false, junk);
    }
    for (const real of ["Fortis Hospital", "Grewal Eye Institute", "PGIMER", "Dr. R. K. Mehta", "Cloudnine Hospital", "Allen Career Institute", "Taj Chandigarh", "Umrao NCLEX Coaching Centre", "Mantram Nursing Academy", "Aakash Institute", "AIIMS"]) {
      assert.equal(looksLikeBusinessName(real), true, real);
    }
    assert.equal(canonicalBusinessName("Fortis Hospital, Sector 62, Mohali"), "Fortis Hospital");
    ok("business names: headings, labels and accreditations are dropped; locality detail is trimmed");

    const lens = { name: BUSINESS, variants: [BUSINESS], domains: ["sunrisedental.in"], competitors: [] };
    assert.deepEqual(analyzeProspectAnswer(ANSWER_OTHERS, lens), { mentioned: false, position: null, competitorsMentioned: ["Clove Dental", "Apollo White Dental"] });
    const second = analyzeProspectAnswer(ANSWER_SECOND, lens);
    assert.equal(second.mentioned, true);
    assert.equal(second.position, 2);
    assert.deepEqual(second.competitorsMentioned, ["Clove Dental", "Apollo White Dental"]);
    assert.equal(analyzeProspectAnswer(ANSWER_FIRST, lens).position, 1);
    const running = analyzeProspectAnswer(ANSWER_RUNNING_TEXT, lens);
    assert.equal(running.mentioned, true);
    assert.ok((running.position as number) >= 4, "named only in running text is a mention with no top-three rank");
    ok("prospect answers: position counts the businesses named before the prospect; no tracked list needed");
  }

  // ---- the audit engine in prospect mode ----
  let prospectResult: ShortFormAuditResult;
  {
    const prompts = buildProspectAuditPrompts("dental clinic", "Mohali");
    const lens = { name: BUSINESS, variants: [BUSINESS], domains: ["sunrisedental.in"], competitors: [] };
    // No Supabase, no setup profile: a client audit is refused, exactly as before.
    await assert.rejects(() => runShortFormAudit(lens, { prompts, engineMock: fixtureEngines, supabase: null, saveRawJson: false }), /Audit refused/);
    ok("without the prospect option the engine still refuses a business with no verified setup");

    prospectResult = await runShortFormAudit(lens, { prospect: { name: BUSINESS, website: SITE }, prompts, engineMock: fixtureEngines, supabase: null, saveRawJson: false });
    assert.equal(prospectResult.auditKind, "prospect");
    assert.equal(prospectResult.brand.setupStatus, "prospect_unverified");
    assert.equal(prospectResult.brand.primaryDomain, "sunrisedental.in");
    assert.equal(prospectResult.totalQueries, 15);
    // Gemini 5 of 5, Perplexity 1 of 5 (question 1), ChatGPT 0 of 5.
    assert.deepEqual(prospectResult.summary.mentionsByEngine, { chatgpt: 0, gemini: 5, perplexity: 1 });
    assert.equal(prospectResult.summary.totalMentions, 6);
    assert.equal(prospectResult.summary.visibilityScorePercent, 40);
    assert.equal(prospectResult.results[0].engineResults.gemini.badge, "Named #2");
    assert.equal(prospectResult.results[0].engineResults.perplexity.badge, "Named #1");
    assert.equal(prospectResult.results[0].engineResults.chatgpt.badge, "—");
    assert.equal(prospectResult.summary.competitorMentions["Clove Dental"], 15);
    assert.equal(prospectResult.summary.competitorMentions["Apollo White Dental"], 14);
    assert.equal(prospectResult.summary.competitorMentions["Sunrise Dental"], undefined, "the prospect is never its own competitor");
    assert.equal(prospectResult.summary.totalCostUsd, 0.15);
    assert.ok(prospectResult.nextSteps.formattedText.length > 0);
    ok("prospect mode: 15 answers, mentions, ranks and names all read from the answers; marked prospect_unverified");

    await assert.rejects(() => runShortFormAudit(lens, { prospect: { name: BUSINESS, website: SITE }, prompts: prompts.slice(0, 4), engineMock: fixtureEngines, saveRawJson: false }), /exactly 5 questions/);
    await assert.rejects(() => runShortFormAudit(lens, { prospect: { name: BUSINESS, website: SITE }, prompts: [...prompts.slice(0, 4), "is Sunrise Dental any good"], engineMock: fixtureEngines, saveRawJson: false }), /containing the business name/);
    await assert.rejects(() => runShortFormAudit(lens, { prospect: { name: BUSINESS, website: "" }, prompts, engineMock: fixtureEngines, saveRawJson: false }), /business name and a website/);
    ok("prospect mode refuses: wrong number of questions, a question with the business name, no website");
  }

  // ---- the PDF does not claim a verified setup ----
  {
    assert.equal(promptsLabel(prospectResult), "Buyer Questions for Your Category");
    assert.equal(queryColumnLabel(prospectResult), "Buyer Question (Your Category and City)");
    const html = renderAuditHtml(prospectResult);
    assert.ok(!/Verified/.test(html), "prospect PDF markup must not say Verified");
    const pw = auditWording(prospectResult);
    assert.equal(pw.competitors, "Who AI Named Instead of You");
    assert.equal(pw.action, "WHAT THIS SHOWS");
    assert.ok(pw.closing.includes("20-minute conversation"));
    for (const jargon of ["Mechanistic", "MECHANISTIC", "Authority Channels", "Query Visibility Matrix", "Brand Share"]) assert.ok(!html.includes(jargon), `prospect PDF must not say ${jargon}`);
    assert.ok(html.includes("Who AI Named Instead of You") && html.includes("20-minute conversation"));
    const clientLike = { ...prospectResult, auditKind: "client" as const };
    const cw = auditWording(clientLike);
    assert.equal(cw.action, "MECHANISTIC NEXT STEPS");
    assert.equal(cw.closing, "");
    assert.ok(!renderAuditHtml(clientLike).includes("20-minute conversation"), "client audits are unchanged");
    assert.equal(promptsLabel(clientLike), "Verified Buyer Prompts");
    assert.equal(queryColumnLabel(clientLike), "Buyer Query (Verified Setup Profile)");
    const pdf = await generateAuditPdf(prospectResult);
    assert.ok(pdf.sizeBytes > 1000 && pdf.sizeBytes < 2 * 1024 * 1024);
    assert.equal(pdf.buffer.subarray(0, 4).toString(), "%PDF");
    ok("PDF: prospect audits say 'Buyer Questions for Your Category'; client audits keep the verified wording");
  }

  // ---- run and post for review ----
  {
    resetProspectAuditMemoryForTests();
    const f = fakeDeps();
    const out = await runProspectAudit(baseReq, f.deps, { engineMock: fixtureEngines });
    assert.equal(out.status, "posted");
    if (out.status === "posted") {
      assert.equal(out.fileId, "F-FIXTURE");
      assert.equal(out.costUsd, 0.15);
      assert.equal(out.prompts[0], "best dental clinic in Mohali");
    }
    assert.equal(f.files.length, 1);
    assert.equal(f.files[0].channel, "#revenue");
    assert.equal(f.files[0].filename, "sunrise-dental-ai-visibility-audit-2026-11-12.pdf");
    assert.equal(f.lines.length, 1);
    const text = f.lines[0];
    assert.ok(text.includes("Prospect audit ready for review: Sunrise Dental"));
    assert.ok(text.includes("website request"));
    assert.ok(text.includes("Named in *6 of 15* answers (40%)"));
    assert.ok(text.includes("ChatGPT 0 of 5") && text.includes("Gemini 5 of 5") && text.includes("Perplexity 1 of 5"));
    assert.ok(text.includes("Clove Dental (15)"));
    assert.ok(text.includes('"dental clinic", read from the business name'));
    for (let i = 1; i <= 5; i++) assert.ok(text.includes(`${i}. `));
    assert.ok(text.includes("*Not sent to the prospect.*"));
    assert.ok(text.includes("/task audit | Sunrise Dental | sunrisedental.in"));
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), "no emojis");
    assert.deepEqual(f.spends.map((s) => s.usd), [0.15]);
    ok("posted: PDF and summary go to #revenue with the figures, the five questions, the cost and 'Not sent to the prospect'");

    // Same website again the same day from the form: no second spend, no second post.
    const again = await runProspectAudit(baseReq, f.deps, { engineMock: fixtureEngines });
    assert.equal(again.status, "duplicate");
    assert.equal(f.files.length, 1);
    assert.equal(f.spends.length, 1);
    // The Architect asking again is always honoured.
    const rerun = await runProspectAudit({ ...baseReq, source: "architect", what: "cosmetic dentist" }, f.deps, { engineMock: fixtureEngines });
    assert.equal(rerun.status, "posted");
    assert.ok(f.lines[1].includes("requested by the Architect") && f.lines[1].includes('"cosmetic dentist", as you gave it'));
    ok("one audit per website per day from the form; the Architect's own rerun always runs");
  }

  {
    resetProspectAuditMemoryForTests();
    const f = fakeDeps();
    let ran = 0;
    const out = await runProspectAudit({ businessName: "Nimbus", website: "nimbus.io", industry: "saas", source: "site_lead" }, { ...f.deps, runAudit: async () => { ran++; throw new Error("should not run"); } });
    assert.equal(out.status, "needs_input");
    assert.equal(ran, 0);
    assert.equal(f.spends.length, 0);
    assert.ok(f.lines[0].includes("Prospect audit not run") && f.lines[0].includes("/task audit | Nimbus | nimbus.io"));
    ok("needs input: when the questions cannot be written without guessing, nothing runs and the Architect is told how to run it");

    const g = fakeDeps({ getSpendUsd: async () => 1.02 });
    const capped = await runProspectAudit(baseReq, { ...g.deps, runAudit: async () => { ran++; throw new Error("should not run"); } });
    assert.equal(capped.status, "cap_reached");
    assert.equal(ran, 0);
    assert.ok(g.lines[0].includes("today's audit budget is used") && g.lines[0].includes("not queued"));
    ok("cap reached: no engine call, said plainly, not queued");

    const h = fakeDeps({ runAudit: async () => { throw new Error("Engine perplexity cannot run: missing environment variables [PERPLEXITY_API_KEY]"); } });
    const failed = await runProspectAudit(baseReq, h.deps);
    assert.equal(failed.status, "failed");
    assert.ok(h.lines[0].includes("Prospect audit failed") && h.lines[0].includes("PERPLEXITY_API_KEY") && h.lines[0].includes("Nothing was sent"));
    assert.equal(h.files.length, 0);
    // A failed run does not block a retry the same day.
    const retry = await runProspectAudit(baseReq, fakeDeps().deps, { engineMock: fixtureEngines });
    assert.equal(retry.status, "posted");
    ok("failed: the engine's own error is reported in #revenue, nothing is posted as an audit, a retry is allowed");

    resetProspectAuditMemoryForTests();
    const u = fakeDeps({ postFile: async () => ({ ok: false, error: "not_in_channel" }) });
    const unposted = await runProspectAudit(baseReq, u.deps, { engineMock: fixtureEngines });
    assert.equal(unposted.status, "post_failed");
    assert.ok(u.lines[0].includes("*The PDF could not be uploaded to Slack.*") && !u.lines[0].includes("Read the PDF in this channel"));
    assert.equal(u.spends.length, 1, "the answers were paid for, so the spend is recorded even when the upload fails");
    ok("upload refused: the summary says the PDF is missing instead of pointing at a file that is not there");

    const noSite = await runProspectAudit({ businessName: "Sunrise Dental", website: "", source: "architect" }, fakeDeps().deps);
    assert.equal(noSite.status, "needs_input");
    ok("no website: not run");
  }

  // ---- the outreach one-pager no longer hits the setup gate ----
  {
    const r = await runOutreachProspectAudit({ company: "Smile Studio Dental Clinic", website: "https://smilestudio.example.in", category: "dental_clinic", city: "Chandigarh" }, { engineMock: fixtureEngines, supabase: null, saveRawJson: false });
    assert.equal(r.result.auditKind, "prospect");
    assert.equal(r.summary.total_queries, 15);
    assert.ok(r.summary.top_competitors.includes("Clove Dental"));
    ok("outreach one-pager: the audit runs for a prospect with no setup profile, and names come from the answers");
  }

  // ---- the website form starts the audit, and never waits for it ----
  {
    resetSiteLeadRateLimit();
    const started: Array<{ business: string; rowId: string; domain: string | null }> = [];
    const rows: any[] = [];
    setSiteLeadDeps({
      store: { async insert(lead: any) { rows.push(lead); return `row-${rows.length}`; }, async markGhl() {} } as any,
      ghl: null,
      notify: async () => undefined,
      postLeadCard: async () => undefined,
      startAudit: (lead, rowId) => { started.push({ business: lead.business_name, rowId, domain: lead.domain }); },
    });
    const server = createApp().listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const aeo = await fetch(`${base}/aeo/lead`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_name: "Sunrise Dental", website: SITE, industry: "healthcare", city: "Mohali", name: "Dr Neha Kapoor", email: "neha@sunrisedental.in", phone: "", consent: true, source: "aeo_page", hp: "", page: "/aeo" }) });
      assert.equal(aeo.status, 200);
      assert.deepEqual(started, [{ business: "Sunrise Dental", rowId: "row-1", domain: "sunrisedental.in" }]);
      const auto = await fetch(`${base}/automation/lead`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Arjun Mehta", business_name: "Mehta Realty", email: "arjun@mehtarealty.com", phone: "98765 43210", job: "followup", message: "Leads go cold.", consent: "on", source: "ai_automation_page", hp: "", page: "/ai-automation" }) });
      assert.equal(auto.status, 200);
      assert.equal(started.length, 1, "an automation enquiry does not start an AEO audit");
      const bad = await fetch(`${base}/aeo/lead`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_name: "X", consent: true }) });
      assert.equal(bad.status, 400);
      assert.equal(started.length, 1, "an invalid request starts nothing");

      setSiteLeadDeps({
        store: { async insert() { return "row-9"; }, async markGhl() {} } as any,
        ghl: null,
        notify: async () => undefined,
        postLeadCard: async () => undefined,
        startAudit: () => { throw new Error("audit engine unavailable"); },
      });
      const still = await fetch(`${base}/aeo/lead`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_name: "Lotus IVF", website: "lotusivf.in", industry: "healthcare", city: "Pune", name: "Dr R", email: "r@lotusivf.in", phone: "", consent: true, source: "aeo_page", hp: "", page: "/aeo" }) });
      assert.equal(still.status, 200, "the visitor's request succeeds even when the audit cannot start");
      ok("website form: an AEO request starts the audit with its row id; automation and invalid requests do not; a failing start never fails the request");
    } finally {
      server.close();
      setSiteLeadDeps(null);
    }
  }

  // ---- summary text when nothing was named ----
  {
    const zero = await runShortFormAudit({ name: BUSINESS, variants: [BUSINESS], domains: ["sunrisedental.in"], competitors: [] }, { prospect: { name: BUSINESS, website: SITE }, prompts: buildProspectAuditPrompts("dental clinic", "Mohali"), engineMock: async (e) => answer(e, "It depends on your needs. Check recent reviews and ask about pricing.", 0), saveRawJson: false });
    assert.equal(zero.summary.totalMentions, 0);
    const text = prospectAuditSummary(baseReq, zero, buildProspectAuditPrompts("dental clinic", "Mohali"), '"dental clinic", read from the business name', true);
    assert.ok(text.includes("Named in *0 of 15* answers (0%)"));
    assert.ok(text.includes("none read from these answers"), "no competitor is invented when the answers name nobody");
    ok("summary: zero mentions and no names are stated plainly, nothing invented");
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((err) => {
  console.error("test-prospect-audit FAILED:", err);
  process.exit(1);
});
