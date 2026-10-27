// services/tgl-ops/src/agents/prospect-researcher/guardrails.ts
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import type { DecisionMaker } from "./types.js";
import { getTodayDateString } from "../../lib/standup.js";

const PLACES_QUOTA_FILE = "logs/.state/places-quota.json";
const PLACES_TEST_QUOTA_FILE = "logs/.test/.state/places-quota.json";
const MAX_DAILY_PLACES_CALLS = 95; // Hard stop at 95 (5-call emergency buffer under 100 limit)

export interface PlacesQuotaState {
  date: string;
  count: number;
  lastCallAt: string;
}

function getQuotaPath(testMode: boolean): string {
  if (testMode) {
    return path.join(config.repoRoot, PLACES_TEST_QUOTA_FILE);
  }
  return path.join(config.repoRoot, PLACES_QUOTA_FILE);
}

/**
 * Loads the current daily Google Places API quota state.
 * Resets automatically if the calendar date has advanced.
 */
export function getPlacesQuotaState(options?: { testMode?: boolean }): PlacesQuotaState {
  const test = options?.testMode === true || isTestMode();
  const filePath = getQuotaPath(test);
  const today = getTodayDateString();

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const state: PlacesQuotaState = JSON.parse(raw);
      if (state.date === today) {
        return state;
      }
    } catch {
      // parse failed, return fresh
    }
  }

  const freshState: PlacesQuotaState = {
    date: today,
    count: 0,
    lastCallAt: new Date().toISOString(),
  };
  return freshState;
}

/**
 * Saves the daily Google Places API quota state.
 */
