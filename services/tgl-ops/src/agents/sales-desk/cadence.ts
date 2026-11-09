// services/tgl-ops/src/agents/sales-desk/cadence.ts
// Follow-up cadence (SKILL.md Playbook C). Four GHL tasks at business-day offsets from the proposal send
// date, a `tgl-proposal-sent` tag, and optional enrolment in the Architect's GHL workflow. The service
// creates tasks for a human; it never messages the prospect. Business days skip Saturday and Sunday in IST;
// public holidays are not modelled.
import type { SalesGhlClient } from "./ghl.js";
import type { CadenceRecord, CadenceTaskRecord } from "./types.js";

export const CADENCE_TAG = "tgl-proposal-sent";
export const IST_OFFSET_MINUTES = 330;

export interface CadenceStepDef {
  step: number;
  /** Business days after the proposal send date. */
  offsetBusinessDays: number;
  title: string;
  guidance: string;
}

export const CADENCE_STEPS: CadenceStepDef[] = [
  {
    step: 1,
    offsetBusinessDays: 1,
    title: "Confirm receipt",
    guidance: "Confirm the proposal arrived and offer to walk through the audit finding it leads with.",
  },
  {
    step: 2,
    offsetBusinessDays: 3,
    title: "Answer the likely objection",
    guidance: "Address the most likely objection (scope, timing, who does the work) in plain words.",
  },
  {
    step: 3,
    offsetBusinessDays: 7,
    title: "Share one new observation",
    guidance: "Share one new, stored-source observation about their category or city. Do not repeat earlier points.",
  },
  {
    step: 4,
    offsetBusinessDays: 14,
    title: "Close-out",
    guidance: "Plain close-out: ask permission to close the file. No pressure, no new offer.",
  },
];

/** Adds business days (Mon to Fri, IST calendar) keeping the same time of day. */
export function addBusinessDays(fromIso: string, days: number): string {
  const ms = Date.parse(fromIso);
  if (!Number.isFinite(ms)) throw new Error(`Invalid date: ${fromIso}`);
  const shift = IST_OFFSET_MINUTES * 60_000;
  const d = new Date(ms + shift);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return new Date(d.getTime() - shift).toISOString();
}

export function buildCadencePlan(sentAtIso: string): CadenceTaskRecord[] {
  return CADENCE_STEPS.map((s) => ({ step: s.step, due_at: addBusinessDays(sentAtIso, s.offsetBusinessDays) }));
}

export type CadenceGhl = Pick<SalesGhlClient, "createTask" | "addTags" | "enrollWorkflow">;

export interface RegisterCadenceInput {
  contactId: string;
  company: string;
  /** ISO time the human marked the proposal as sent. */
  sentAt: string;
  live: boolean;
  now: Date;
  ghl?: CadenceGhl;
  /** GHL_SALES_FOLLOWUP_WORKFLOW_ID, set by the Architect. Optional. */
  workflowId?: string;
  existing?: CadenceRecord;
}

export interface RegisterCadenceResult {
  record: CadenceRecord;
  /** Number of GHL writes made this call (tasks plus tag plus enrolment). */
  writes: number;
  /** True when nothing needed doing. */
  unchanged: boolean;
}

export function taskTitle(step: CadenceStepDef, company: string): string {
  return `Follow-up step ${step.step} (Day ${step.offsetBusinessDays}): ${step.title} - ${company}`;
}

/**
 * Registers the cadence. Idempotent: a complete live record for the same send date is returned untouched,
 * and a partially completed record resumes from the first task without a GHL id. A dry-run record is
 * rebuilt when the worker goes live. Errors are captured in `last_error` so progress is never lost.
 */
export async function registerCadence(input: RegisterCadenceInput): Promise<RegisterCadenceResult> {
  const { existing } = input;
  const sameAnchor = !!existing && existing.anchor_sent_at === input.sentAt;

  if (sameAnchor && existing!.complete && !existing!.dry_run) return { record: existing!, writes: 0, unchanged: true };
  if (sameAnchor && existing!.complete && existing!.dry_run && !input.live) {
    return { record: existing!, writes: 0, unchanged: true };
  }

  const plan = buildCadencePlan(input.sentAt);

  if (!input.live) {
    return {
      record: {
        anchor_sent_at: input.sentAt,
        registered_at: input.now.toISOString(),
        tasks: plan,
        workflow_enrolled: false,
        dry_run: true,
        complete: true,
      },
      writes: 0,
      unchanged: false,
    };
  }

  if (!input.ghl) throw new Error("registerCadence: a GHL client is required in live mode");
  const ghl = input.ghl;

  const resume = sameAnchor && !existing!.dry_run;
  const record: CadenceRecord = {
    anchor_sent_at: input.sentAt,
    registered_at: resume ? existing!.registered_at : input.now.toISOString(),
    tasks: plan.map((p) => {
      const prior = resume ? existing!.tasks.find((t) => t.step === p.step) : undefined;
      return prior?.ghl_task_id ? { ...p, ghl_task_id: prior.ghl_task_id } : p;
    }),
    workflow_enrolled: resume ? !!existing!.workflow_enrolled : false,
    dry_run: false,
    complete: false,
  };

  let writes = 0;
  try {
    for (const t of record.tasks) {
      if (t.ghl_task_id) continue;
      const def = CADENCE_STEPS.find((s) => s.step === t.step)!;
      const created = await ghl.createTask(input.contactId, {
        title: taskTitle(def, input.company),
        body: `${def.guidance}\n\nEvery follow-up must add something new. Never write "just checking in". Draft only: a human sends.`,
        dueDate: t.due_at,
      });
      t.ghl_task_id = created.taskId;
      writes += 1;
    }
    if (!resume) {
      await ghl.addTags(input.contactId, [CADENCE_TAG]);
      writes += 1;
    }
    if (input.workflowId && !record.workflow_enrolled) {
      await ghl.enrollWorkflow(input.contactId, input.workflowId);
      record.workflow_enrolled = true;
      writes += 1;
    }
    record.complete = true;
  } catch (e) {
    record.last_error = e instanceof Error ? e.message : String(e);
  }
  return { record, writes, unchanged: false };
}
