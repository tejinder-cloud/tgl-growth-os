// services/tgl-ops/src/agents/sales-desk/proposal.ts
// Proposal generator (SKILL.md Playbook B). Pure. Renders the same sections as
// agents/sales-desk/templates/proposal.md. Figures come only from the prospect's stored audit; pricing comes
// only from Architect-approved lines passed in. If either is missing the result is "held", never guessed.
import { auditLines, readAudit } from "./dossier.js";
import type { Appointment, PricingLine, SalesProspect } from "./types.js";

export const DEFAULT_SLA_HOURS = 4;
export const DEFAULT_VALID_DAYS = 14;

/** Placeholders in templates/proposal.md. The Day 12 test compares this list with the file. */
export const PROPOSAL_PLACEHOLDERS = [
  "COMPANY",
  "DECISION_MAKER",
  "CITY",
  "CATEGORY",
  "DATE",
  "AUDIT_SECTION",
  "CALL_SECTION",
  "SCOPE_SECTION",
  "PRICING_TABLE",
  "VALID_UNTIL",
  "SENDER",
] as const;

export const PROPOSAL_TEMPLATE = `# Proposal for {{COMPANY}}

Prepared for {{DECISION_MAKER}} · {{CITY}} · {{CATEGORY}}
Date: {{DATE}} · Valid until: {{VALID_UNTIL}}

## 1. Where you stand today

{{AUDIT_SECTION}}

## 2. What we heard on the call

{{CALL_SECTION}}

## 3. What we will do

{{SCOPE_SECTION}}

## 4. Investment

{{PRICING_TABLE}}

## 5. What we do not promise

We do not promise a ranking, a citation, or a revenue figure. AI assistants change their answers; we measure the change and report it to you every month, including when it is flat.

## 6. Next step

Reply to this message to accept, or tell us what to change. We will send the agreement and start within the window we agree.

{{SENDER}}
The Growth Lab
`;

export function slaHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number((env.SALES_DESK_PROPOSAL_SLA_HOURS || "").trim());
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SLA_HOURS;
}

/** Deadline = call end + SLA hours. */
export function proposalDeadline(callEndedAt: string, hours = DEFAULT_SLA_HOURS): string {
  return new Date(Date.parse(callEndedAt) + hours * 3_600_000).toISOString();
}

/** True once 75% of the window has elapsed. */
export function isWarnDue(callEndedAt: string, now: Date, hours = DEFAULT_SLA_HOURS): boolean {
  return now.getTime() >= Date.parse(callEndedAt) + hours * 3_600_000 * 0.75;
}

export function isBreached(callEndedAt: string, now: Date, hours = DEFAULT_SLA_HOURS): boolean {
  return now.getTime() > Date.parse(callEndedAt) + hours * 3_600_000;
}

export interface ProposalInput {
  prospect: SalesProspect;
  appointment: Appointment;
  /** Call notes written after the call ended. Verbatim; never summarised into claims. */
  callNotes?: string;
  pricing: PricingLine[];
  sender: string;
  now: Date;
  validDays?: number;
  auditMaxAgeDays?: number;
}

export type ProposalResult =
  | { status: "drafted"; markdown: string }
  | { status: "held"; reason: string };

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => (key in values ? values[key] : m));
}

export function pricingTable(lines: PricingLine[]): string {
  const rows = lines.map((l) => `| ${l.label} | ${l.amount} | ${l.note || ""} |`);
  return ["| Item | Amount | Note |", "|---|---|---|", ...rows].join("\n");
}

function scopeSection(p: SalesProspect): string {
  const a = readAudit(p, new Date(0), 36500);
  const lead = a && a.topCompetitors.length
    ? `1. Fix the buyer questions where AI assistants name ${a.topCompetitors[0]} and not ${p.company}.`
    : `1. Fix the buyer questions where AI assistants do not name ${p.company}.`;
  return [
    lead,
    "2. Publish the pages and structured data those answers draw from, on your own site.",
    "3. Re-run the same audit every month and report the change, including when it is flat.",
  ].join("\n");
}

function callSection(notes?: string): string | null {
  const t = (notes || "").trim();
  if (!t) return null;
  return t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("-") ? l : `- ${l}`))
    .join("\n");
}

export function generateProposal(input: ProposalInput): ProposalResult {
  const { prospect: p, now } = input;
  if (!input.pricing || input.pricing.length === 0) {
    return { status: "held", reason: "no Architect-approved pricing lines supplied; pricing is never inferred" };
  }
  const audit = readAudit(p, now, input.auditMaxAgeDays);
  if (!audit) return { status: "held", reason: "no audit on file for this prospect; the proposal leads with their own audit" };
  if (audit.stale) return { status: "held", reason: `audit dated ${audit.auditedAt.slice(0, 10) || "unknown"} is stale; re-run before quoting it` };
  const call = callSection(input.callNotes);
  if (!call) return { status: "held", reason: "no call notes found after the call ended; the proposal quotes what the prospect said" };

  const dm = p.decision_maker || {};
  const valid = new Date(now.getTime() + (input.validDays ?? DEFAULT_VALID_DAYS) * 86_400_000);
  const markdown = fill(PROPOSAL_TEMPLATE, {
    COMPANY: p.company,
    DECISION_MAKER: dm.name || "the team",
    CITY: p.city || "your city",
    CATEGORY: (p.category || "your category").replace(/_/g, " "),
    DATE: now.toISOString().slice(0, 10),
    AUDIT_SECTION: auditLines(audit).map((l) => `- ${l}`).join("\n"),
    CALL_SECTION: call,
    SCOPE_SECTION: scopeSection(p),
    PRICING_TABLE: pricingTable(input.pricing),
    VALID_UNTIL: valid.toISOString().slice(0, 10),
    SENDER: input.sender,
  });
  const left = markdown.match(/\{\{[A-Z_]+\}\}/);
  if (left) return { status: "held", reason: `unfilled placeholder ${left[0]}` };
  return { status: "drafted", markdown };
}
