import { config } from "../config.js";

/**
 * Returns YYYY-MM-DD formatted date in the target timezone (Asia/Kolkata).
 */
export function getTodayDateString(tz = config.timezone): string {
  const d = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
}

/**
 * Returns current time formatted as HH:mm in IST (24-hour).
 */
export function getCurrentTimeIST(): string {
  const d = new Date();
  return d.toLocaleTimeString("en-IN", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Formats a given epoch timestamp (seconds as string/number) or Date to HH:mm in IST (24-hour).
 * Accurately parses Slack ts (e.g. "1792920483.946459").
 */
export function formatTimeIST(dateOrTs?: Date | number | string): string {
  if (!dateOrTs) {
    return getCurrentTimeIST();
  }
  let d: Date;
  if (dateOrTs instanceof Date) {
    d = dateOrTs;
  } else if (typeof dateOrTs === "number") {
    d = dateOrTs < 1e11 ? new Date(dateOrTs * 1000) : new Date(dateOrTs);
  } else {
    const num = Number(dateOrTs);
    if (!isNaN(num) && num > 0) {
      d = num < 1e11 ? new Date(num * 1000) : new Date(num);
    } else {
      d = new Date(dateOrTs);
    }
  }

  if (isNaN(d.getTime())) {
    return getCurrentTimeIST();
  }

  return d.toLocaleTimeString("en-IN", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Formats a given epoch timestamp or Date to YYYY-MM-DD in IST.
 */
export function formatDateIST(dateOrTs?: Date | number | string): string {
  if (!dateOrTs) {
    return getTodayDateString();
  }
  let d: Date;
  if (dateOrTs instanceof Date) {
    d = dateOrTs;
  } else if (typeof dateOrTs === "number") {
    d = dateOrTs < 1e11 ? new Date(dateOrTs * 1000) : new Date(dateOrTs);
  } else {
    const num = Number(dateOrTs);
    if (!isNaN(num) && num > 0) {
      d = num < 1e11 ? new Date(num * 1000) : new Date(num);
    } else {
      d = new Date(dateOrTs);
    }
  }

  if (isNaN(d.getTime())) {
    return getTodayDateString();
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
}

/**
 * Evaluates whether current IST time falls within the 18:00–21:00 catch-up window.
 * Returns true if IST time is between 18:00:00 and 21:00:00 inclusive.
 */
export function isWithinCatchupWindowIST(date: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: config.timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
  return (hour >= 18 && hour < 21) || (hour === 21 && minute === 0);
}