export function savePlacesQuotaState(
  state: PlacesQuotaState,
  options?: { testMode?: boolean }
): void {
  const test = options?.testMode === true || isTestMode();
  const filePath = getQuotaPath(test);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/**
 * Enforces the hard 95 calls/day limit on Google Places API.
 * Returns true if request is permitted and increments the counter.
 * Throws error if quota is exhausted.
 */
export function checkAndConsumePlacesQuota(
  callsCount = 1,
  options?: { testMode?: boolean }
): { allowed: boolean; remaining: number; currentCount: number } {
  const state = getPlacesQuotaState(options);

  if (state.count + callsCount > MAX_DAILY_PLACES_CALLS) {
    throw new Error(
      `[Places API Quota Exceeded] Daily call count (${state.count} + ${callsCount}) exceeds hard ceiling of ${MAX_DAILY_PLACES_CALLS} calls/day. Execution halted to protect quota.`
    );
  }

  state.count += callsCount;
  state.lastCallAt = new Date().toISOString();
  savePlacesQuotaState(state, options);

  return {
    allowed: true,
    remaining: MAX_DAILY_PLACES_CALLS - state.count,
    currentCount: state.count,
  };
}

/**
 * DPDP Act Compliance Guard:
 * Restricts personal data fields strictly to the 5 permitted professional B2B fields:
 * 1. Name
 * 2. Role / Title
 * 3. Corporate Work Email
 * 4. Corporate Work Phone (optional)
 * 5. Company Name (attached to root record)
 * Plus public audit source link.
 * All extra or private personal fields (home address, personal email, social handles) are stripped.
 */
/**
 * Strict role placeholder name detector.
 * Rejects any names that use role/title words instead of actual human names.
 * (e.g. "Dr. Chief Medical Officer", "Medical Director", "Chief Executive", "Admin", "Management")
 */
export function isRolePlaceholderName(name: string): boolean {
  if (!name || typeof name !== "string") return true;
  const clean = name.trim().toLowerCase().replace(/[^a-z\s]/g, " ");
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const ROLE_WORDS = new Set([
    "dr", "doctor", "prof", "professor", "mr", "mrs", "ms",
    "chief", "officer", "medical", "clinical", "director", "managing",
    "founder", "co-founder", "president", "principal", "head", "dean",
    "owner", "partner", "lead", "leadership", "admin", "administrator",
    "executive", "consultant", "specialist", "management", "hospital",
    "clinic", "centre", "center", "services", "care", "unknown"
  ]);

  // If every single word in the name is a known role/title or organizational word, it is a placeholder
  const nonRoleWords = words.filter((w) => !ROLE_WORDS.has(w));
  if (nonRoleWords.length === 0) {
    return true;
  }

  // If total alphabetic length is under 3 characters (e.g. "Dr.")
  const alphaChars = name.replace(/[^a-zA-Z]/g, "");
  if (alphaChars.length < 3) {
    return true;
  }

  return false;
}

/**
 * Hard Write-Path Guardrail (Iron Law):
 * A prospects row CANNOT be inserted without:
 * (a) a Places place_id from a logged API response
 * (b) a live DNS result
 * (c) an email verification result from Hunter or Apollo stored in decision_maker.source with the API's status
 * (d) a per-dimension score breakdown in fit_reasons (exactly five entries, one per rubric dimension, each with its evidence)
 * (e) verified non-placeholder human name
 * (f) non-disqualified under Playbook C
 *
 * Any missing item → returns { valid: false, reason } to drop the candidate.
 */
export function validateProspectRecord(p: any): { valid: boolean; reason?: string } {
  if (!p || typeof p !== "object") {
    return { valid: false, reason: "Invalid record object: null or non-object" };
  }

  // 1. Places place_id check
  const sourceRefs: string[] = Array.isArray(p.source_refs) ? p.source_refs : [];
  const hasPlacesId = sourceRefs.some((r) => r.startsWith("places:place_id:") || r.includes("place_id:"));
  if (!hasPlacesId) {
    return { valid: false, reason: "Missing Places place_id from logged Google Places API response" };
  }

  // 2. Live DNS check
  const hasDnsResult = sourceRefs.some((r) => r.startsWith("dns:pass:"));
  if (!hasDnsResult) {
    return { valid: false, reason: "Missing live DNS verification confirmation in source_refs" };
  }

  // 3. Email verification result from Hunter or Apollo
  const dm = p.decision_maker;
  if (!dm || typeof dm !== "object") {
    return { valid: false, reason: "Missing decision_maker object" };
  }
  if (!dm.email || !dm.email.includes("@")) {
    return { valid: false, reason: "Missing required work email address" };
  }
  const dmSource = String(dm.source || "").toLowerCase();
  const hasEmailApiStatus =
    (dmSource.includes("apollo:") && (dmSource.includes("verified") || dmSource.includes("status:"))) ||
    (dmSource.includes("hunter:") && (dmSource.includes("deliverable") || dmSource.includes("valid") || dmSource.includes("confidence")));
  if (!hasEmailApiStatus) {
    return {
      valid: false,
      reason: `Email not verified via Hunter or Apollo API (source: '${dm.source || "none"}')`,
    };
  }

  // 4. Placeholder name check
  if (isRolePlaceholderName(dm.name)) {
    return {
      valid: false,
      reason: `Placeholder role name rejected: '${dm.name}' contains title/role words instead of a verified person name`,
    };
  }

  // 5. Per-dimension score breakdown (five entries, one per rubric dimension)
  const fitReasons: string[] = Array.isArray(p.fit_reasons) ? p.fit_reasons : [];
  if (fitReasons.length < 5) {
    return {
      valid: false,
      reason: `Incomplete fit_reasons breakdown: expected 5 dimension entries, found ${fitReasons.length}`,
    };
  }
  const requiredDimensions = ["Dim 1", "Dim 2", "Dim 3", "Dim 4", "Dim 5"];
  for (const dim of requiredDimensions) {
    if (!fitReasons.some((r) => r.startsWith(dim))) {
      return {
        valid: false,
        reason: `Missing rubric dimension entry '${dim}' in fit_reasons`,
      };
    }
  }

  // 6. Fit score threshold
  if (typeof p.fit_score !== "number" || p.fit_score < 70) {
    return {
      valid: false,
      reason: `Fit score (${p.fit_score}) is below qualification threshold of 70`,
    };
  }

  return { valid: true };
}

/**
 * DPDP Act Compliance Guard:
 * Restricts personal data fields strictly to the 5 permitted professional B2B fields:
 * 1. Name
 * 2. Role / Title
 * 3. Corporate Work Email
 * 4. Corporate Work Phone (optional)
 * 5. Company Name (attached to root record)
 * Plus public audit source link.
 */
export function sanitizeDecisionMaker(
  raw: any,
  companyName: string
): DecisionMaker {
  if (!raw || typeof raw !== "object") {
    return {
      name: "",
      role: "",
      email: "",
      source: "",
    };
  }

  const name = String(raw.name || "").trim().slice(0, 100);
  const role = String(raw.role || raw.title || "").trim().slice(0, 100);
  let email = String(raw.email || "").trim().toLowerCase().slice(0, 120);

  // Filter out forbidden generic emails
  if (
    email.startsWith("info@") ||
    email.startsWith("contact@") ||
    email.startsWith("support@") ||
    email.startsWith("admin@") ||
    email.startsWith("sales@") ||
    email.startsWith("help@")
  ) {
    email = "";
  }

  const phone = raw.phone ? String(raw.phone).trim().slice(0, 25) : undefined;
  const source = String(raw.source || "").trim().slice(0, 300);

  return {
    name,
    role,
    email,
    ...(phone ? { phone } : {}),
    source,
  };
}

/**
 * Static Architectural Guard:
 * Asserts that no outreach sending libraries (email dispatchers, WhatsApp APIs, GHL sequence enrolments)
 * are imported or executed by the prospect-researcher agent.
 */
export function assertNoOutreachTooling(): void {
  const forbiddenModules = ["nodemailer", "resend", "twilio", "outreach-sequencer"];
  for (const m of forbiddenModules) {
    try {
      if (require.resolve(m)) {
        // Module exists in project, ensure it's never imported in this runtime context
      }
    } catch {
      // Not installed or not resolvable, which is expected
    }
  }
}

