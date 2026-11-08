// WordPress (plan Days 28–29). Every 2 minutes newly saved connections are tested — MCP handshake + tool list — and
// marked connected or error, with what the token allows and the argument schemas of the tools we may use.
// Every minute the Implementer works the queue: drafts requested pages, and publishes drafts the customer approved.
import { isTestMode } from "../../config.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { McpClient, summariseTools, type McpTool } from "./mcp.js";
import { checkCall, isAllowedTool, SCHEMA_VERSION } from "./safety.js";
import { argsFor, editLink, matchPage, metaValue, seoFields, pageFromAsset, pageList, parseMetaAsset, placeholders, postFields, publishAs, toolPayload, type Schema } from "./implement.js";

export async function checkWordPressConnections(fetchImpl: typeof fetch = fetch): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const { data } = await sb.from("integrations").select("brand_id, status, config").eq("provider", "wordpress").in("status", ["pending", "connected"]);
  // Pending ones, plus connected ones checked before tool schemas were stored (Day 28 connections).
  const due = ((data ?? []) as any[]).filter((i) => i.status === "pending" || !i.config?.schemas || (i.config?.schemas_v ?? 1) < SCHEMA_VERSION);
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
      patch = { status: "connected", config: { ...i.config, server, tools: s.names, tool_count: s.total, can_write: s.canWrite, destructive_tools: s.destructive, schemas, schemas_v: SCHEMA_VERSION, tested_at: new Date().toISOString(), error: null } };
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
    checkCall(name, values);
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
      // Use the site's tools as they are right now (a switch flipped in Easy MCP AI after the last check counts),
      // and keep the stored copy current for the Settings card.
      const tools = await c.tools();
      const schemas = Object.fromEntries(tools.filter((t) => isAllowedTool(t.name, t)).map((t) => [t.name, t.inputSchema ?? {}]));
      await sb.from("integrations").update({ config: { ...wp.config, schemas, schemas_v: SCHEMA_VERSION, tools: summariseTools(tools).names, tool_count: tools.length } }).eq("brand_id", a.brand_id).eq("provider", "wordpress");
      const site = new SiteTools(c, schemas);
      const isMeta = a.detail?.wp_type === "meta" || (await sb.from("assets").select("kind").eq("id", a.detail?.asset_id).maybeSingle()).data?.kind === "meta";
      const patch = isMeta
        ? (a.detail?.step === "publish" ? await applyMeta(site, a) : await planMeta(sb, site, a, wp.config.endpoint))
        : a.detail?.step === "publish" ? await publish(site, a, wp.config.endpoint) : await draft(sb, site, a, wp.config.endpoint);
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
  // Page or blog post: the customer's choice on the card, else the recommender's, else the rule.
  const type: "page" | "post" = a.detail?.wp_type === "post" || a.detail?.wp_type === "page" ? a.detail.wp_type
    : asset.content?.publish_as === "post" || asset.content?.publish_as === "page" ? asset.content.publish_as : publishAs({ title: asset.title, body: asset.content?.body ?? "" });
  const noun = type === "post" ? "blog post" : "page";
  const res = postFields(await site.call(`wp_create_${type}`, { title: page.title, content: page.html, status: "draft", slug: page.slug }));
  if (!res.id) throw new Error(`WordPress didn't return the new ${noun}'s id`);
  return {
    status: "in_progress",
    description: `Draft ${noun}: ${page.title}`,
    url: editLink(endpoint, res.id),
    detail: { ...a.detail, step: "awaiting_approval", wp_id: res.id, wp_type: type, title: page.title, slug: page.slug ?? null, placeholders: page.placeholders, drafted_at: new Date().toISOString(), error: null },
  };
}

async function publish(site: SiteTools, a: Action, endpoint: string) {
  const id = Number(a.detail?.wp_id);
  if (!id) throw new Error("no draft to publish");
  // Never publish a page that still has fill-in-the-blanks: check what's in WordPress now, not what we drafted.
  // Fail safe: if the draft can't be read back, don't publish.
  const type: "page" | "post" = a.detail?.wp_type === "post" ? "post" : "page";
  const noun = type === "post" ? "blog post" : "page";
  if (!site.has(`wp_get_${type}`)) throw new Error("can't read the draft back from WordPress to check it, so it wasn't published");
  {
    const now = postFields(await site.call(`wp_get_${type}`, { id }));
    if (typeof now.content !== "string") throw new Error("couldn't read the draft's text back from WordPress, so it wasn't published");
    const left = placeholders(now.content);
    if (left.length) {
      return { status: "in_progress", url: editLink(endpoint, id), detail: { ...a.detail, step: "awaiting_approval", placeholders: left, blocked_at: new Date().toISOString() } };
    }
  }
  const res = postFields(await site.call(`wp_update_${type}`, { id, status: "publish" }));
  const live = res.link && !/preview=|page_id=|[?&]p=/.test(res.link) ? res.link : `${new URL(endpoint).origin}/?${type === "post" ? "p" : "page_id"}=${id}`;
  return {
    status: "done",
    description: `Published ${noun}: ${a.detail?.title ?? a.description.replace(/^Draft (page|blog post): /, "")}`,
    url: live,
    detail: { ...a.detail, step: "published", placeholders: [], published_at: new Date().toISOString(), error: null },
  };
}

