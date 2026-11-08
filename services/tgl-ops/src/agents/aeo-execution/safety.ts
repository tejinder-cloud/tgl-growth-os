// The Implementer's hard limits (plan Day 29). Whatever the customer's token allows, TrueVisible only reads, creates
// and updates posts and pages, and reads site info and Rank Math settings. It never deletes, trashes or removes.
import type { McpTool } from "./mcp.js";

const ALLOW = [
  /^wp_(get|list|search|create|update)_(post|page)s?$/,
  /^wp_ability_core_get_site_info$/,
  /^wp_ability_rank_math_get_[a-z_]+$/,
  /^wp_(get|update)_post_meta$/,
];
/** Post meta the Implementer may write: Rank Math's SEO title and meta description, nothing else. */
export const WRITABLE_META = new Set(["rank_math_title", "rank_math_description"]);
/** Bumped when the allowlist grows, so connections are re-checked and the new tools' schemas stored. */
export const SCHEMA_VERSION = 2;
const DENY = /(delete|trash|remove|destroy|purge|empty|reset|deactivate|uninstall)/i;

/** Per-call limits on top of the allowlist. */
export function checkCall(name: string, values: Record<string, unknown>): void {
  if (name === "wp_update_post_meta") {
    const keys = values.meta && typeof values.meta === "object" ? Object.keys(values.meta as object) : [String(values.key ?? "")];
    const bad = keys.filter((k) => !WRITABLE_META.has(k));
    if (!keys.length || bad.length) throw new Error(`writing post meta "${bad.join(", ") || "(none)"}" is not allowed`);
  }
}

export function isAllowedTool(name: string, tool?: Pick<McpTool, "annotations">): boolean {
  if (DENY.test(name) || tool?.annotations?.destructiveHint) return false;
  return ALLOW.some((r) => r.test(name));
}
