// services/tgl-ops/src/agents/outreach-sequencer/reply.ts
// Inbound reply handling for POST /outreach/ghl-reply. Dependencies are injected via setOutreachReplyDeps()
// from the composition root; until they are set the route answers 503 (never silently drops a reply).

export type ReplyIntent = "opt_out" | "interested" | "question" | "neutral";

export interface InboundReply {
  contactId?: string;
  email?: string;
  phone?: string;
  body: string;
  channel?: string;
}

export interface OutreachReplyDeps {
  findProspect(c: { email?: string; phone?: string }): Promise<{ key: string; company: string } | null>;
  markReplied(key: string, intent: ReplyIntent, body: string): Promise<void>;
  notifySalesDesk(text: string): Promise<void>;
}

let replyDeps: OutreachReplyDeps | null = null;

export function setOutreachReplyDeps(deps: OutreachReplyDeps | null): void {
  replyDeps = deps;
}

export function getOutreachReplyDeps(): OutreachReplyDeps | null {
  return replyDeps;
}

export function classifyReply(text: string): ReplyIntent {
  const t = text.toLowerCase();
  if (/\b(stop|unsubscribe|opt[ -]?out|remove me|do not (contact|message)|not interested|no thanks)\b/.test(t) || t.trim() === "no") {
    return "opt_out";
  }
  if (/\b(yes|interested|call me|let'?s talk|book|schedule|send (it|details)|walk me through|sounds good|price|pricing|cost)\b/.test(t)) {
    return "interested";
  }
  if (t.includes("?")) return "question";
  return "neutral";
}

/** Normalises the GHL inbound-message webhook shape (flat, or nested under message/contact). */
export function parseGhlInbound(payload: any): InboundReply | null {
  if (!payload || typeof payload !== "object") return null;
  const direction = String(payload.direction || payload.message?.direction || "inbound").toLowerCase();
  if (direction !== "inbound") return null;
  const body = String(payload.body ?? payload.message?.body ?? payload.message ?? "").trim();
  if (!body) return null;
  return {
    contactId: payload.contactId || payload.contact_id || payload.contact?.id,
    email: payload.email || payload.contact?.email || undefined,
    phone: payload.phone || payload.contact?.phone || undefined,
    body,
    channel: payload.messageType || payload.type || undefined,
  };
}

export async function handleInboundReply(
  reply: InboundReply
): Promise<{ status: number; body: Record<string, unknown> }> {
  const deps = replyDeps;
  if (!deps) return { status: 503, body: { ok: false, error: "Outreach reply dependencies are not wired" } };

  const intent = classifyReply(reply.body);
  const prospect = await deps.findProspect({ email: reply.email, phone: reply.phone });
  const snippet = reply.body.replace(/\s+/g, " ").slice(0, 300);

  if (!prospect) {
    await deps.notifySalesDesk(
      `*Outreach reply from an unmatched contact* (${reply.email || reply.phone || reply.contactId || "unknown"})\nIntent: ${intent}\n> ${snippet}`
    );
    return { status: 202, body: { ok: true, matched: false, intent } };
  }

  await deps.markReplied(prospect.key, intent, reply.body);
  await deps.notifySalesDesk(
    `*Outreach reply from ${prospect.company}*\nIntent: ${intent}. Sequence paused.\n> ${snippet}`
  );
  return { status: 200, body: { ok: true, matched: true, intent } };
}
