// The Implementer's hard limits (plan Day 29). Whatever the customer's token allows, TrueVisible only reads, creates
// and updates posts and pages, and reads site info and Rank Math settings. It never deletes, trashes or removes.
import type { McpTool } from "./mcp.js";

const ALLOW = [
  /^wp_(get|list|search|create|update)_(post|page)s?$/,
  /^wp_ability_core_get_site_info$/,
  /^wp_ability_rank_math_get_[a-z_]+$/,
];
const DENY = /(delete|trash|remove|destroy|purge|empty|reset|deactivate|uninstall)/i;

export function isAllowedTool(name: string, tool?: Pick<McpTool, "annotations">): boolean {
  if (DENY.test(name) || tool?.annotations?.destructiveHint) return false;
  return ALLOW.some((r) => r.test(name));
}
