// services/tgl-ops/src/agents/prospect-researcher/rotation.ts
import fs from "node:fs";
import path from "node:path";
import { config, isTestMode } from "../../config.js";
import type { RotationCity, RotationCategory, RotationState } from "./types.js";

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
  saveRotationState(fresh, options);
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
 * Advances the rotation indices and updates state.
 */
export function advanceRotation(options?: { testMode?: boolean }): RotationState {
  const state = loadRotationState(options);
  state.currentCityIndex = (state.currentCityIndex + 1) % ROTATION_CITIES.length;
  // If we cycled through all 5 cities, advance category
  if (state.currentCityIndex === 0) {
    state.currentCategoryIndex = (state.currentCategoryIndex + 1) % ROTATION_CATEGORIES.length;
  }
  state.completedRunsCount += 1;
  state.lastRunAt = new Date().toISOString();
  saveRotationState(state, options);
  return state;
}
