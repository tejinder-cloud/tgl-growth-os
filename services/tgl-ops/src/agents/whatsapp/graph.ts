// services/tgl-ops/src/agents/whatsapp/graph.ts
// The WhatsApp Cloud API calls behind the private WhatsApp screen: list accounts and numbers, list and create
// message templates, and send one template message. Every result is what Meta answered; nothing is assumed.
import { getSupabase } from "../prospect-researcher/db.js";

export interface WaContext {
  token: string;
  businessId: string;
  graph: string;
  fetchImpl: typeof fetch;
}

/** The system user token if set (works before App Review for TGL's own assets), else the coexistence token. */
export async function resolveToken(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const sys = (env.WHATSAPP_SYSTEM_TOKEN || "").trim();
  if (sys) return sys;
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.rpc("svc_whatsapp_token");
  return data ? String(data) : null;
}

export function waContext(token: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): WaContext {
  return {
    token,
    businessId: (env.META_BUSINESS_ID || "1754417344686245").trim(),
    graph: `https://graph.facebook.com/${(env.META_GRAPH_VERSION || "v23.0").trim()}`,
    fetchImpl,
  };
}

export class MetaError extends Error {
  constructor(message: string, public status: number, public code?: number) {
    super(message);
  }
}

async function call(ctx: WaContext, path: string, init?: { method?: string; body?: unknown }): Promise<any> {
  const res = await ctx.fetchImpl(`${ctx.graph}${path}`, {
    method: init?.method || "GET",
    headers: { Authorization: `Bearer ${ctx.token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const e = body?.error || {};
    throw new MetaError(e.error_user_msg || e.message || `Meta answered ${res.status}`, res.status, e.code);
  }
  return body;
}

export interface WaAccount {
  id: string;
  name: string;
  numbers: { id: string; display: string; name?: string; quality?: string }[];
}

/** What Meta answered to each lookup, so a refusal is visible on the screen. Never contains the token. */
export type LookupNote = { call: string; ok: boolean; detail: string };

/** One WhatsApp account by its id, with its numbers. For accounts Meta does not list under the business. */
export async function accountById(ctx: WaContext, id: string): Promise<WaAccount> {
  const a = await call(ctx, `/${id}?fields=id,name`);
  const r = await call(ctx, `/${id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`);
  return {
    id: String(a.id || id),
    name: String(a.name || id),
    numbers: (r.data || []).map((n: any) => ({ id: String(n.id), display: String(n.display_phone_number || ""), name: n.verified_name, quality: n.quality_rating })),
  };
}

export async function listAccounts(ctx: WaContext, notes: LookupNote[] = []): Promise<WaAccount[]> {
  const seen = new Map<string, WaAccount>();
  const note = (call: string, ok: boolean, detail: string) => notes.push({ call, ok, detail: detail.slice(0, 300) });
  const msg = (e: unknown) => (e as Error)?.message || String(e);
  for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
    try {
      const r = await call(ctx, `/${ctx.businessId}/${edge}?fields=id,name&limit=50`);
      for (const a of r.data || []) if (!seen.has(a.id)) seen.set(a.id, { id: String(a.id), name: String(a.name || a.id), numbers: [] });
      note(edge, true, `${(r.data || []).length} account(s)`);
    } catch (e) {
      // the token may lack business_management; the token's own grants below still list its accounts
      note(edge, false, msg(e));
    }
  }
  // Accounts granted to this token (system user assets, Embedded Signup), however the business owns them.
  // Meta lists them on debug_token as the target ids of the WhatsApp scopes.
  try {
    const dbg = await call(ctx, `/debug_token?input_token=${encodeURIComponent(ctx.token)}`);
    const ids = new Set<string>();
    const scopes: string[] = [];
    for (const g of dbg?.data?.granular_scopes || []) {
      scopes.push(`${g.scope}${g.target_ids ? `(${(g.target_ids as unknown[]).length})` : ""}`);
      if (String(g.scope || "").startsWith("whatsapp_business")) for (const id of g.target_ids || []) ids.add(String(id));
    }
    note("token grants", true, `${dbg?.data?.is_valid === false ? "token NOT valid; " : ""}scopes: ${scopes.join(", ") || "none"}; WhatsApp account ids: ${[...ids].join(", ") || "none"}`);
    for (const id of ids) {
      if (seen.has(id)) continue;
      try {
        const a = await call(ctx, `/${id}?fields=id,name`);
        seen.set(id, { id, name: String(a.name || id), numbers: [] });
      } catch {
        seen.set(id, { id, name: id, numbers: [] });
      }
    }
  } catch (e) {
    note("token grants", false, msg(e));
  }
  for (const a of seen.values()) {
    try {
      const r = await call(ctx, `/${a.id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`);
      a.numbers = (r.data || []).map((n: any) => ({ id: String(n.id), display: String(n.display_phone_number || ""), name: n.verified_name, quality: n.quality_rating }));
    } catch (e) {
      a.numbers = [];
      note(`numbers of ${a.id}`, false, msg(e));
    }
  }
  return [...seen.values()];
}

export interface TemplateRow {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  body: string;
  placeholders: number;
}

export function placeholderCount(body: string): number {
  const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

export async function listTemplates(ctx: WaContext, wabaId: string): Promise<TemplateRow[]> {
  const r = await call(ctx, `/${wabaId}/message_templates?fields=id,name,status,category,language,components&limit=100`);
  return (r.data || []).map((t: any) => {
    const body = String((t.components || []).find((c: any) => c.type === "BODY")?.text || "");
    return { id: String(t.id), name: String(t.name), status: String(t.status), category: String(t.category), language: String(t.language), body, placeholders: placeholderCount(body) };
  });
}

export interface NewTemplate {
  name: string;
  category: "MARKETING" | "UTILITY";
  language: string;
  body: string;
  examples: string[];
  footer?: string;
  quickReplies?: string[];
}

export function validateTemplate(t: NewTemplate): string | null {
  if (!/^[a-z0-9_]{1,512}$/.test(t.name)) return "Name: lowercase letters, numbers and underscores only.";
  if (t.category !== "MARKETING" && t.category !== "UTILITY") return "Category must be Marketing or Utility.";
  if (!t.body.trim() || t.body.length > 1024) return "Body is required, up to 1024 characters.";
  const n = placeholderCount(t.body);
  if (t.examples.length < n || t.examples.slice(0, n).some((e) => !e.trim())) return `Give an example for each of the ${n} placeholders.`;
  if (t.footer && t.footer.length > 60) return "Footer: up to 60 characters.";
  if ((t.quickReplies || []).some((q) => !q.trim() || q.length > 25)) return "Each button: 1 to 25 characters.";
  return null;
}

export async function createTemplate(ctx: WaContext, wabaId: string, t: NewTemplate): Promise<{ id: string; status: string; category: string }> {
  const n = placeholderCount(t.body);
  const components: any[] = [{ type: "BODY", text: t.body, ...(n ? { example: { body_text: [t.examples.slice(0, n)] } } : {}) }];
  if (t.footer) components.push({ type: "FOOTER", text: t.footer });
  if (t.quickReplies?.length) components.push({ type: "BUTTONS", buttons: t.quickReplies.map((q) => ({ type: "QUICK_REPLY", text: q })) });
  const r = await call(ctx, `/${wabaId}/message_templates`, { method: "POST", body: { name: t.name, category: t.category, language: t.language, components } });
  return { id: String(r.id), status: String(r.status || "PENDING"), category: String(r.category || t.category) };
}

export function normaliseIndianOrE164(raw: string): string | null {
  const d = raw.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(d)) return d.slice(1);
  if (/^\d{10}$/.test(d)) return `91${d}`;
  if (/^91\d{10}$/.test(d)) return d;
  return null;
}

export async function sendTemplate(ctx: WaContext, phoneNumberId: string, to: string, template: { name: string; language: string }, values: string[]): Promise<{ messageId: string; waId?: string }> {
  const body: any = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: { name: template.name, language: { code: template.language } },
  };
  if (values.length) body.template.components = [{ type: "body", parameters: values.map((v) => ({ type: "text", text: v })) }];
  const r = await call(ctx, `/${phoneNumberId}/messages`, { method: "POST", body });
  return { messageId: String(r.messages?.[0]?.id || ""), waId: r.contacts?.[0]?.wa_id };
}
