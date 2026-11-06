// services/tgl-ops/src/lib/aeo-whatsapp-templates.ts
// WhatsApp message templates for the /aeo audit funnel (PLAN-D11).
//
// These are the exact bodies submitted to Meta (via GHL > Settings > WhatsApp > Templates).
// Meta approves a template once; after that only the {{n}} variables change. This module is the single
// source of truth for the wording, and `validateTemplate` encodes the Meta rules that most often get a
// template rejected, so a bad edit fails in CI instead of in the Meta review queue.
//
// Nothing in here sends a message. Sending is done by GHL workflows triggered by the AEO pipeline stage.

export type TemplateCategory = "UTILITY" | "MARKETING";
export type TemplateAudience = "prospect" | "internal";

export interface WhatsAppTemplate {
  /** Meta template name: lowercase letters, digits and underscores only. */
  name: string;
  language: "en";
  category: TemplateCategory;
  audience: TemplateAudience;
  /** The GHL pipeline stage whose entry should trigger the workflow that sends this template. */
  triggerStage: string;
  /** Body text with {{1}}..{{n}} positional variables. */
  body: string;
  /** What each variable carries, in order. */
  variables: string[];
  /** Sample values Meta requires at submission. Must be one per variable. */
  samples: string[];
}

export const AEO_TEMPLATES: WhatsAppTemplate[] = [
  {
    name: "aeo_audit_received",
    language: "en",
    category: "UTILITY",
    audience: "prospect",
    triggerStage: "New request",
    body:
      "Hi {{1}}, we have received your request for an AI search audit of {{2}}. " +
      "We will check how ChatGPT, Gemini and Perplexity describe your institute and send the written report on this number. " +
      "If there is a question you want us to include, just reply here. The Growth Lab",
    variables: ["first name", "institute name"],
    samples: ["Rohit", "Sharma Academy"],
  },
  {
    name: "aeo_audit_ready",
    language: "en",
    category: "UTILITY",
    audience: "prospect",
    triggerStage: "Audit sent",
    body:
      "Hi {{1}}, the AI search audit for {{2}} is ready. You can read it here: {{3}}. " +
      "If anything in it is unclear, reply with your question and our team will answer on this chat.",
    variables: ["first name", "institute name", "report link"],
    samples: ["Rohit", "Sharma Academy", "https://thegrowthlab.co.in/r/sample"],
  },
  {
    name: "aeo_audit_followup",
    language: "en",
    category: "MARKETING",
    audience: "prospect",
    triggerStage: "Audit sent (no reply after the agreed wait)",
    body:
      "Hi {{1}}, a quick check on the AI search audit we sent for {{2}}. " +
      "If a short call would help you act on it, reply with a time that suits you. " +
      "If it is not relevant right now, reply STOP and we will not message again.",
    variables: ["first name", "institute name"],
    samples: ["Rohit", "Sharma Academy"],
  },
  {
    name: "aeo_internal_new_request",
    language: "en",
    category: "UTILITY",
    audience: "internal",
    triggerStage: "New request",
    body:
      "New AEO audit request. Institute: {{1}}. Contact: {{2}} on {{3}}. Came from: {{4}}. " +
      "It is in the AEO pipeline at stage New request.",
    variables: ["institute name", "contact name", "contact WhatsApp number", "campaign source"],
    samples: ["Sharma Academy", "Rohit Sharma", "+919876543210", "meta / aeo-audit"],
  },
];

const NAME_RE = /^[a-z0-9_]{1,512}$/;
const VAR_RE = /\{\{(\d+)\}\}/g;
// Covers the emoji, pictograph, dingbat and symbol blocks. The service never uses emojis (AGENTS.md).
const EMOJI_RE = /[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\u{1F000}-\u{1FAFF}\uFE0F]/u;
const MAX_BODY = 1024;

/** Returns a list of problems. Empty list means the template is safe to submit. */
export function validateTemplate(t: WhatsAppTemplate): string[] {
  const problems: string[] = [];
  if (!NAME_RE.test(t.name)) problems.push(`${t.name}: name must be lowercase letters, digits and underscores`);
  if (t.body.length === 0) problems.push(`${t.name}: body is empty`);
  if (t.body.length > MAX_BODY) problems.push(`${t.name}: body is ${t.body.length} chars, limit is ${MAX_BODY}`);
  if (EMOJI_RE.test(t.body)) problems.push(`${t.name}: body contains an emoji or pictograph`);
  if (/[\n\t]/.test(t.body)) problems.push(`${t.name}: body contains a newline or tab`);
  if (t.body.includes("!")) problems.push(`${t.name}: body contains an exclamation mark (brand voice)`);

  const nums: number[] = [];
  for (const m of t.body.matchAll(VAR_RE)) nums.push(Number(m[1]));
  const expected = nums.map((_, i) => i + 1);
  if (nums.join(",") !== expected.join(",")) {
    problems.push(`${t.name}: variables must be numbered {{1}}..{{n}} in order, found [${nums.join(",")}]`);
  }
  if (t.variables.length !== nums.length) {
    problems.push(`${t.name}: ${nums.length} variables in body but ${t.variables.length} described`);
  }
  if (t.samples.length !== nums.length) {
    problems.push(`${t.name}: ${nums.length} variables in body but ${t.samples.length} sample values`);
  }
  if (/^\s*\{\{\d+\}\}/.test(t.body)) problems.push(`${t.name}: body must not start with a variable`);
  if (/\{\{\d+\}\}[\s.!?,]*$/.test(t.body)) problems.push(`${t.name}: body must not end with a variable`);
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(t.body)) problems.push(`${t.name}: two variables are adjacent`);
  for (const s of t.samples) {
    if (/[\n\t]| {4,}/.test(s)) problems.push(`${t.name}: sample value has a newline, tab or 4+ spaces`);
  }
  return problems;
}

export function validateAllTemplates(templates: WhatsAppTemplate[] = AEO_TEMPLATES): string[] {
  const problems = templates.flatMap(validateTemplate);
  const seen = new Set<string>();
  for (const t of templates) {
    if (seen.has(t.name)) problems.push(`${t.name}: duplicate template name`);
    seen.add(t.name);
  }
  return problems;
}

/** Fill the {{n}} variables. Throws when the value count does not match, so a send never goes out half-filled. */
export function renderTemplate(t: WhatsAppTemplate, values: string[]): string {
  if (values.length !== t.variables.length) {
    throw new Error(`${t.name}: expected ${t.variables.length} values, got ${values.length}`);
  }
  return t.body.replace(VAR_RE, (_m, n: string) => {
    const v = values[Number(n) - 1];
    // Meta rejects variable values containing newlines, tabs or runs of 4+ spaces.
    return String(v).replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
  });
}

export function getTemplate(name: string): WhatsAppTemplate {
  const t = AEO_TEMPLATES.find((x) => x.name === name);
  if (!t) throw new Error(`Unknown WhatsApp template: ${name}`);
  return t;
}
