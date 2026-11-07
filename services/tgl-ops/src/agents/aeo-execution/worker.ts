// WordPress connection check (plan Day 28): every 2 minutes, newly saved connections are tested — MCP handshake +
// tool list — and marked connected or error, with what the token allows. The Implementer uses them (Day 29).
import { isTestMode } from "../../config.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { McpClient, summariseTools } from "./mcp.js";

export async function checkWordPressConnections(fetchImpl: typeof fetch = fetch): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const { data } = await sb.from("integrations").select("brand_id, config").eq("provider", "wordpress").eq("status", "pending");
  let n = 0;
  for (const i of (data ?? []) as any[]) {
    const { data: token } = await sb.rpc("svc_wp_token", { p_brand: i.brand_id });
    let patch: Record<string, unknown>;
    try {
      if (!token) throw new Error("no saved token");
      const c = new McpClient(i.config.endpoint, String(token), fetchImpl);
      const { server } = await c.connect();
      const s = summariseTools(await c.tools());
      patch = { status: "connected", config: { ...i.config, server, tools: s.names, tool_count: s.total, can_write: s.canWrite, destructive_tools: s.destructive, tested_at: new Date().toISOString(), error: null } };
    } catch (err: any) {
      patch = { status: "error", config: { ...i.config, tested_at: new Date().toISOString(), error: String(err?.message ?? err).slice(0, 300) } };
    }
    await sb.from("integrations").update(patch).eq("brand_id", i.brand_id).eq("provider", "wordpress");
    n++;
  }
  return n;
}
