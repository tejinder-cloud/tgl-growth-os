// services/tgl-ops/src/agents/prospect-researcher/rotation.ts
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import type { RotationCity, RotationCategory, RotationState } from "./types.js";
import { putFileInRepo, readFileFromRepo } from "../../lib/github-client.js";

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

/**
 * Calculates deterministic IST weekday-based rotation indices for Mon-Fri:
 * Monday (1)    -> Delhi NCR (0)
 * Tuesday (2)   -> Mumbai (1)
 * Wednesday (3) -> Bengaluru (2)
 * Thursday (4)  -> Hyderabad (3)
 * Friday (5)    -> Chandigarh Tricity (4)
 * Categories rotate day-by-day and week-by-week across:
 * hospitals (0), cosmetic_dental (1), ivf_fertility (2), high_ticket_coaching (3).
 */
export function getWeekdayDefaultRotation(now = new Date()): { cityIndex: number; categoryIndex: number } {
  // Format current date in Asia/Kolkata timezone
  const istDateString = now.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istDateString);
  const dayOfWeek = istDate.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat

  // Monday to Friday maps to indices 0 to 4. Weekend defaults to 0 (Delhi NCR).
  const cityIndex = dayOfWeek >= 1 && dayOfWeek <= 5 ? (dayOfWeek - 1) % ROTATION_CITIES.length : 0;

  // Calculate week of year in IST
  const startOfYear = new Date(istDate.getFullYear(), 0, 1);
  const daysDiff = Math.floor((istDate.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.max(0, Math.floor(daysDiff / 7));

  // Category cycles day by day across the 4 categories
  const categoryIndex = (weekNumber + cityIndex) % ROTATION_CATEGORIES.length;

  return { cityIndex, categoryIndex };
}

/**
 * Synchronizes rotation state from GitHub repository into local container filesystem.
 * Essential for ephemeral Railway container boots so state committed on main is restored.
 */
export async function syncRotationStateFromRepo(options?: { testMode?: boolean }): Promise<void> {
  const test = options?.testMode === true || isTestMode();
  if (test) return;

  const filePath = getRotationFilePath(false);
  if (!fs.existsSync(filePath) && config.githubToken) {
    try {
      const content = await readFileFromRepo(ROTATION_STATE_FILE);
      if (content) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, "utf8");
        console.log(`[Rotation Sync] Restored rotation state from GitHub repo (${ROTATION_STATE_FILE})`);
        return;
      }
    } catch (err: any) {
      console.warn(`[Rotation Sync Warning]: Could not restore state from repo:`, err?.message || err);
    }
  }
}

export function loadRotationState(options?: { testMode?: boolean }): RotationState {
  const test = options?.testMode === true || isTestMode();
  const filePath = getRotationFilePath(test);

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed.currentCityIndex === "number" && typeof parsed.currentCategoryIndex === "number") {
        return parsed;
      }
    } catch {
      // fallback
    }
  }

  // In test mode, keep deterministic 0,0 default so unit tests pass identically
  if (test) {
    return {
      version: 1,
      currentCityIndex: 0,
      currentCategoryIndex: 0,
      completedRunsCount: 0,
      lastRunAt: new Date().toISOString(),
    };
  }

  // In production if no state exists on disk, use deterministic IST weekday schedule
  const weekday = getWeekdayDefaultRotation();
  const fresh: RotationState = {
    version: 1,
    currentCityIndex: weekday.cityIndex,
    currentCategoryIndex: weekday.categoryIndex,
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
