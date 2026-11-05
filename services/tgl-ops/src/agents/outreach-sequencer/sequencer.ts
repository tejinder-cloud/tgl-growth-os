// services/tgl-ops/src/agents/outreach-sequencer/sequencer.ts
// Outreach Sequencer tick. All I/O goes through SequencerDeps so the same code runs dry or live.
// Dry-run (the default) never calls GHL, never writes touch records, never uploads the one-pager.
import type { ProspectRecord } from "../prospect-researcher/types.js";
import { config } from "../../config.js";
import { renderTouch } from "./templates.js";
import { inOutreachWindow, istParts } from "./window.js";
import {
  prospectKey,
  type AuditOutcome,
  type RenderedTouch,
  type SequencerDeps,
  type TickOptions,
  type TickResult,
  type TouchRecord,
  type TouchTemplate,
} from "./types.js";

const MAX_SEND_ATTEMPTS_PER_TOUCH = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export const TEST_PROSPECT: ProspectRecord = {
  tenant_id: "tgl",
  company: "Test Prospect Clinic (fixture)",
  category: "cosmetic_dental",
  city: "Chandigarh Tricity",
  website: "test-prospect.example",
  door: "aeo",
  fit_score: 0,
  fit_reasons: ["fixture for dry-run proof, not a real prospect"],
  decision_maker: {
    name: "Test Person",
    role: "Owner",
    email: "test-person@test-prospect.example",
    phone: "+910000000000",
    source: "fixture",
  },
  signals: {
    meta_ads_active: false,
    meta_ad_count: 0,
    gbp_reviews: 0,
    gbp_owner_replies: false,
    hiring_marketing: false,
    review_surge: false,
    branch_count: 1,
  },
  status: "new",
  source_refs: [],
  created_at: "2000-01-01T00:00:00.000Z",
  rescored_at: "2000-01-01T00:00:00.000Z",
};

function senderName(): string {
  return (process.env.OUTREACH_SENDER_NAME || "The Growth Lab team").trim();
}

function describeTouch(t: RenderedTouch): string {
  const lines = [`#### Touch ${t.touchNo} (${t.channel}${t.attachAudit ? ", one-pager attached" : ""})`];
  if (t.subject) lines.push(`Subject: ${t.subject}`);
  lines.push("", "```", t.body, "```", "");
  return lines.join("\n");
}

/** Next touch due for a prospect given its history, or a reason it is not due. */
export function nextTouchFor(
  history: TouchRecord[],
  templates: TouchTemplate[],
  now: Date
): { template?: TouchTemplate; reason?: string } {
  if (history.some((h) => h.status === "replied" || h.status === "opted_out")) {
    return { reason: "halted: prospect replied or opted out" };
  }
  const sent = history.filter((h) => h.status === "sent" && h.touchNo >= 1);
  const lastNo = sent.reduce((m, h) => Math.max(m, h.touchNo), 0);
  const nextNo = lastNo + 1;
  const template = templates.find((t) => t.touchNo === nextNo);
  if (!template) return { reason: "sequence complete" };
  const failures = history.filter((h) => h.status === "failed" && h.touchNo === nextNo).length;
  if (failures >= MAX_SEND_ATTEMPTS_PER_TOUCH) {
    return { reason: `held: touch ${nextNo} failed ${failures} times` };
  }
  if (lastNo >= 1) {
    const last = sent.filter((h) => h.touchNo === lastNo).sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    const dueAt = new Date(last.sentAt).getTime() + template.dayOffset * DAY_MS;
    if (now.getTime() < dueAt) return { reason: `not due until ${new Date(dueAt).toISOString()}` };
  }
  return { template };
}

