// services/tgl-ops/src/agents/prospect-researcher/dedupe.ts
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import type { ProspectRecord } from "./types.js";

const GHL_API_KEY = process.env.GHL_API_KEY || "";
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || "";

export interface DedupeResult {
  isDuplicate: boolean;
  reason?: string;
}

export interface RejectionAnalysis {
  totalRejections: number;
  frequentCauses: { cause: string; count: number }[];
  proposedRubricAdjustment?: string;
}

/**
 * Normalizes website domain to a clean comparable string:
 * e.g. "https://www.maxhealthcare.in/delhi/" -> "maxhealthcare.in"
 */
export function normalizeDomain(url: string): string {
  if (!url) return "";
  try {
    let clean = url.trim().toLowerCase();
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = `https://${clean}`;
    }
    const parsed = new URL(clean);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0].toLowerCase().trim();
  }
}

/**
 * Checks a prospect against existing Supabase/local prospects, GHL, and rejections/*.md.
 */
export async function isProspectDuplicate(
  candidate: { company: string; website: string; email?: string; phone?: string },
  existingProspects: ProspectRecord[],
  options?: { testMode?: boolean }
): Promise<DedupeResult> {
  const normCandidateDomain = normalizeDomain(candidate.website);
  const normCompany = candidate.company.toLowerCase().trim();

  // 1. Check against existing prospects in Supabase / state
  for (const p of existingProspects) {
    if (p.deleted_at) continue;

    if (normCandidateDomain && normalizeDomain(p.website) === normCandidateDomain) {
      return { isDuplicate: true, reason: `Domain '${normCandidateDomain}' already exists in Supabase prospects (id: ${p.id || p.company})` };
    }

    if (p.company.toLowerCase().trim() === normCompany) {
      return { isDuplicate: true, reason: `Company name '${p.company}' already exists in prospects` };
    }

    if (candidate.email && p.decision_maker.email && p.decision_maker.email.toLowerCase() === candidate.email.toLowerCase()) {
      return { isDuplicate: true, reason: `Decision-maker email '${candidate.email}' already exists in prospects` };
    }
  }

  // 2. Check GoHighLevel (GHL) if credentials configured
  if (GHL_API_KEY && GHL_LOCATION_ID && !options?.testMode) {
    try {
      if (candidate.email) {
        const emailSearchUrl = `https://rest.gohighlevel.com/v1/contacts/lookup?email=${encodeURIComponent(candidate.email)}`;
        const ghlRes = await fetch(emailSearchUrl, {
          headers: { Authorization: `Bearer ${GHL_API_KEY}` },
        });
        if (ghlRes.ok) {
          const ghlData = (await ghlRes.json()) as any;
          if (ghlData.contacts && ghlData.contacts.length > 0) {
            return { isDuplicate: true, reason: `Contact email '${candidate.email}' already exists in GoHighLevel CRM` };
          }
        }
      }
    } catch (err: any) {
      console.warn(`[GHL Dedupe Lookup Warning]:`, err.message);
    }
  }

  // 3. Check repository rejections/
  const rejectionsDir = path.join(config.repoRoot, "rejections");
  if (fs.existsSync(rejectionsDir)) {
    const files = fs.readdirSync(rejectionsDir).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(rejectionsDir, f), "utf8").toLowerCase();
        if (normCandidateDomain && content.includes(normCandidateDomain)) {
          return { isDuplicate: true, reason: `Domain '${normCandidateDomain}' was previously rejected in rejections/${f}` };
        }
        if (content.includes(normCompany)) {
          return { isDuplicate: true, reason: `Company '${candidate.company}' was previously rejected in rejections/${f}` };
        }
      } catch {
        // continue
      }
    }
  }

  return { isDuplicate: false };
}

/**
 * Analyzes repository rejections/*.md for repeated failure causes.
 * If 3 or more rejections share a common cause, drafts a rubric adjustment proposal for the card thread.
 */
export function analyzeRejectionPatterns(): RejectionAnalysis {
  const rejectionsDir = path.join(config.repoRoot, "rejections");
  if (!fs.existsSync(rejectionsDir)) {
    return { totalRejections: 0, frequentCauses: [] };
  }

  const causeCounts: Record<string, number> = {};
  let totalRejections = 0;

  const files = fs.readdirSync(rejectionsDir).filter((f) => f.endsWith(".md"));
  for (const f of files) {
    try {
      const lines = fs.readFileSync(path.join(rejectionsDir, f), "utf8").split("\n");
      for (const line of lines) {
        if (line.includes("REJECT") || line.includes("Reason:")) {
          totalRejections++;
          const lower = line.toLowerCase();
          if (lower.includes("franchise") || lower.includes("corporate hq")) {
            causeCounts["Centralized Franchise / Corporate HQ"] = (causeCounts["Centralized Franchise / Corporate HQ"] || 0) + 1;
          } else if (lower.includes("agency") || lower.includes("footer")) {
            causeCounts["Agency Lock-in in Footer"] = (causeCounts["Agency Lock-in in Footer"] || 0) + 1;
          } else if (lower.includes("budget") || lower.includes("no ads")) {
            causeCounts["Insufficient Active Paid Ad Spend"] = (causeCounts["Insufficient Active Paid Ad Spend"] || 0) + 1;
          } else if (lower.includes("rating") || lower.includes("reputation")) {
            causeCounts["Low Google Rating / Poor Reputation"] = (causeCounts["Low Google Rating / Poor Reputation"] || 0) + 1;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const frequentCauses = Object.entries(causeCounts)
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count);

  let proposedRubricAdjustment: string | undefined;
  const recurring = frequentCauses.find((c) => c.count >= 3);
  if (recurring) {
    proposedRubricAdjustment = `💡 *[Rubric Change Proposal]* Observed ${recurring.count} recent rejections citing "${recurring.cause}". Propose penalizing this signal with -15 pts in Dimension 3 or moving to explicit Playbook C disqualification to stop junior candidates early. (Awaiting Architect decision in thread).`;
  }

  return {
    totalRejections,
    frequentCauses,
    proposedRubricAdjustment,
  };
}
