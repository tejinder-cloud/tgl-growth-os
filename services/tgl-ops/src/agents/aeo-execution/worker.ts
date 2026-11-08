// WordPress (plan Days 28–29). Every 2 minutes newly saved connections are tested — MCP handshake + tool list — and
// marked connected or error, with what the token allows and the argument schemas of the tools we may use.
// Every minute the Implementer works the queue: drafts requested pages, and publishes drafts the customer approved.
import { isTestMode } from "../../config.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { McpClient, summariseTools, type McpTool } from "./mcp.js";
import { isAllowedTool } from "./safety.js";
import { argsFor, editLink, pageFromAsset, placeholders, postFields, toolPayload, type Schema } from "./implement.js";

export async function checkWordPressConnections(fetchImpl: typeof fetch = fetch): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const { data } = await sb.from("integrations").select("brand_id, status, config").eq("provider", "wordpress").in("status", ["pending", "connected"]);
  // Pending ones, plus connected ones checked before tool schemas were stored (Day 28 connections).
  const due = ((data ?? []) as any[]).filter((i) => i.status === "pending" || !i.config?.schemas);
  let n = 0;
  for (const i of due) {
    const { data: token } = await sb.rpc("svc_wp_token", { p_brand: i.brand_id });
    let patch: Record<string, unknown>;
    try {
      if (!token) throw new Error("no saved token");
      const c = new McpClient(i.config.endpoint, String(token), fetchImpl);
      const { server } = await c.connect();
      const tools = await c.tools();
      const s = summariseTools(tools);
      const schemas = Object.fromEntries(tools.filter((t) => isAllowedTool(t.name, t)).map((t) => [t.name, t.inputSchema ?? {}]));
      patch = { status: "connected", config: { ...i.config, server, tools: s.names, tool_count: s.total, can_write: s.canWrite, destructive_tools: s.destructive, schemas, tested_at: new Date().toISOString(), error: null } };
    } catch (err: any) {
      patch = { status: "error", config: { ...i.config, tested_at: new Date().toISOString(), error: String(err?.message ?? err).slice(0, 300) } };
    }
    await sb.from("integrations").update(patch).eq("brand_id", i.brand_id).eq("provider", "wordpress");
    n++;
  }
  return n;
}

/** Calls only allowlisted tools, with arguments mapped onto the tool's stored schema. */
class SiteTools {
  constructor(private c: McpClient, private schemas: Record<string, Schema>) {}
  has(name: string) { return name in this.schemas && isAllowedTool(name); }
  async call(name: string, values: Record<string, unknown>) {
    if (!isAllowedTool(name)) throw new Error(`${name} is not allowed`);
    if (!(name in this.schemas)) throw new Error(`${name} isn't available on this site`);
    return toolPayload(await this.c.call(name, argsFor(this.schemas[name], values)));
  }
}

type Action = { id: string; tenant_id: string; brand_id: string; recommendation_id: string | null; description: string; detail: any };

export async function runImplementer(fetchImpl: typeof fetch = fetch): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const { data } = await sb.from("actions").select("id, tenant_id, brand_id, recommendation_id, description, detail").eq("path", "wordpress").eq("status", "planned").order("created_at").limit(10);
  let n = 0;
  for (const a of (data ?? []) as Action[]) {
    // Claim it so two runs never work the same action.
    const { data: claimed } = await sb.from("actions").update({ status: "in_progress" }).eq("id", a.id).eq("status", "planned").select("id");
    if (!claimed?.length) continue;
    try {
      const { data: wp } = await sb.from("integrations").select("status, config").eq("brand_id", a.brand_id).eq("provider", "wordpress").maybeSingle();
      if (wp?.status !== "connected") throw new Error("WordPress isn't connected");
      const { data: token } = await sb.rpc("svc_wp_token", { p_brand: a.brand_id });
      if (!token) throw new Error("no saved token");
      const c = new McpClient(wp.config.endpoint, String(token), fetchImpl, 60_000);
      await c.connect();
      const site = new SiteTools(c, wp.config.schemas ?? {});
      const patch = a.detail?.step === "publish" ? await publish(site, a, wp.config.endpoint) : await draft(sb, site, a, wp.config.endpoint);
      await sb.from("actions").update({ ...patch, performed_at: new Date().toISOString() }).eq("id", a.id);
      if (patch.status === "done" && a.recommendation_id) await sb.from("recommendations").update({ status: "done" }).eq("id", a.recommendation_id);
    } catch (err: any) {
      await sb.from("actions").update({ status: "failed", performed_at: new Date().toISOString(), detail: { ...a.detail, error: String(err?.message ?? err).slice(0, 300) } }).eq("id", a.id);
    }
    n++;
  }
  return n;
}

async function draft(sb: any, site: SiteTools, a: Action, endpoint: string) {
  const { data: asset } = await sb.from("assets").select("kind, title, content").eq("id", a.detail?.asset_id).maybeSingle();
  if (!asset) throw new Error("asset not found");
  const page = pageFromAsset(asset);
  const res = postFields(await site.call("wp_create_page", { title: page.title, content: page.html, status: "draft", slug: page.slug }));
  if (!res.id) throw new Error("WordPress didn't return the new page's id");
  return {
    status: "in_progress",
    description: `Draft page: ${page.title}`,
    url: editLink(endpoint, res.id),
    detail: { ...a.detail, step: "awaiting_approval", wp_id: res.id, wp_type: "page", title: page.title, slug: page.slug ?? null, placeholders: page.placeholders, drafted_at: new Date().toISOString(), error: null },
  };
}

async function publish(site: SiteTools, a: Action, endpoint: string) {
  const id = Number(a.detail?.wp_id);
  if (!id) throw new Error("no draft to publish");
  // Never publish a page that still has fill-in-the-blanks: check what's in WordPress now, not what we drafted.
  // Fail safe: if the draft can't be read back, don't publish.
  if (!site.has("wp_get_page")) throw new Error("can't read the draft back from WordPress to check it, so it wasn't published");
  {
    const now = postFields(await site.call("wp_get_page", { id }));
    if (typeof now.content !== "string") throw new Error("couldn't read the draft's text back from WordPress, so it wasn't published");
    const left = placeholders(now.content);
    if (left.length) {
      return { status: "in_progress", url: editLink(endpoint, id), detail: { ...a.detail, step: "awaiting_approval", placeholders: left, blocked_at: new Date().toISOString() } };
    }
  }
  const res = postFields(await site.call("wp_update_page", { id, status: "publish" }));
  const live = res.link && !/preview=|page_id=/.test(res.link) ? res.link : `${new URL(endpoint).origin}/${a.detail?.slug ?? `?page_id=${id}`}`;
  return {
    status: "done",
    description: `Published page: ${a.detail?.title ?? a.description.replace(/^Draft page: /, "")}`,
    url: live,
    detail: { ...a.detail, step: "published", placeholders: [], published_at: new Date().toISOString(), error: null },
  };
}

export type { McpTool };
