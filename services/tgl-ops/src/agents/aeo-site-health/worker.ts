// Every 6 hours: each verified brand's homepage and robots.txt are checked (plan follow-up, 10 Nov 2026). A new
// critical problem (noindex, site unreachable, search engines blocked) → red banner on every dashboard tab, an email
// to the workspace owners and a line in #doors-aeo. Fixed → the banner goes on the next check.
import { config, isTestMode } from "../../config.js";
import { slackClient } from "../../lib/slack-client.js";
import { resolveChannelId } from "../../lib/post.js";
import { getSupabase } from "../prospect-researcher/db.js";
import { sendEmail } from "../aeo-reports/worker.js";
import { render } from "../aeo-reports/email.js";
import { checkSite, type Issue } from "./check.js";

const FIX: Record<string, string> = {
  wordpress: "In WordPress go to Settings → Reading and untick “Discourage search engines from indexing this site”; if you use Rank Math or Yoast, check its Titles & Meta / Search Appearance settings too.",
  shopify: "In Shopify, remove the password page (Online Store → Preferences) and any app that adds noindex.",
  wix: "In Wix, open SEO Settings and turn on “Let search engines index your site”.",
  squarespace: "In Squarespace, Settings → SEO: make sure the site isn't hidden from search engines.",
  webflow: "In Webflow, Site settings → SEO: turn off “Disable Webflow subdomain indexing” only for the staging domain, and check page-level noindex.",
};
export const fixFor = (platform: string | null) => FIX[platform ?? ""] ?? "Ask whoever manages your website to remove the noindex setting from your pages.";

export async function runSiteHealth(now = Date.now()): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const { data: brands } = await sb.from("brands").select("id, tenant_id, name, primary_domain, site_platform").eq("setup_status", "verified").not("primary_domain", "is", null);
  let n = 0;
  for (const b of (brands ?? []) as any[]) {
    const { data: last } = await sb.from("site_checks").select("checked_at, issues").eq("brand_id", b.id).order("checked_at", { ascending: false }).limit(1).maybeSingle();
    if (last && now - Date.parse(last.checked_at) < 5.5 * 3600_000) continue;
    const r = await checkSite(b.primary_domain);
    await sb.from("site_checks").insert({ tenant_id: b.tenant_id, brand_id: b.id, domain: b.primary_domain, http_status: r.status, directives: r.directives, blocked_bots: r.blocked, issues: r.issues });
    n++;
    const before = new Set(((last?.issues ?? []) as Issue[]).filter((i) => i.severity === "critical").map((i) => i.code));
    const fresh = r.issues.filter((i) => i.severity === "critical" && !before.has(i.code));
    if (!fresh.length) continue;
    const channel = (await resolveChannelId("#doors-aeo")) || config.approvalsChannelId;
    if (config.slackBotToken && channel) await slackClient.chat.postMessage({ channel, text: `🚨 *${b.name}* (${b.primary_domain}) — ${fresh.map((i) => i.text).join(" ")}` }).catch(() => {});
    const { data: t } = await sb.from("tenants").select("kind").eq("id", b.tenant_id).maybeSingle();
    const appUrl = process.env.TRUEVISIBLE_APP_URL?.trim().replace(/\/$/, "");
    if (t?.kind === "agency_client" || !appUrl) continue;   // white-label: never email an agency's client
    const { data: members } = await sb.from("tenant_members").select("user_id, role").eq("tenant_id", b.tenant_id);
    const to: string[] = [];
    for (const m of (members ?? []) as any[]) if (m.role === "owner" || m.role === "admin") { const { data } = await sb.auth.admin.getUserById(m.user_id); if (data?.user?.email) to.push(data.user.email); }
    if (!to.length) continue;
    const e = render([
      { lines: [`We checked ${b.primary_domain} today and found a problem that hides it from AI assistants:`] },
      { lines: fresh.map((i) => i.text) },
      { title: "How to fix it", lines: [fixFor(b.site_platform), "We check again every few hours and the warning disappears once it's fixed."] },
    ], { label: "Open your dashboard", url: `${appUrl}/dashboard` }, `${appUrl}/dashboard/settings#email`);
    await sendEmail(to, { subject: `${b.primary_domain} is hidden from search engines`, ...e });
  }
  return n;
}
