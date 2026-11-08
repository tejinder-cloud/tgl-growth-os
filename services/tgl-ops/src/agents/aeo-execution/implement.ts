// Turning an approved asset into WordPress tool calls (pure parts; tested). Arguments are mapped onto each tool's own
// input schema, stored by the connection check, so plugin versions that name fields differently still work.
import { marked } from "marked";

export type Schema = { properties?: Record<string, unknown>; required?: string[] };

/** Text the recommender left for the customer to fill in — a page with these is never published. */
export const PLACEHOLDER = /\[(?:add|confirm|insert|your|todo|fill)[^\]\n]{0,120}\]/gi;
export const placeholders = (s: string) => Array.from(new Set(s.match(PLACEHOLDER) ?? []));

/** A page draft from a Markdown asset: H1 becomes the page title, a "/slug" asset title becomes the slug. */
export function pageFromAsset(asset: { title: string; content: { format?: string; body?: string } | null }): { title: string; slug?: string; html: string; placeholders: string[] } {
  const body = (asset.content?.body ?? "").replace(/\r/g, "").trim();
  if (!body) throw new Error("asset has no content");
  const h1 = body.match(/^#\s+(.+)$/m);
  const title = (h1?.[1] ?? asset.title.replace(/^\//, "").replace(/[-_]+/g, " ")).trim().slice(0, 200);
  const rest = h1 ? body.replace(h1[0], "").trim() : body;
  const slugSrc = asset.title.trim().match(/^\/([a-z0-9][a-z0-9\-/]*)$/i)?.[1];
  const html = (marked.parse(rest, { async: false, gfm: true }) as string).trim();
  return { title, slug: slugSrc ? slugSrc.toLowerCase().replace(/\/+$/, "").split("/").pop() : undefined, html, placeholders: placeholders(body) };
}

const ALIASES: Record<string, string[]> = {
  id: ["id", "post_id", "page_id", "ID"], title: ["title", "post_title"], content: ["content", "post_content", "body"],
  status: ["status", "post_status"], slug: ["slug", "post_name", "name"],
};
/** Map our values onto the tool's argument names; fail loudly if a required argument can't be filled. */
export function argsFor(schema: Schema | undefined, values: Record<string, unknown>): Record<string, unknown> {
  const props = Object.keys(schema?.properties ?? {});
  if (!props.length) return values; // no schema stored: send our names as they are
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    const name = (ALIASES[k] ?? [k]).find((a) => props.includes(a));
    if (name) out[name] = v;
  }
  const missing = (schema?.required ?? []).filter((r) => !(r in out));
  if (missing.length) throw new Error(`tool needs ${missing.join(", ")}`);
  return out;
}

/** Read an MCP tools/call result: structured content, or JSON inside the first text block, or the text itself. */
export function toolPayload(result: any): any {
  if (result?.isError) {
    const msg = result?.content?.find?.((c: any) => c?.type === "text")?.text ?? "tool error";
    throw new Error(String(msg).slice(0, 300));
  }
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find?.((c: any) => c?.type === "text")?.text;
  if (typeof text !== "string") return result;
  try { return JSON.parse(text); } catch { return text; }
}

/** The post id, link, status and raw content from whatever shape the plugin returns (searches two levels deep). */
export function postFields(p: any): { id?: number; link?: string; status?: string; content?: string } {
  const flat = [p, ...(p && typeof p === "object" ? Object.values(p).filter((v) => v && typeof v === "object") : [])];
  const pick = (keys: string[]) => { for (const o of flat) for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) return o[k]; return undefined; };
  const id = Number(pick(["id", "ID", "post_id", "page_id"]));
  const link = pick(["link", "permalink", "url", "guid"]);
  const content = pick(["content", "post_content"]);
  return {
    id: Number.isFinite(id) && id > 0 ? id : undefined,
    link: typeof link === "string" ? link : typeof link?.rendered === "string" ? link.rendered : undefined,
    status: pick(["status", "post_status"]),
    content: typeof content === "string" ? content : content?.raw ?? content?.rendered,
  };
}

export const editLink = (endpoint: string, id: number) => `${new URL(endpoint).origin}/wp-admin/post.php?post=${id}&action=edit`;
export const previewLink = (endpoint: string, id: number) => `${new URL(endpoint).origin}/?page_id=${id}&preview=true`;

/** Page or blog post, when the recommender didn't say (pure; tested; same rule as the app's lib/execution.ts).
 *  A heading that asks or explains (what/why/how…, "?", guide, vs) reads as a blog article; anything else — a service,
 *  industry, location or hub — is a page that belongs in the menu. */
export function publishAs(a: { title: string; body: string }): "page" | "post" {
  const h1 = (a.body.match(/^#\s+(.+)$/m)?.[1] ?? a.title.replace(/^\//, "").replace(/[-_]+/g, " ")).trim();
  if (/\b(hub|services?|pricing|case[- ]studies|about|contact|industr(y|ies)|locations?)\b/i.test(a.title)) return "page";
  return /^(what|why|how|when|which|who|is|are|can|should|does|do|will)\b/i.test(h1) || /\?\s*$/.test(h1) || /\b(guide|vs\.?|versus|explained|checklist|tips)\b/i.test(h1) ? "post" : "page";
}
