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
