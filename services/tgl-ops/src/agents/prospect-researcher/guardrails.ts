// services/tgl-ops/src/agents/prospect-researcher/guardrails.ts
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import type { DecisionMaker } from "./types.js";
import { getTodayDateString } from "../../lib/standup.js";
import { FIT_QUALIFIED_THRESHOLD } from "./threshold.js";

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
export function isRolePlaceholderName(name: string, isOwnerRun?: boolean): boolean {
  if (!name || typeof name !== "string") return true;
  const rawTrimmed = name.trim();
  // Allowed explicit markers: DM unknown for Playbook D, and owner/doctor for owner-run clinics
  if (
    rawTrimmed === "DM unknown" ||
    rawTrimmed === "Contact found, DM unknown" ||
    (isOwnerRun &&
      (rawTrimmed === "Owner / Lead Doctor" ||
        rawTrimmed === "Lead Doctor / Clinic Owner" ||
        rawTrimmed === "Owner / Doctor"))
  ) {
    return false;
  }

  const clean = rawTrimmed.toLowerCase().replace(/[^a-z\s]/g, " ");
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
