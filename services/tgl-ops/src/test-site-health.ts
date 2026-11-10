process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { blockedBots, checkSite, issuesFrom, robotsDirectives } from "./agents/aeo-site-health/check.js";
import { isAllowedTool } from "./agents/aeo-execution/safety.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }
async function main() {
await t("robots meta and header read; TGL's 8 Nov page flagged critical", () => {
  const tgl = `<head><meta name='robots' content='noindex, nofollow' /><meta name="description" content="x"></head>`;
  assert.deepEqual(robotsDirectives(tgl, null), ["noindex", "nofollow"]);
  assert.deepEqual(robotsDirectives(`<meta content="index, follow, max-snippet:-1" name="robots">`, "googlebot: noarchive"), ["index", "follow", "max-snippet:-1", "noarchive"]);
  const i = issuesFrom({ status: 200, error: null, directives: ["noindex", "nofollow"], blocked: [] });
  assert.deepEqual(i.map((x) => [x.code, x.severity]), [["noindex", "critical"]]);
  assert.deepEqual(issuesFrom({ status: 200, error: null, directives: ["index", "follow"], blocked: [] }), []);
});
await t("robots.txt: whole-site blocks per crawler, wildcard fallback, WordPress default is fine", () => {
  assert.deepEqual(blockedBots("User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nSitemap: x"), []);
  assert.deepEqual(blockedBots("User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:"), ["GPTBot"]);
  assert.deepEqual(blockedBots("User-agent: *\nDisallow: /"), ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Google-Extended", "Bingbot", "Googlebot"]);
  const i = issuesFrom({ status: 200, error: null, directives: [], blocked: ["GPTBot", "Googlebot"] });
  assert.deepEqual(i.map((x) => [x.code, x.severity]), [["robots_search", "critical"], ["robots_ai", "warning"]]);
});
await t("unreachable and error pages are critical", async () => {
  const r = await checkSite("example.test", (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as any);
  assert.equal(r.issues[0].code, "unreachable");
  const e = await checkSite("example.test", (async (u: string) => new Response(u.endsWith("robots.txt") ? "" : "<html></html>", { status: u.endsWith("robots.txt") ? 404 : 503 })) as any);
  assert.deepEqual(e.issues.map((x) => x.code), ["http_error"]);
});
await t("cache clearing allowed; deletes still refused", () => {
  assert.equal(isAllowedTool("wp_clear_cache"), true);
  assert.equal(isAllowedTool("wp_delete_post"), false);
});
console.log(`\nSite health: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
