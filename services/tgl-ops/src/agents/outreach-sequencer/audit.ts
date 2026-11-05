// services/tgl-ops/src/agents/outreach-sequencer/audit.ts
// Adapter from the short-form audit engine to the sequencer's AuditOutcome.
// Real prospects: runShortFormAudit refuses unless a verified brand setup profile exists for the domain
// (Iron Law of Honesty); the sequencer then holds touch 2 rather than sending without a one-pager.
// Fixture: mock engine answers, labelled as fixture everywhere it is used.
import type { ProspectRecord } from "../prospect-researcher/types.js";
import { runShortFormAudit, type ShortFormAuditResult } from "../aeo-audit-engine/short-form.js";
import { generateAuditPdf } from "../aeo-audit-engine/pdf.js";
import type { AuditOutcome } from "./types.js";

function toVars(r: ShortFormAuditResult) {
  return {
    audit_date: r.auditedAt.slice(0, 10),
    visibility_score: String(r.summary.visibilityScorePercent),
    mentions: String(r.summary.totalMentions),
    total_queries: String(r.totalQueries),
    weakest_engine: r.nextSteps.weakestEngine,
    winning_competitor: r.nextSteps.winningCompetitor,
    top_citation_gap: r.nextSteps.topCitationGap,
  };
}

function safeName(website: string): string {
  return website.toLowerCase().replace(/[^a-z0-9.-]/g, "_");
}

export async function runAuditForProspect(prospect: ProspectRecord, opts: { fixture: boolean }): Promise<AuditOutcome> {
  let result: ShortFormAuditResult;
  if (opts.fixture) {
    const profile: any = {
      name: prospect.company,
      primaryDomain: prospect.website,
      domains: [prospect.website],
      variants: [prospect.company],
      competitors: [
        { name: "Fixture Competitor One", domain: "fixture-one.example" },
        { name: "Fixture Competitor Two", domain: "fixture-two.example" },
        { name: "Fixture Competitor Three", domain: "fixture-three.example" },
        { name: "Fixture Competitor Four", domain: "fixture-four.example" },
      ],
      prompts: [1, 2, 3, 4, 5].map((n) => ({ text: `Fixture buyer question ${n} for ${prospect.category}`, journey_phase: "consideration" })),
      market: { product: prospect.category },
      setupStatus: "verified",
      setupVerifiedAt: new Date().toISOString(),
      setupVerifiedBy: "fixture",
    };
    result = await runShortFormAudit(profile, { testMode: true, saveRawJson: false });
  } else {
    result = await runShortFormAudit(
      { name: prospect.company, domains: [prospect.website], variants: [prospect.company], competitors: [] } as any,
      { saveRawJson: true }
    );
  }
  const pdf = await generateAuditPdf(result);
  return {
    vars: toVars(result),
    pdf: { buffer: pdf.buffer, sizeBytes: pdf.sizeBytes, filename: `AI-visibility-audit-${safeName(prospect.website)}.pdf` },
    rawPath: result.rawAnswersJsonPath,
    fixture: opts.fixture,
  };
}
