// services/tgl-ops/src/agents/outreach-sequencer/guard.ts
// The last check before an outreach email is sent (21 Nov 2026, after two emails named places as competitors).
// Every "<name> was/is named" in the message must be the prospect or a name that reads as a business, and every
// "named in N of M" must match the prospect's own audit. A message that fails is held, never sent.
import { isQuotableCompetitor } from "./competitors.js";
import { cleanBusinessName } from "./names.js";
import type { AuditSummary } from "./types.js";

function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function checkMessage(text: string, ctx: { company: string; city: string; audit?: AuditSummary }): string[] {
  const problems: string[] = [];
  const own = new Set([norm(ctx.company), norm(cleanBusinessName(ctx.company))]);
  const a = ctx.audit;
  // "<Name> was named in 3 of 15 answers." / "<Name> is named there" / "<Name> was named in 12."
  const re = /(?:^|[.!?:,]\s+|\n)([A-Z][^.!?\n,]{1,80}?) (?:was|is) named\b( in (\d+)(?: of (\d+))?)?/g;
  for (const m of text.matchAll(re)) {
    const subject = m[1].trim();
    const isOwn = own.has(norm(subject));
    if (!isOwn && !isQuotableCompetitor(subject, ctx)) {
      problems.push(`"${subject}" is presented as a business but does not read as one`);
      continue;
    }
    if (m[3] !== undefined) {
      const n = Number(m[3]);
      if (m[4] !== undefined && a && Number(m[4]) !== a.total_queries) problems.push(`"of ${m[4]}" does not match the ${a.total_queries} answers in the audit`);
      if (a && isOwn && n !== a.mentions) problems.push(`${subject} named in ${n}, the audit says ${a.mentions}`);
      if (a && !isOwn) {
        const counted = a.competitor_mentions?.[subject];
        if (counted === undefined || counted !== n) problems.push(`${subject} named in ${n}, the audit says ${counted ?? "nothing"}`);
      }
    }
  }
  return problems;
}