export async function runOutreachTick(deps: SequencerDeps, opts: TickOptions = {}): Promise<TickResult> {
  const mode = deps.live ? "live" : "dry-run";
  const now = deps.now();
  const ist = istParts(now, config.timezone);
  const result: TickResult = { mode, testProspectTouches: [], actions: [], logMarkdown: "" };
  const md: string[] = [`## ${mode === "live" ? "Live" : "Dry-run"} tick ${ist.hhmm} IST`, ""];

  if (opts.enforceWindow && !inOutreachWindow(now, config.timezone)) {
    result.skippedReason = "outside Mon-Fri 09:30-17:30 IST";
    md.push(`Skipped: ${result.skippedReason}.`, "");
    result.logMarkdown = md.join("\n");
    return result;
  }

  const templates = await deps.loadTemplates();

  // 1. Test prospect: render all five touches with a clearly labelled fixture audit.
  if (opts.includeTestProspect) {
    const audit = await deps.runAudit(TEST_PROSPECT, { fixture: true });
    md.push(
      `### Test prospect: ${TEST_PROSPECT.company}`,
      "",
      "Audit values below come from the audit engine in fixture mode (mock engine answers). They are not real measurements and must never be quoted to a prospect.",
      ""
    );
    for (const tpl of templates) {
      const rendered = renderTouch(tpl, TEST_PROSPECT, audit.vars, senderName());
      result.testProspectTouches.push(rendered);
      md.push(describeTouch(rendered));
    }
    md.push(
      audit.pdf
        ? `One-pager generated: ${audit.pdf.filename}, ${(audit.pdf.sizeBytes / 1024).toFixed(1)} KB (limit 2048 KB). Not uploaded, not sent (dry-run).`
        : "One-pager: not generated.",
      ""
    );
  }

  // 2. Real prospects handed to outreach.
  const all = (await deps.loadProspects()).filter((p) => p.status === "handed_to_outreach");
  const keys = all.map(prospectKey);
  const history = all.length ? await deps.loadHistory(keys) : {};
  const sentToday = deps.live ? await deps.countSentToday() : 0;
  let budget = Math.max(0, Math.min(deps.perTickCap, deps.dailyCap - sentToday));
  md.push(`### Queue`, "", `Prospects handed to outreach: ${all.length}. Daily cap ${deps.dailyCap}, sent today ${sentToday}, this tick budget ${budget}.`, "");

  for (const p of all) {
    if (budget <= 0) break;
    const key = prospectKey(p);
    const label = `${p.company} (${p.website})`;
    try {
      const { template, reason } = nextTouchFor(history[key] || [], templates, now);
      if (!template) {
        result.actions.push({ prospect: label, touchNo: 0, channel: "none", outcome: reason || "none" });
        continue;
      }
      const dm = p.decision_maker;
      const contact = template.channel === "email" ? dm?.email : dm?.phone;
      if (!contact) {
        result.actions.push({ prospect: label, touchNo: template.touchNo, channel: template.channel, outcome: `held: no ${template.channel === "email" ? "email" : "phone"} on record` });
        continue;
      }

      let audit: AuditOutcome | undefined;
      let auditVars = (history[key] || []).find((h) => h.audit)?.audit;
      if (template.needsAudit && !deps.live) {
        result.actions.push({ prospect: label, touchNo: template.touchNo, channel: template.channel, outcome: "would send; audit values resolve live only (dry-run does not spend audit cost)" });
        continue;
      }
      if (template.attachAudit || (template.needsAudit && !auditVars)) {
        try {
          audit = await deps.runAudit(p, { fixture: false });
          auditVars = audit.vars;
        } catch (err: any) {
          result.actions.push({ prospect: label, touchNo: template.touchNo, channel: template.channel, outcome: `held: audit unavailable (${err?.message || err})` });
          continue;
        }
      }

      const rendered = renderTouch(template, p, auditVars, senderName());
      if (!deps.live) {
        result.actions.push({ prospect: label, touchNo: template.touchNo, channel: template.channel, outcome: "dry-run: rendered, not sent" });
        md.push(describeTouch(rendered));
        budget--;
        continue;
      }

      const sendRes =
        rendered.channel === "email"
          ? await deps.sendEmail({
              prospect: p,
              subject: rendered.subject as string,
              body: rendered.body,
              attachment: rendered.attachAudit && audit?.pdf ? { buffer: audit.pdf.buffer, filename: audit.pdf.filename } : undefined,
            })
          : await deps.sendWhatsApp({ prospect: p, body: rendered.body });

      await deps.recordTouch({
        prospectKey: key,
        touchNo: rendered.touchNo,
        channel: rendered.channel,
        status: sendRes.ok ? "sent" : "failed",
        sentAt: now.toISOString(),
        ghlMessageId: sendRes.messageId,
        error: sendRes.error,
        audit: auditVars,
      });
      result.actions.push({ prospect: label, touchNo: rendered.touchNo, channel: rendered.channel, outcome: sendRes.ok ? "sent" : `failed: ${sendRes.error}` });
      if (sendRes.ok) budget--;
    } catch (err: any) {
      result.actions.push({ prospect: label, touchNo: 0, channel: "none", outcome: `error: ${err?.message || err}` });
    }
  }

  if (result.actions.length) {
    md.push("### Actions", "", ...result.actions.map((a) => `- ${a.prospect}: touch ${a.touchNo || "-"} ${a.channel}: ${a.outcome}`), "");
  }
  result.logMarkdown = md.join("\n");
  await deps.writeLog(ist.dateStr, result.logMarkdown);
  if (deps.live && result.actions.some((a) => a.outcome === "sent" || a.outcome.startsWith("failed"))) {
    await deps.notify(
      `*Outreach Sequencer tick ${ist.hhmm} IST (live)*\n` +
        result.actions.map((a) => `- ${a.prospect}: touch ${a.touchNo || "-"} ${a.channel}: ${a.outcome}`).join("\n")
    );
  }
  return result;
}
