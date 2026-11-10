// Is the brand's website hidden from search engines or AI crawlers? (found on TGL's own site, 8 Nov 2026).
// Pure parts tested: reading robots meta / X-Robots-Tag / robots.txt into plain-words issues.

export type Issue = { code: string; severity: "critical" | "warning"; text: string };
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Google-Extended", "Bingbot", "Googlebot"];

/** Robots directives from the page's meta tags (robots / googlebot) and the X-Robots-Tag header. */
export function robotsDirectives(html: string, header: string | null): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = /\bname\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    if (name !== "robots" && name !== "googlebot" && name !== "bingbot") continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    out.push(...content.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean));
  }
  if (header) out.push(...header.toLowerCase().split(",").map((s) => s.trim().replace(/^[a-z-]+:\s*/, "")).filter(Boolean));
  return [...new Set(out)];
}

/** Which crawlers robots.txt shuts out of the whole site ("Disallow: /"). */
export function blockedBots(robotsTxt: string): string[] {
  const groups: { agents: string[]; rules: string[] }[] = [];
  let cur: { agents: string[]; rules: string[] } | null = null;
  for (const raw of robotsTxt.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^(user-agent|disallow|allow)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(val.toLowerCase()); }
    else if (cur) cur.rules.push(`${key}:${val}`);
  }
  const blocksAll = (g: { rules: string[] }) => g.rules.includes("disallow:/") && !g.rules.some((r) => r === "allow:/");
  const forBot = (bot: string) => groups.find((g) => g.agents.includes(bot.toLowerCase())) ?? groups.find((g) => g.agents.includes("*"));
  return AI_BOTS.filter((b) => { const g = forBot(b); return !!g && blocksAll(g); });
}

export function issuesFrom(o: { status: number | null; error: string | null; directives: string[]; blocked: string[] }): Issue[] {
  const out: Issue[] = [];
  if (o.error || o.status === null) out.push({ code: "unreachable", severity: "critical", text: `Your homepage couldn't be opened (${o.error ?? "no response"}). AI assistants and search engines can't read a site they can't reach.` });
  else if (o.status >= 400) out.push({ code: "http_error", severity: "critical", text: `Your homepage returns an error (HTTP ${o.status}). AI assistants and search engines skip pages that error.` });
  if (o.directives.includes("noindex") || o.directives.includes("none"))
    out.push({ code: "noindex", severity: "critical", text: "Your website tells search engines not to index it (noindex). Google, Bing — and the AI assistants that rely on them — leave it out of results." });
  else if (o.directives.includes("nofollow")) out.push({ code: "nofollow", severity: "warning", text: "Your homepage tells search engines not to follow its links (nofollow), so your other pages are harder to find." });
  const search = o.blocked.filter((b) => b === "Googlebot" || b === "Bingbot");
  const ai = o.blocked.filter((b) => !["Googlebot", "Bingbot"].includes(b));
  if (search.length) out.push({ code: "robots_search", severity: "critical", text: `Your robots.txt blocks ${search.join(" and ")} from the whole site.` });
  if (ai.length) out.push({ code: "robots_ai", severity: "warning", text: `Your robots.txt blocks AI crawlers from the whole site: ${ai.join(", ")}.` });
  return out;
}

export async function checkSite(domain: string, fetchImpl: typeof fetch = fetch) {
  const ua = { "user-agent": "Mozilla/5.0 (compatible; TrueVisibleSiteCheck/1.0; +https://thegrowthlab.co.in)" };
  let status: number | null = null, error: string | null = null, directives: string[] = [], blocked: string[] = [];
  try {
    const res = await fetchImpl(`https://${domain}/?tv_check=${Date.now()}`, { redirect: "follow", headers: ua, signal: AbortSignal.timeout(20_000) });
    status = res.status;
    directives = robotsDirectives(await res.text(), res.headers.get("x-robots-tag"));
  } catch (e: any) { error = String(e?.message ?? e).slice(0, 120); }
  try {
    const r = await fetchImpl(`https://${domain}/robots.txt`, { redirect: "follow", headers: ua, signal: AbortSignal.timeout(15_000) });
    if (r.ok) blocked = blockedBots(await r.text());
  } catch { /* no robots.txt is fine */ }
  return { status, directives, blocked, issues: issuesFrom({ status, error, directives, blocked }) };
}
