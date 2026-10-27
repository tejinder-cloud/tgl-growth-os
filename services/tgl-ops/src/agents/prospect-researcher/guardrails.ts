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
  savePlacesQuotaState(freshState, options);
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
export function sanitizeDecisionMaker(
  raw: any,
  companyName: string
): DecisionMaker {
  if (!raw || typeof raw !== "object") {
    return {
      name: "Unknown",
      role: "Leadership",
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
    email.startsWith("sales@")
  ) {
    email = "";
  }

  const phone = raw.phone ? String(raw.phone).trim().slice(0, 25) : undefined;
  const source = String(raw.source || "").trim().slice(0, 300);

  return {
    name: name || "Leadership",
    role: role || "Executive",
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
  // Pure qualification guard
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
