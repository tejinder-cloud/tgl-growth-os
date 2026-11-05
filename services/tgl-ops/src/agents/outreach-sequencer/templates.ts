// services/tgl-ops/src/agents/outreach-sequencer/templates.ts
// Reads touch templates from agents/outreach-sequencer/templates/touch-N.md and renders them strictly:
// an unresolved {{placeholder}} is an error, never a blank. Zero invented values.
import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import type { ProspectRecord } from "../prospect-researcher/types.js";
import type { AuditVars, RenderedTouch, TouchChannel, TouchTemplate } from "./types.js";

export const TEMPLATES_REL_DIR = "agents/outreach-sequencer/templates";

export function parseTemplate(file: string, raw: string): TouchTemplate {
  const m = file.match(/touch-(\d+)\.md$/);
  if (!m) throw new Error(`Template file name must be touch-N.md: ${file}`);
  const sep = raw.indexOf("\n---\n");
  if (sep === -1) throw new Error(`Template ${file} has no header separator line (---)`);
  const header = raw.slice(0, sep);
  const body = raw.slice(sep + 5).trim();
  const meta: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const channel = meta.channel as TouchChannel;
  if (channel !== "email" && channel !== "whatsapp") {
    throw new Error(`Template ${file}: channel must be email or whatsapp`);
  }
  if (channel === "email" && !meta.subject) throw new Error(`Template ${file}: email needs a subject`);
  if (!body) throw new Error(`Template ${file}: empty body`);
  return {
    touchNo: Number(m[1]),
    channel,
    subject: meta.subject,
    dayOffset: Number(meta.day_offset || "0"),
    attachAudit: meta.attach_audit === "true",
    needsAudit: meta.needs_audit === "true",
    body,
    file,
  };
}

export function loadTemplatesFromDisk(repoRoot: string = config.repoRoot): TouchTemplate[] {
  const dir = path.join(repoRoot, TEMPLATES_REL_DIR);
  if (!fs.existsSync(dir)) throw new Error(`Templates directory not found: ${TEMPLATES_REL_DIR}`);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^touch-\d+\.md$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const templates = files.map((f) => parseTemplate(f, fs.readFileSync(path.join(dir, f), "utf8")));
  const nums = templates.map((t) => t.touchNo);
  if (nums.join(",") !== "1,2,3,4,5") {
    throw new Error(`Expected exactly touches 1-5 in ${TEMPLATES_REL_DIR}, found: ${nums.join(",") || "none"}`);
  }
  return templates;
}

export function baseVars(prospect: ProspectRecord, senderName: string): Record<string, string> {
  const dmName = (prospect.decision_maker?.name || "").trim();
  const first = dmName.split(/\s+/)[0] || "there";
  return {
    first_name: first,
    company: prospect.company,
    city: prospect.city,
    category: prospect.category.replace(/_/g, " "),
    website: prospect.website,
    sender_name: senderName,
  };
}

export function renderString(tpl: string, vars: Record<string, string>, label: string): string {
  const out = tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, key: string) => {
    if (!(key in vars) || vars[key] === "") {
      throw new Error(`Unresolved placeholder {{${key}}} in ${label}`);
    }
    return vars[key];
  });
  return out;
}

export function renderTouch(
  template: TouchTemplate,
  prospect: ProspectRecord,
  audit: AuditVars | undefined,
  senderName: string
): RenderedTouch {
  const vars: Record<string, string> = { ...baseVars(prospect, senderName), ...(audit || {}) };
  const label = `${template.file} for ${prospect.company}`;
  if (template.needsAudit && !audit) {
    throw new Error(`${label} needs audit values and none were supplied`);
  }
  return {
    touchNo: template.touchNo,
    channel: template.channel,
    subject: template.subject ? renderString(template.subject, vars, `${label} (subject)`) : undefined,
    body: renderString(template.body, vars, label),
    attachAudit: template.attachAudit,
  };
}
