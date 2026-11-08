// services/tgl-ops/src/agents/sales-desk/cadence.ts
// Follow-up cadence (SKILL.md Playbook C). Business-day offsets from the day the proposal was sent.
// Each step is a GHL task for a human; nothing here messages a prospect.
import type { CadenceTaskRecord } from "./types.js";

export interface CadenceStepDef {
  step: number;
  offsetBusinessDays: number;
  title: string;
  body: string;
}

export const CADENCE_STEPS: CadenceStepDef[] = [
  {
    step: 1,
    offsetBusinessDays: 1,
    title: "Proposal follow-up 1: confirm receipt",
    body: "Confirm the proposal arrived and offer a walkthrough of the audit finding it leads with. Add something specific from the proposal; do not write 'just checking in'.",
  },
  {
    step: 2,
    offsetBusinessDays: 3,
    title: "Proposal follow-up 2: answer the likely objection",
    body: "Address the likeliest objection from the call (scope, timing, who does the work) in two sentences.",
  },
  {
    step: 3,
    offsetBusinessDays: 7,
    title: "Proposal follow-up 3: one new observation",
    body: "Share one new, checkable observation about their category or city. Quote only stored audit data.",
  },
  {
    step: 4,
    offsetBusinessDays: 14,
    title: "Proposal follow-up 4: close-out",
    body: "Plain close-out: ask permission to close the file. If they reply or decline, stop the cadence.",
  },
];

const IST_OFFSET_MS = 330 * 60_000;

/** Adds business days (Mon-Fri, IST calendar) and keeps the time of day. */
export function addBusinessDays(from: Date, days: number): Date {
  let d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d = new Date(d.getTime() + 86_400_000);
    const dow = new Date(d.getTime() + IST_OFFSET_MS).getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d;
}

export function planCadence(sentAt: Date): CadenceTaskRecord[] {
  return CADENCE_STEPS.map((s) => ({ step: s.step, due_at: addBusinessDays(sentAt, s.offsetBusinessDays).toISOString() }));
}
