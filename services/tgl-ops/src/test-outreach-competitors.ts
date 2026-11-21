// services/tgl-ops/src/test-outreach-competitors.ts
// 21 Nov 2026: the first live emails quoted "Panchkula" and "Hyderabad" as competitors. Only names that read as a
// business are quoted; when none does, the sentence is left out; the answer count is the real one.
import assert from "node:assert/strict";
import { isQuotableCompetitor, weakestQuery } from "./agents/outreach-sequencer/competitors.js";
import { summarizeAudit } from "./agents/outreach-sequencer/onepager.js";
import { renderFromTemplates, loadTemplates, resolveTemplatesDir } from "./agents/outreach-sequencer/templates.js";
import type { AuditSummary } from "./agents/outreach-sequencer/types.js";

const chd = { company: "Chandigarh Dental Clinic", city: "Chandigarh Tricity" };
const hyd = { company: "Dr Sris Dental & Implant Clinic - Gachibowli, Hyderabad", city: "Hyderabad" };

// The names from the two live emails, and real ones from the same answers.
for (const bad of ["Panchkula", "Mohali", "Implants", "Hyderabad", "Root Canal", "Gachibowli", "Jubilee Hills", "Dental Implants", "Cosmetic Smile Design", "Painless Root Canal", "Highlights", "Endodontist", "Chandigarh Dental Clinic", "Clove"]) {
  assert.equal(isQuotableCompetitor(bad, bad === "Clove" ? chd : bad.includes("Hills") || bad === "Hyderabad" || bad === "Gachibowli" || bad.includes("Root") ? hyd : chd), false, `${bad} must not be quoted`);
}
assert.equal(isQuotableCompetitor("The Dental Specialists", hyd), false, "all generic words: left out, the safe side");
for (const good of ["FMS Dental Hospitals", "Dr. Vikas Gowd", "Apollo Dental", "Eledent Dental Hospital", "The Smile Designers"]) {
  assert.equal(isQuotableCompetitor(good, good.startsWith("The Smile") ? chd : hyd), true, `${good} may be quoted`);
}

// A result in which places lead the raw counts.
const er = (mentioned: boolean, comps: string[]) => ({ engine: "chatgpt", text: "", citations: [], analysis: { mentioned, competitorsMentioned: comps } }) as any;
const result: any = {
  totalQueries: 15, auditedAt: "2026-11-21T08:00:00Z",
  summary: { visibilityScorePercent: 20, totalMentions: 3, mentionsByEngine: { chatgpt: 1, gemini: 2, perplexity: 0 }, competitorMentions: { Panchkula: 12, Mohali: 11, Implants: 11, "The Smile Designers": 4 }, citationDomains: { "practo.com": 5 } },
  results: [
    { prompt: "Best dental clinic in Chandigarh Tricity", engineResults: { chatgpt: er(true, ["Panchkula"]), gemini: er(false, []) } },
    { prompt: "Which dental clinic in Chandigarh Tricity should I trust", engineResults: { chatgpt: er(false, ["Mohali", "The Smile Designers"]), gemini: er(false, ["Panchkula"]) } },
  ],
};
const s = summarizeAudit(result, chd);
assert.deepEqual(s.top_competitors, ["The Smile Designers"]);
assert.deepEqual(s.competitor_mentions, { "The Smile Designers": 4 });
assert.equal(s.weakest_query, "Which dental clinic in Chandigarh Tricity should I trust");
assert.equal(s.weakest_competitor, "The Smile Designers");
assert.deepEqual(weakestQuery({ ...result, results: [result.results[0]] }, () => true), {}, "named somewhere in every question: none");

// Rendering.
const set = loadTemplates(resolveTemplatesDir(process.env));
const ctx = (audit: AuditSummary) => ({ company: chd.company, city: chd.city, category: "cosmetic_dental", decisionMakerName: "Dr. Vivek Bhalla", audit, senderName: "Tejinder Singh", bookingLink: "https://x.test/book" });
const stored: AuditSummary = { visibility_percent: 20, mentions: 3, total_queries: 15, mentions_by_engine: {}, top_competitors: ["Panchkula", "Mohali", "Implants"], competitor_mentions: { Panchkula: 12 }, top_cited_domains: [], audited_at: "2026-11-21T08:00:02Z" };
const t1old = renderFromTemplates(set, 1, "Email", ctx(stored));
assert.doesNotMatch(t1old.text, /Panchkula/, "an audit stored before the fix is filtered at render time");
assert.match(t1old.text, /was named in 3 of 15 answers\.\n/);
const t3old = renderFromTemplates(set, 3, "Email", ctx(stored));
assert.doesNotMatch(t3old.text, /Panchkula|fix first/);
const t4old = renderFromTemplates(set, 4, "Email", ctx(stored));
assert.match(t4old.text, /one line from the report: Chandigarh Dental Clinic was named in 3 of 15 answers\. Want/);

const t1 = renderFromTemplates(set, 1, "Email", ctx(s));
assert.match(t1.text, /named in 3 of 15 answers\. The Smile Designers was named in 4\./);
const t3 = renderFromTemplates(set, 3, "Email", ctx(s));
assert.match(t3.text, /The one I would fix first: "Which dental clinic in Chandigarh Tricity should I trust"\. The Smile Designers is named there and Chandigarh Dental Clinic is not\./);
const noComp = renderFromTemplates(set, 3, "Email", ctx({ ...s, top_competitors: [], competitor_mentions: undefined, weakest_competitor: undefined }));
assert.match(noComp.text, /No engine named Chandigarh Dental Clinic there\./);
const twelve = renderFromTemplates(set, 1, "Email", ctx({ ...s, total_queries: 10 }));
assert.match(twelve.subject!, /in 3 of 10 AI answers/, "the real number of answers, not 15");
console.log("test-outreach-competitors: all checks passed");
