// services/tgl-ops/src/agents/aeo-audit-engine/next-steps.ts
// Builds the "Mechanistic next steps" text for the short-form audit PDF from the audit matrix ONLY.
// Every sentence is derived from counts in the matrix. There are no fixed advice phrases and no fallback
// names: when a count is zero the text says so plainly instead of inventing a competitor or a recommendation.

import type { EngineId } from "./types.js";
import type { PromptAuditResult, ShortFormAuditResult, MatrixNextSteps } from "./short-form.js";

const ENGINE_LABEL: Record<EngineId, string> = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", claude: "Claude" };

function engineLabel(engine: string): string {
  return ENGINE_LABEL[engine as EngineId] || engine;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function shortenPrompt(text: string, max = 70): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3).trim()}...` : t;
}

/**
 * Generates next steps strictly from the matrix (per-prompt, per-engine analysis):
 * - engines with zero mentions of the brand (named, or none stated plainly)
 * - the competitor named in the most answers, if any (or a plain statement that none was named)
 * - the two weakest queries (fewest engines naming the brand, then the worst best-position)
 */
export function generateMatrixNextSteps(
  results: PromptAuditResult[],
  _summary: ShortFormAuditResult["summary"] | undefined,
  brandName: string,
  /** Plain wording for a prospect's PDF: "questions" and "assistants", no analyst terms. Same counts either way. */
  plain = false
): MatrixNextSteps {
  // Engines actually present in the matrix.
  const engines: string[] = [];
  for (const r of results) {
    for (const eng of Object.keys(r.engineResults)) {
      if (!engines.includes(eng)) engines.push(eng);
    }
  }

  const promptCount = results.length;
  const totalAnswers = results.reduce((n, r) => n + Object.keys(r.engineResults).length, 0);

  // Mentions per engine and overall, counted from the matrix.
  const mentionsByEngine: Record<string, number> = {};
  for (const eng of engines) mentionsByEngine[eng] = 0;
  let totalMentions = 0;
  for (const r of results) {
    for (const [eng, er] of Object.entries(r.engineResults)) {
      if (er.analysis.mentioned) {
        mentionsByEngine[eng] = (mentionsByEngine[eng] || 0) + 1;
        totalMentions++;
      }
    }
  }
  const scorePct = totalAnswers > 0 ? Number(((totalMentions / totalAnswers) * 100).toFixed(1)) : 0;

  const engineEntries = engines
    .map((e) => [e, mentionsByEngine[e]] as [string, number])
    .sort((a, b) => a[1] - b[1]);
  const weakest = engineEntries[0] || ["", 0];
  const weakestEngineName = weakest[0] ? engineLabel(weakest[0]) : "";
  const zeroMentionEngines = engineEntries.filter(([, n]) => n === 0).map(([e]) => engineLabel(e));

  // Queries where the brand is absent on some engine or outranked.
  const queriesLost: number[] = [];
  for (const r of results) {
    const lost = Object.values(r.engineResults).some(
      (er) => !er.analysis.mentioned || (er.analysis.position !== null && er.analysis.position > 1)
    );
    if (lost) queriesLost.push(r.promptIndex);
  }

  // Competitor named in the most answers (unique per answer).
  const competitorCounts: Record<string, number> = {};
  for (const r of results) {
    for (const er of Object.values(r.engineResults)) {
      for (const comp of new Set(er.analysis.competitorsMentioned || [])) {
        competitorCounts[comp] = (competitorCounts[comp] || 0) + 1;
      }
    }
  }
  const sortedComps = Object.entries(competitorCounts).sort((a, b) => b[1] - a[1]);
  const winningCompetitor = sortedComps[0] ? sortedComps[0][0] : "";
  const winningCompetitorCount = sortedComps[0] ? sortedComps[0][1] : 0;

  // Most-cited domain that is not the brand's own, from the matrix (empty when nothing was cited).
  const citationCounts: Record<string, number> = {};
  for (const r of results) {
    for (const er of Object.values(r.engineResults)) {
      for (const dom of new Set((er.citations || []).map((c) => c.domain))) {
        citationCounts[dom] = (citationCounts[dom] || 0) + 1;
      }
    }
  }
  const topCitationGap =
    Object.entries(citationCounts)
      .filter(([dom]) => !dom.includes("thegrowthlab"))
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  // Two weakest queries: fewest engines naming the brand; ties broken by the worst best-position.
  const queryStats = results.map((r) => {
    const ers = Object.values(r.engineResults);
    const named = ers.filter((er) => er.analysis.mentioned);
    const bestPosition = named.reduce(
      (best, er) => Math.min(best, er.analysis.position ?? 99),
      Number.POSITIVE_INFINITY
    );
    return {
      promptIndex: r.promptIndex,
      prompt: r.prompt,
      namedBy: named.length,
      engineCount: ers.length,
      bestPosition,
    };
  });
  const weakestQueryStats = [...queryStats]
    .sort((a, b) => {
      if (a.namedBy !== b.namedBy) return a.namedBy - b.namedBy;
      if (a.bestPosition !== b.bestPosition) return b.bestPosition - a.bestPosition;
      return a.promptIndex - b.promptIndex;
    })
    .slice(0, 2);
  const weakestQueries = weakestQueryStats.map((q) => q.promptIndex);

  // Text: every clause is a count from the matrix.
  const sentences: string[] = [];
  sentences.push(`${brandName} was named in ${totalMentions} of ${totalAnswers} answers (${scorePct}%).`);

  const promptWord = plain ? "questions" : "prompts";
  if (promptCount > 0) {
    if (zeroMentionEngines.length > 0) {
      sentences.push(
        `${joinList(zeroMentionEngines)} did not name ${brandName} in any of the ${promptCount} ${promptWord}.`
      );
    } else if (weakestEngineName) {
      sentences.push(
        plain
          ? `Every assistant named ${brandName} at least once; ${weakestEngineName} did so least, in ${weakest[1]} of ${promptCount} questions.`
          : `Every engine named ${brandName} at least once; ${weakestEngineName} was the weakest, naming it in ${weakest[1]} of ${promptCount} prompts.`
      );
    }
  }

  if (winningCompetitor) {
    sentences.push(
      plain
        ? `${winningCompetitor} was named most often instead, in ${winningCompetitorCount} of ${totalAnswers} answers.`
        : `${winningCompetitor} was the competitor named most often, in ${winningCompetitorCount} of ${totalAnswers} answers.`
    );
  } else {
    sentences.push(plain ? `No other business was named in any of the ${totalAnswers} answers.` : `No competitor was named in any of the ${totalAnswers} answers.`);
  }

  if (weakestQueryStats.length > 0) {
    const parts = weakestQueryStats.map((q) =>
      plain
        ? `"${shortenPrompt(q.prompt)}" (${q.namedBy} of ${q.engineCount} assistants named ${brandName})`
        : `Q${q.promptIndex} "${shortenPrompt(q.prompt)}" (${q.namedBy} of ${q.engineCount} engines named ${brandName})`
    );
    sentences.push(plain ? `The questions where ${brandName} did worst: ${parts.join("; ")}.` : `Weakest queries: ${parts.join("; ")}.`);
  }

  return {
    weakestEngine: weakestEngineName,
    weakestEngineMentions: weakest[1],
    zeroMentionEngines,
    queriesLost,
    weakestQueries,
    winningCompetitor,
    winningCompetitorCount,
    topCitationGap,
    formattedText: sentences.join(" "),
  };
}
