// Minimal MCP client over Streamable HTTP (JSON-RPC 2.0; replies as JSON or SSE). Used for the customer's
// WordPress site through the Easy MCP AI plugin (SPEC §7, plan Day 28). Bearer token from Supabase Vault.

export type McpTool = { name: string; description?: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };

/** Body of an MCP reply: plain JSON, or the last JSON-RPC message in an SSE stream (pure; tested). */
export function parseMcpBody(contentType: string, text: string): any {
  if (contentType.includes("text/event-stream")) {
    const msgs = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean)
      .map((d) => { try { return JSON.parse(d); } catch { return null; } }).filter((m) => m && (m.result !== undefined || m.error !== undefined));
    return msgs[msgs.length - 1] ?? null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

export class McpClient {
  private session: string | null = null;
  private id = 0;
  constructor(private endpoint: string, private token: string, private fetchImpl: typeof fetch = fetch, private timeoutMs = 20_000) {}

  private async rpc(method: string, params?: unknown, notify = false): Promise<any> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (this.session) headers["mcp-session-id"] = this.session;
    const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++this.id, method, params };
    const res = await this.fetchImpl(this.endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`not authorised (HTTP ${res.status}) — check the token`), { auth: true });
    if (notify) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${method}`);
    const msg = parseMcpBody(res.headers.get("content-type") ?? "", await res.text());
    if (!msg) throw new Error(`no reply to ${method}`);
    if (msg.error) throw new Error(`${method}: ${msg.error.message ?? "error"}`);
    return msg.result;
  }

  async connect(): Promise<{ server: string }> {
    const r = await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "TrueVisible", version: "1.0" } });
    await this.rpc("notifications/initialized", undefined, true).catch(() => {});
    return { server: `${r?.serverInfo?.name ?? "MCP server"}${r?.serverInfo?.version ? ` ${r.serverInfo.version}` : ""}` };
  }
  async tools(): Promise<McpTool[]> {
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const r = await this.rpc("tools/list", cursor ? { cursor } : {});
      out.push(...(r?.tools ?? []));
      cursor = r?.nextCursor; if (!cursor) break;
    }
    return out;
  }
  async call(name: string, args: Record<string, unknown>): Promise<any> {
    return this.rpc("tools/call", { name, arguments: args });
  }
}

/** What the token allows, in plain words (pure; tested). */
export function summariseTools(tools: McpTool[]): { total: number; canWrite: boolean; destructive: number; names: string[] } {
  const write = tools.filter((t) => t.annotations?.readOnlyHint === false || (!t.annotations?.readOnlyHint && /create|update|edit|insert|publish|set|save/i.test(t.name)));
  return { total: tools.length, canWrite: write.length > 0, destructive: tools.filter((t) => t.annotations?.destructiveHint).length, names: tools.map((t) => t.name).slice(0, 60) };
}
