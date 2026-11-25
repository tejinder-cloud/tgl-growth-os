// services/tgl-ops/src/agents/outreach-sequencer/preaudit.ts
// AI checks in advance for approved businesses that have only a phone number (Architect, 24 Nov 2026: no cold
// calls). They cannot be emailed, so their first message will be the WhatsApp first touch once Meta approves the
// app; that message quotes the business's own check (date, question, who was named). Running the checks now, a few
// a day, means those messages are ready the day WhatsApp opens. The result is stored in signals.preaudit and shown
// on the live view. Nothing is sent to anyone here.
import type { AuditSummary } from "./types.js";
import { recordEvent } from "../../lib/events.js";
import { cleanBusinessName } from "./names.js";

export interface PreauditCandidate {
  id: string;
  company: string;
  website?: string | null;
  city?: string | null;
  category?: string | null;
  status: string;
  door?: string | null;
  fit_score?: number | null;
  decision_maker?: { email?: string; phone?: string } | null;
  signals?: { outreach?: unknown; preaudit?: { audited_at?: string } } | null;
}

export const DEFAULT_PREAUDITS_PER_DAY = 5;
/** A check older than this is run again before it is quoted. */
export const PREAUDIT_MAX_AGE_DAYS = 30;

export function preauditsPerDay(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt((env.PREAUDITS_PER_DAY || "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PREAUDITS_PER_DAY;
  return Math.min(n, 20);
}

/** Approved, never contacted, no email, a phone, a website to check, and no fresh check yet. Highest fit first. Pure. */
export function pickPreauditTargets(rows: PreauditCandidate[], now: Date, limit: number, minFit = 65): PreauditCandidate[] {
  const fresh = now.getTime() - PREAUDIT_MAX_AGE_DAYS * 86_400_000;
  return rows
    .filter((p) => p.status === "reviewed" && (p.door || "aeo") === "aeo" && Number(p.fit_score || 0) >= minFit)
    .filter((p) => !p.signals?.outreach)
    .filter((p) => !/\S+@\S+\.\S+/.test(p.decision_maker?.email || ""))
    .filter((p) => (p.decision_maker?.phone || "").replace(/\D/g, "").length >= 8)
    .filter((p) => Boolean((p.website || "").trim()))
    .filter((p) => {
      const at = Date.parse(p.signals?.preaudit?.audited_at || "");
      return !Number.isFinite(at) || at < fresh;
    })
    .sort((a, b) => Number(b.fit_score || 0) - Number(a.fit_score || 0))
    .slice(0, Math.max(0, limit));
}

export interface PreauditPorts {
  list: () => Promise<PreauditCandidate[]>;
  audit: (p: { company: string; website: string; category: string; city: string }) => Promise<AuditSummary>;
  save: (id: string, summary: AuditSummary) => Promise<void>;
  now: () => Date;
  limit: number;
}

export interface PreauditRun {
  done: { company: string; mentions: number; total: number }[];
  failed: { company: string; error: string }[];
}

/** One daily run. A failed check is reported and skipped; it is tried again on a later day. */
export async function runPreaudits(ports: PreauditPorts): Promise<PreauditRun> {
  const out: PreauditRun = { done: [], failed: [] };
  const targets = pickPreauditTargets(await ports.list(), ports.now(), ports.limit);
  for (const p of targets) {
    try {
      const summary = await ports.audit({ company: p.company, website: String(p.website), category: p.category || "", city: p.city || "" });
      await ports.save(p.id, summary);
      out.done.push({ company: p.company, mentions: summary.mentions, total: summary.total_queries });
      await recordEvent({ agent: "outreach-sequencer", kind: "check", prospectId: p.id, summary: `Advance AI check for ${cleanBusinessName(p.company)}: named in ${summary.mentions} of ${summary.total_queries} answers.` });
    } catch (err) {
      out.failed.push({ company: p.company, error: (err as Error)?.message || String(err) });
    }
  }
  return out;
}

/** Real wiring: Supabase rows, the outreach audit, a read-modify-write of signals.preaudit. */
export async function runPreauditsLive(env: NodeJS.ProcessEnv = process.env): Promise<PreauditRun> {
  const { getSupabase } = await import("../prospect-researcher/db.js");
  const { runProspectAudit } = await import("./onepager.js");
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured");
  return runPreaudits({
    now: () => new Date(),
    limit: preauditsPerDay(env),
    async list() {
      const { data, error } = await sb
        .from("prospects")
        .select("id, company, website, city, category, status, door, fit_score, decision_maker, signals")
        .eq("tenant_id", "tgl")
        .eq("status", "reviewed")
        .is("deleted_at", null)
        .limit(2000);
      if (error) throw new Error(error.message);
      return (data || []) as PreauditCandidate[];
    },
    async audit(p) {
      return (await runProspectAudit(p)).summary;
    },
    async save(id, summary) {
      const { data, error } = await sb.from("prospects").select("signals").eq("id", id).eq("tenant_id", "tgl").single();
      if (error) throw new Error(`read before save failed: ${error.message}`);
      const signals = { ...((data as any)?.signals || {}), preaudit: summary };
      const upd = await sb.from("prospects").update({ signals }).eq("id", id).eq("tenant_id", "tgl");
      if (upd.error) throw new Error(`save failed: ${upd.error.message}`);
    },
  });
}
