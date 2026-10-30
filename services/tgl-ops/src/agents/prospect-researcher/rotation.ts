// services/tgl-ops/src/agents/prospect-researcher/rotation.ts
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import type { RotationCity, RotationCategory, RotationState } from "./types.js";
import { putFileInRepo } from "../../lib/github-client.js";

export const ROTATION_CITIES: RotationCity[] = [
  "Delhi NCR",
  "Mumbai",
  "Bengaluru",
  "Hyderabad",
  "Chandigarh Tricity",
];

export const ROTATION_CATEGORIES: RotationCategory[] = [
  "hospitals",
  "cosmetic_dental",
  "ivf_fertility",
  "high_ticket_coaching",
];

const ROTATION_STATE_FILE = "logs/.state/prospect-rotation.json";
const ROTATION_TEST_STATE_FILE = "logs/.test/.state/prospect-rotation.json";

function getRotationFilePath(testMode: boolean): string {
  if (testMode) {
    return path.join(config.repoRoot, ROTATION_TEST_STATE_FILE);
  }
  return path.join(config.repoRoot, ROTATION_STATE_FILE);
}

export function loadRotationState(options?: { testMode?: boolean }): RotationState {
  const test = options?.testMode === true || isTestMode();
  const filePath = getRotationFilePath(test);

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      // fallback
    }
  }

  const fresh: RotationState = {
    version: 1,
    currentCityIndex: 0,
    currentCategoryIndex: 0,
    completedRunsCount: 0,
    lastRunAt: new Date().toISOString(),
  };
  return fresh;
}

export function saveRotationState(
  state: RotationState,
  options?: { testMode?: boolean }
): void {
  const test = options?.testMode === true || isTestMode();
  const filePath = getRotationFilePath(test);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  // In production, persist state to GitHub repo so ephemeral container restarts retain state
  if (!test && config.githubToken) {
    putFileInRepo(
      ROTATION_STATE_FILE,
      JSON.stringify(state, null, 2) + "\n",
      "chore(state): advance prospect rotation state"
    ).catch((err) => {
      console.warn(`[Rotation State Sync Warning]:`, err.message || err);
    });
  }
}

/**
 * Returns the next (city, category) pair according to the schedule rotation.
 */
export function getNextRotation(options?: {
  cityOverride?: string;
  categoryOverride?: string;
  testMode?: boolean;
}): { city: RotationCity; category: RotationCategory; isOverridden: boolean } {
  if (options?.cityOverride && options?.categoryOverride) {
    return {
      city: options.cityOverride as RotationCity,
      category: options.categoryOverride as RotationCategory,
      isOverridden: true,
    };
  }

  const state = loadRotationState(options);
  const city = ROTATION_CITIES[state.currentCityIndex % ROTATION_CITIES.length];
  const category = ROTATION_CATEGORIES[state.currentCategoryIndex % ROTATION_CATEGORIES.length];

  return {
    city: (options?.cityOverride as RotationCity) || city,
    category: (options?.categoryOverride as RotationCategory) || category,
    isOverridden: Boolean(options?.cityOverride || options?.categoryOverride),
  };
}

/**
 * Advances both city and category on each scheduled run.
 */
export function advanceRotation(options?: { testMode?: boolean }): RotationState {
  const state = loadRotationState(options);
  state.currentCityIndex = (state.currentCityIndex + 1) % ROTATION_CITIES.length;
  state.currentCategoryIndex = (state.currentCategoryIndex + 1) % ROTATION_CATEGORIES.length;
  state.completedRunsCount += 1;
  state.lastRunAt = new Date().toISOString();
  saveRotationState(state, options);
  return state;
}

export interface ParsedResearchBrief {
  city?: RotationCity;
  category?: RotationCategory;
  targetCount?: number;
  isExplicit: boolean;
}

/**
 * Parses an explicit city × category brief from a /task prompt or issue deliverable.
 * Matches explicit combinations like "Delhi NCR × cosmetic dental", "Mumbai × hospitals", etc.
 * Rotation state applies only to scheduled runs; an explicit brief must override rotation.
 */
export function parseResearchBrief(text: string): ParsedResearchBrief {
  const normalized = text.toLowerCase().trim();
  let city: RotationCity | undefined;
  let category: RotationCategory | undefined;
  let targetCount: number | undefined;

  // 1. Detect City
  if (normalized.includes("delhi ncr") || normalized.includes("delhi")) {
    city = "Delhi NCR";
  } else if (normalized.includes("mumbai") || normalized.includes("bombay")) {
    city = "Mumbai";
  } else if (normalized.includes("bengaluru") || normalized.includes("bangalore")) {
    city = "Bengaluru";
  } else if (normalized.includes("hyderabad")) {
    city = "Hyderabad";
  } else if (normalized.includes("chandigarh") || normalized.includes("tricity")) {
    city = "Chandigarh Tricity";
  }

  // 2. Detect Category
  if (
    normalized.includes("cosmetic dental") ||
    normalized.includes("cosmetic_dental") ||
    normalized.includes("dental") ||
    normalized.includes("dentist")
  ) {
    category = "cosmetic_dental";
  } else if (
    normalized.includes("hospital") ||
    normalized.includes("surgical")
  ) {
    category = "hospitals";
  } else if (
    normalized.includes("ivf") ||
    normalized.includes("fertility")
  ) {
    category = "ivf_fertility";
  } else if (
    normalized.includes("coaching") ||
    normalized.includes("neet") ||
    normalized.includes("jee") ||
    normalized.includes("test prep") ||
    normalized.includes("high ticket coaching") ||
    normalized.includes("high_ticket_coaching")
  ) {
    category = "high_ticket_coaching";
  }

  // 3. Detect targetCount (e.g. "20 names", "25 prospects", "target: 20")
  const countMatch = normalized.match(/(?:target[:\s]+)?(\d{1,3})\s*(?:names|prospects|accounts|leads)?/);
  if (countMatch) {
    const parsed = parseInt(countMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      targetCount = parsed;
    }
  }

  return {
    city,
    category,
    targetCount,
    isExplicit: Boolean(city && category),
  };
}