const RM_OFF = "TrueVisible can't see Easy MCP AI's Rank Math tool wp_rm_update_post_seo — in WordPress open Easy MCP AI → Tools, make sure it's enabled and saved, and that the connection's token has Write access; then try again";

type MetaChange = { label: string; page_id: number; page_title: string; link: string; field: "title" | "description"; key: string; old: string | null; new: string };

/** Meta titles/descriptions, step 1: find each page, read what's there now, and list the changes for approval. */
async function planMeta(sb: any, site: SiteTools, a: Action, endpoint: string) {
  const { data: asset } = await sb.from("assets").select("kind, title, content").eq("id", a.detail?.asset_id).maybeSingle();
  const pairs = parseMetaAsset(asset?.content?.body ?? "");
  if (!pairs.length) throw new Error("couldn't read any title/description pairs from the suggestion");
  const pages = pageList(await site.call("wp_list_pages", { per_page: 100, status: "publish" }));
  if (!pages.length) throw new Error("couldn't list the site's pages");
  const origin = new URL(endpoint).origin;
  const reader = site.has("wp_rm_get_post_seo") ? "wp_rm_get_post_seo" : site.has("wp_ability_rank_math_get_post_seo_meta") ? "wp_ability_rank_math_get_post_seo_meta" : null;
  if (!reader || !site.has("wp_rm_update_post_seo")) throw new Error(RM_OFF);
  const changes: MetaChange[] = []; const unmatched: string[] = [];
  for (const p of pairs) {
    const page = matchPage(p.label, pages, origin);
    if (!page) { unmatched.push(p.label); continue; }
    // A read error stops the plan: "couldn't read" must never be shown as "empty".
    const now = seoFields(await site.call(reader, { id: page.id }));
    for (const [field, key, value] of [["title", "rank_math_title", p.title], ["description", "rank_math_description", p.description]] as const) {
      if (!value) continue;
      if (placeholders(value).length) { unmatched.push(`${p.label} (${field} still has a fill-in)`); continue; }
      const old = now[field] || null;
      if (old?.trim() === value.trim()) continue;
      changes.push({ label: p.label, page_id: page.id, page_title: page.title, link: page.link, field, key, old, new: value });
    }
  }
  if (!changes.length) throw new Error(unmatched.length ? `couldn't match these to a page on your site: ${unmatched.join(", ")}` : "every page already has these titles and descriptions");
  const n = new Set(changes.map((c) => c.page_id)).size;
  return {
    status: "in_progress", url: null,
    description: `SEO titles & descriptions for ${n} page${n === 1 ? "" : "s"} (waiting for approval)`,
    detail: { ...a.detail, step: "awaiting_approval", wp_type: "meta", changes, unmatched, placeholders: placeholders(asset?.content?.body ?? ""), planned_at: new Date().toISOString(), error: null },
  };
}

/** Step 2, after approval: write each value through Rank Math's fields, read it back, keep the old values for undo. */
async function applyMeta(site: SiteTools, a: Action) {
  const changes = (a.detail?.changes ?? []) as MetaChange[];
  if (!changes.length) throw new Error("nothing to apply");
  if (!site.has("wp_rm_update_post_seo")) throw new Error(RM_OFF);
  const reader = site.has("wp_rm_get_post_seo") ? "wp_rm_get_post_seo" : "wp_ability_rank_math_get_post_seo_meta";
  const done: MetaChange[] = [];
  // One call per page with only the fields that change; then read back and compare.
  for (const pageId of [...new Set(changes.map((c) => c.page_id))]) {
    const mine = changes.filter((c) => c.page_id === pageId);
    const values: Record<string, unknown> = { id: pageId };
    for (const c of mine) values[c.field] = c.new;
    await site.call("wp_rm_update_post_seo", values);
    const back = site.has(reader) ? seoFields(await site.call(reader, { id: pageId })) : null;
    for (const c of mine) {
      const got = back?.[c.field];
      if (got != null && got.trim() !== c.new.trim()) throw new Error(`WordPress didn't keep the new ${c.field} for "${c.page_title}"`);
      done.push(c);
    }
  }
  const n = new Set(done.map((c) => c.page_id)).size;
  return {
    status: "done", url: done[0]?.link || null,
    description: `Updated SEO titles & descriptions on ${n} page${n === 1 ? "" : "s"}: ${[...new Set(done.map((c) => c.page_title))].join(", ").slice(0, 200)}`,
    detail: { ...a.detail, step: "published", applied: done.length, placeholders: [], published_at: new Date().toISOString(), error: null },
  };
}

export type { McpTool };
