// services/tgl-ops/src/agents/outreach-sequencer/window.ts
// Business-hours guard for the outreach tick: Mon-Fri 09:30-17:30 in the configured timezone (IST).

export function istParts(now: Date, timeZone: string): { weekday: number; minutes: number; dateStr: string; hhmm: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  const dayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    weekday: dayMap[parts.weekday] ?? 0,
    minutes: hour * 60 + minute,
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

export function inOutreachWindow(now: Date, timeZone: string): boolean {
  const { weekday, minutes } = istParts(now, timeZone);
  return weekday >= 1 && weekday <= 5 && minutes >= 9 * 60 + 30 && minutes <= 17 * 60 + 30;
}
