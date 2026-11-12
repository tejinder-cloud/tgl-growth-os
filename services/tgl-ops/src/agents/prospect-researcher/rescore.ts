// services/tgl-ops/src/agents/prospect-researcher/rescore.ts
// The re-score logic behind rescoreProspects (worker.ts), kept free of Supabase and Slack so it can be tested.
// Issue #184 (rubric v2 fixes):
// - A generic brand prefix ("dr.") is replaced by a distinctive token and the chain signals that rested on it are removed.
// - is_large_org is re-derived with assessLargeOrg (category / name / reviews / a REAL multi-branch signal) and the reason stored.
// - The stored Dimension 4 probe answer is re-read with the current logic (brand-token prospect_named). No engine call, no spend.
// - Dimension 5 re-checks the email domain against the website root domain; decision_maker.verified is stored.
// - The large-org cap reason is stored on the signals.
// Never writes to decisions/ or logs/. Never contacts a prospect.
import type { ProspectRecord, ProspectStatus } from "./types.js";
import { evaluateProspectRubric, checkPlaybookCDisqualification } from "./rubric.js";
import { parseDim4Probe, reanalyseDim4Probe } from "./dim4.js";
import { assessLargeOrg, sanitizeGenericBrandSignals } from "./brand.js";
import { FIT_BENCH_FLOOR } from "./threshold.js";
import { extractBrandToken } from "./sources/website-scraper.js";

export interface RescoreRowSummary {
  id?: string;
  company: string;
  scoreBefore: number;
  scoreAfter: number;
  statusBefore: ProspectStatus;
  statusAfter: ProspectStatus;
  /** Plain-text notes on what the v2 fixes changed for this row. */
  notes: string[];
}

export interface RescoreRowsResult {
  records: ProspectRecord[];
  disqualifiedChains: string[];
  summaries: RescoreRowSummary[];
}

/** True when a row id starts with any of the supplied ids (8-character prefixes such as "eecc9010" are accepted). */
export function rowMatchesIds(p: ProspectRecord, ids: string[]): boolean {
  const id = (p.id || "").toLowerCase();
  return !!id && ids.some((i) => i.trim() !== "" && id.startsWith(i.trim().toLowerCase()));
}

export function rescoreRows(
  all: ProspectRecord[],
  options?: { ids?: string[]; now?: () => Date }
): RescoreRowsResult {
  const now = options?.now ?? (() => new Date());
  const ids = (options?.ids || []).filter((i) => i.trim() !== "");
  const rows = ids.length > 0 ? all.filter((p) => rowMatchesIds(p, ids)) : all;

  const disqualifiedChains: string[] = [];
  const records: ProspectRecord[] = [];
  const summaries: RescoreRowSummary[] = [];

  for (const original of rows) {
    const p: ProspectRecord = { ...original, signals: { ...original.signals }, decision_maker: { ...original.decision_maker } };
    const notes: string[] = [];
    const scoreBefore = p.fit_score;
    const statusBefore = p.status;

    // 1. Drop chain signals that rested on a generic brand prefix ("dr.") already stored on the row.
    const storedClean = sanitizeGenericBrandSignals(p.signals, p.company);
    p.signals = storedClean.signals;
    notes.push(...storedClean.removed);

    // 2. Re-evaluate the brand token and root domain; a newly derived generic prefix is cleaned the same way.
    const { brand } = extractBrandToken(p.company, p.website);
    p.signals.brand_prefix = brand;
    const derivedClean = sanitizeGenericBrandSignals(p.signals, p.company);
    p.signals = derivedClean.signals;
    notes.push(...derivedClean.removed);

    // 3. Generic Chain Rule (Playbook C): 3+ Places locations, root domain hosting branches, or HQ in another metro.
    const chainCheck = checkPlaybookCDisqualification(p.company, p.website, p.signals, p.city);
    if (chainCheck.disqualified && chainCheck.reason) {
      p.signals.chain_evidence = p.signals.chain_evidence || [];
      if (!p.signals.chain_evidence.includes(chainCheck.reason)) {
        p.signals.chain_evidence.push(chainCheck.reason);
      }
    }

    // 4. Organisation size and DM role. Not set from a generic brand prefix; the reason is stored.
    const wasLarge = Boolean(original.signals.is_large_org);
    const largeOrg = assessLargeOrg({
      name: p.company,
      category: p.category,
      userRatingsTotal: p.signals.gbp_reviews,
      placesBrandCount: p.signals.places_brand_count,
      brandPrefix: p.signals.brand_prefix,
      signals: p.signals,
    });
    p.signals.is_large_org = largeOrg.isLarge;
    p.signals.is_large_org_reason = largeOrg.reason;
    if (wasLarge !== largeOrg.isLarge) {
      notes.push(`is_large_org ${wasLarge} -> ${largeOrg.isLarge}${largeOrg.reason ? ` (${largeOrg.reason})` : ""}`);
    }

    // 5. Rubric v2. Dimension 4 is the stored probe answer, re-read with the current prospect_named logic.
    const storedProbe = parseDim4Probe(p.fit_reasons);
    const probe = storedProbe
      ? reanalyseDim4Probe(storedProbe, { company: p.company, domain: p.website, brandPrefix: p.signals.brand_prefix })
      : null;
    if (storedProbe && probe && (storedProbe.prospect_named !== probe.prospect_named || storedProbe.score !== probe.score)) {
      notes.push(
        `Dim 4 re-read: prospect_named ${storedProbe.prospect_named} -> ${probe.prospect_named}, probe score ${storedProbe.score} -> ${probe.score}`
      );
    }

    const evalRes = evaluateProspectRubric({
      company: p.company,
      domain: p.website,
      category: p.category,
      city: p.city,
      signals: p.signals,
      decisionMaker: p.decision_maker,
      dim4Probe: probe,
    });
    if (evalRes.decisionMaker) p.decision_maker = evalRes.decisionMaker;
    if (evalRes.signals) p.signals = evalRes.signals;
    if (evalRes.largeOrgCapReason) notes.push(evalRes.largeOrgCapReason);
    if (p.decision_maker.verified === false && p.decision_maker.email) {
      notes.push(`decision_maker.verified=false for ${p.decision_maker.email}`);
    }

    const wasBenched = p.status === "bench" || p.status === "nurture";

    if (evalRes.disqualified) {
      p.fit_score = 0;
      p.status = "rejected";
      p.fit_reasons = evalRes.fitReasons;
      disqualifiedChains.push(`${p.company} (${evalRes.disqualificationReason || "Chain disqualified"})`);
    } else if (!probe) {
      console.log(`[Rescore Notice] '${p.company}' has no Dimension 4 probe yet: score and status unchanged (${p.fit_score}, ${p.status}).`);
    } else {
      p.fit_score = evalRes.fitScore;
      p.fit_reasons = evalRes.fitReasons;
      if (evalRes.qualified) {
        if (wasBenched) {
          p.status = "new";
        } else {
          p.status = p.status === "handed_to_outreach" ? "handed_to_outreach" : "reviewed";
        }
      } else if (wasBenched && evalRes.fitScore >= FIT_BENCH_FLOOR) {
        p.status = "bench";
      } else {
        p.status = "rejected";
      }
    }

    p.rescored_at = now().toISOString();
    records.push(p);
    summaries.push({
      id: p.id,
      company: p.company,
      scoreBefore,
      scoreAfter: p.fit_score,
      statusBefore,
      statusAfter: p.status,
      notes,
    });
  }

  return { records, disqualifiedChains, summaries };
}
