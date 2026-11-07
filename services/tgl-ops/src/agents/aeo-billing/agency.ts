// Agency rules that run on a schedule (SPEC §9, plan Day 27): an agency unpaid for 15 days is suspended;
// its client brands follow (cadence reads the agency's subscription), dashboards stay readable.
import { getSupabase } from "../prospect-researcher/db.js";
import { isTestMode } from "../../config.js";
import { postLine } from "../../lib/post.js";
import { getAlertsChannel } from "../../lib/cron-wrapper.js";

export async function runAgencyGraceCheck(): Promise<number> {
  if (isTestMode()) return 0;
  const sb = getSupabase();
  if (!sb) return 0;
  const { data, error } = await sb.rpc("svc_agency_grace_check");
  if (error) { console.error("[Agency] grace check:", error.message); return 0; }
  const n = Number(data ?? 0);
  if (n > 0) await postLine({ channel: getAlertsChannel(), text: `[Info] *@aeo-audit-engine* ${n} agency subscription${n === 1 ? "" : "s"} suspended after 15 days unpaid — their brands' checks have stopped.` }).catch(() => {});
  return n;
}
