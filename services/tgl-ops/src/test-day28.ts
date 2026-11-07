process.env.TGL_TEST_MODE = "1";
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { McpClient, parseMcpBody, summariseTools } from "./agents/aeo-execution/mcp.js";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }

async function main() {
await t("MCP replies: JSON or SSE (last JSON-RPC message wins)", () => {
  assert.deepEqual(parseMcpBody("application/json", '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}').result, { ok: true });
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n\n';
  assert.deepEqual(parseMcpBody("text/event-stream", sse).result, { tools: [] });
  assert.equal(parseMcpBody("application/json", "not json"), null);
});
await t("handshake keeps the session id, sends the bearer token, lists tools across pages", async () => {
  const seen: any[] = [];
  const f: any = async (_u: string, init: any) => {
    const b = JSON.parse(init.body); seen.push({ method: b.method, auth: init.headers.authorization, sid: init.headers["mcp-session-id"] });
    const h = { "content-type": "application/json", "mcp-session-id": "s1" };
    if (b.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { serverInfo: { name: "Easy MCP AI", version: "1.2" } } }), { headers: h });
    if (b.method === "notifications/initialized") return new Response(null, { status: 202, headers: h });
    if (b.method === "tools/list" && !b.params?.cursor) return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "wp_get_posts", annotations: { readOnlyHint: true } }], nextCursor: "p2" } }), { headers: h });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "wp_update_post", annotations: { readOnlyHint: false } }, { name: "wp_delete_post", annotations: { destructiveHint: true } }] } }), { headers: h });
  };
  const c = new McpClient("https://site.example/mcp", "tok_123", f);
  assert.deepEqual(await c.connect(), { server: "Easy MCP AI 1.2" });
  const tools = await c.tools();
  assert.equal(tools.length, 3);
  assert.equal(seen[0].auth, "Bearer tok_123");
  assert.equal(seen[2].sid, "s1");
  assert.deepEqual(summariseTools(tools), { total: 3, canWrite: true, destructive: 1, names: ["wp_get_posts", "wp_update_post", "wp_delete_post"] });
});
await t("a rejected token is reported as an auth problem", async () => {
  const c = new McpClient("https://site.example/mcp", "bad", (async () => new Response("", { status: 401 })) as any);
  await assert.rejects(c.connect(), (e: any) => e.auth === true && /check the token/.test(e.message));
});
console.log(`\nDay 28: ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
