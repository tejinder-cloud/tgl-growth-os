// services/tgl-ops/src/agents/whatsapp/connect.ts
// Connecting TGL's own WhatsApp Business app number to the service through Meta's Embedded Signup with
// coexistence (featureType whatsapp_business_app_onboarding). The phone app keeps working; the service gets a
// business token for the same number. Only the Architect, signed in to the pipeline, can run it.
import { getSupabase } from "../prospect-researcher/db.js";

export interface MetaConfig {
  appId: string;
  appSecret: string;
  configId: string;
  graphVersion: string;
}

export function loadMetaConfig(env: NodeJS.ProcessEnv = process.env): MetaConfig {
  return {
    appId: (env.META_APP_ID || "").trim(),
    appSecret: (env.META_APP_SECRET || "").trim(),
    configId: (env.META_ES_CONFIG_ID || "").trim(),
    graphVersion: (env.META_GRAPH_VERSION || "v23.0").trim(),
  };
}

export function metaConfigIssues(c: MetaConfig): string[] {
  const out: string[] = [];
  if (!c.appId) out.push("META_APP_ID is not set");
  if (!c.appSecret) out.push("META_APP_SECRET is not set");
  if (!c.configId) out.push("META_ES_CONFIG_ID is not set");
  return out;
}

export interface ConnectInput {
  code: string;
  wabaId: string;
  phoneNumberId?: string;
}

export interface ConnectStore {
  setToken(token: string): Promise<void>;
  saveConnection(row: { waba_id: string; phone_number_id: string | null; display_number: string | null; webhooks_subscribed: boolean; connected_by: string }): Promise<void>;
}

export function supabaseConnectStore(): ConnectStore {
  const sb = () => {
    const c = getSupabase();
    if (!c) throw new Error("Supabase is not configured");
    return c;
  };
  return {
    async setToken(token) {
      const { error } = await sb().rpc("svc_set_whatsapp_token", { p_token: token });
      if (error) throw new Error(`Saving the WhatsApp token failed: ${error.message}`);
    },
    async saveConnection(row) {
      const { error } = await sb().from("whatsapp_connection").upsert({ id: "tgl", ...row, connected_at: new Date().toISOString() });
      if (error) throw new Error(`Saving the WhatsApp connection failed: ${error.message}`);
    },
  };
}

export interface ConnectResult {
  ok: boolean;
  steps: { step: string; ok: boolean; detail?: string }[];
  displayNumber?: string;
}

/**
 * Exchanges the Embedded Signup code for a business token, stores it, reads the number, and subscribes the app to
 * the account's webhooks. Each step is reported as Meta answered it; nothing is claimed that Meta did not confirm.
 */
export async function completeConnection(input: ConnectInput, cfg: MetaConfig, store: ConnectStore, by: string, fetchImpl: typeof fetch = fetch): Promise<ConnectResult> {
  const steps: ConnectResult["steps"] = [];
  const g = `https://graph.facebook.com/${cfg.graphVersion}`;
  if (!/^\d{5,25}$/.test(input.wabaId)) return { ok: false, steps: [{ step: "Signup data", ok: false, detail: "Meta did not return a WhatsApp account id." }] };

  const tokenRes = await fetchImpl(`${g}/oauth/access_token?${new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, code: input.code })}`);
  const tokenBody: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenBody.access_token) {
    steps.push({ step: "Access token", ok: false, detail: tokenBody?.error?.message || `Meta answered ${tokenRes.status}` });
    return { ok: false, steps };
  }
  const token = String(tokenBody.access_token);
  steps.push({ step: "Access token", ok: true });
  await store.setToken(token);
  steps.push({ step: "Token saved in the database vault", ok: true });

  let display: string | null = null;
  let phoneId = input.phoneNumberId && /^\d{5,25}$/.test(input.phoneNumberId) ? input.phoneNumberId : null;
  const numsRes = await fetchImpl(`${g}/${input.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${token}` } });
  const nums: any = await numsRes.json().catch(() => ({}));
  if (numsRes.ok && Array.isArray(nums.data) && nums.data.length > 0) {
    const n = (phoneId && nums.data.find((x: any) => x.id === phoneId)) || nums.data[0];
    phoneId = String(n.id);
    display = String(n.display_phone_number || "");
    steps.push({ step: "Number found", ok: true, detail: `${display}${n.verified_name ? ` (${n.verified_name})` : ""}` });
  } else {
    steps.push({ step: "Number found", ok: false, detail: nums?.error?.message || "No number listed on the account yet." });
  }

  const subRes = await fetchImpl(`${g}/${input.wabaId}/subscribed_apps`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const sub: any = await subRes.json().catch(() => ({}));
  const subscribed = subRes.ok && sub.success === true;
  steps.push({ step: "Webhooks subscribed", ok: subscribed, detail: subscribed ? undefined : sub?.error?.message || `Meta answered ${subRes.status}` });

  await store.saveConnection({ waba_id: input.wabaId, phone_number_id: phoneId, display_number: display, webhooks_subscribed: subscribed, connected_by: by });
  steps.push({ step: "Connection saved", ok: true });
  return { ok: steps.every((s) => s.ok), steps, displayNumber: display || undefined };
}
