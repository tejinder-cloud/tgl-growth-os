// services/tgl-ops/src/agents/outreach-sequencer/ghl.ts
// Minimal GoHighLevel (LeadConnector) client: contact upsert, conversation messages, tags, notes.
// Uses fetch only (no new dependency). Base URL and API version are env-configurable because
// the Railway GHL_API_KEY type (private integration token vs legacy key) is set outside the repo.
import type { TouchChannel } from "./types.js";

export interface GhlConfig {
  apiKey: string;
  locationId: string;
  baseUrl: string;
  version: string;
  emailFrom?: string;
}

export function loadGhlConfig(env: NodeJS.ProcessEnv = process.env): GhlConfig {
  return {
    apiKey: (env.GHL_API_KEY || "").trim(),
    locationId: (env.GHL_LOCATION_ID || "").trim(),
    baseUrl: (env.GHL_API_BASE || "https://services.leadconnectorhq.com").trim().replace(/\/+$/, ""),
    version: (env.GHL_API_VERSION || "2021-07-28").trim(),
    emailFrom: (env.GHL_EMAIL_FROM || "").trim() || undefined,
  };
}

export interface UpsertContactInput {
  name?: string;
  email?: string;
  phone?: string;
  companyName: string;
  website?: string;
  tags?: string[];
}

export interface SendMessageInput {
  contactId: string;
  channel: TouchChannel;
  subject?: string;
  html?: string;
  text: string;
  attachmentUrls?: string[];
}

export interface GhlClient {
  upsertContact(input: UpsertContactInput): Promise<{ contactId: string }>;
  sendMessage(input: SendMessageInput): Promise<{ messageId: string }>;
  addTags(contactId: string, tags: string[]): Promise<void>;
  addNote(contactId: string, body: string): Promise<void>;
}

export class GhlError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "GhlError";
  }
}

export function createGhlClient(cfg: GhlConfig = loadGhlConfig(), fetchImpl: typeof fetch = fetch): GhlClient {
  if (!cfg.apiKey || !cfg.locationId) {
    throw new GhlError("GHL_API_KEY and GHL_LOCATION_ID must be configured");
  }

  async function call(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetchImpl(`${cfg.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        Version: cfg.version,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await res.text();
    let parsed: any = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { raw };
    }
    if (!res.ok) {
      throw new GhlError(`GHL ${method} ${path} failed: HTTP ${res.status} ${raw.slice(0, 300)}`, res.status);
    }
    return parsed;
  }

  return {
    async upsertContact(input) {
      const parts = (input.name || "").trim().split(/\s+/).filter(Boolean);
      const payload: Record<string, unknown> = {
        locationId: cfg.locationId,
        companyName: input.companyName,
        source: "TGL Outreach Sequencer",
      };
      if (parts.length > 0) {
        payload.firstName = parts[0];
        if (parts.length > 1) payload.lastName = parts.slice(1).join(" ");
        payload.name = input.name;
      }
      if (input.email) payload.email = input.email;
      if (input.phone) payload.phone = input.phone;
      if (input.website) payload.website = input.website;
      if (input.tags?.length) payload.tags = input.tags;
      const data = await call("POST", "/contacts/upsert", payload);
      const contactId = data?.contact?.id || data?.id;
      if (!contactId) throw new GhlError("GHL contact upsert returned no contact id");
      return { contactId: String(contactId) };
    },

    async sendMessage(input) {
      const payload: Record<string, unknown> = {
        type: input.channel,
        contactId: input.contactId,
      };
      if (input.channel === "Email") {
        payload.subject = input.subject || "";
        payload.html = input.html || `<p>${input.text}</p>`;
        payload.message = input.text;
        if (cfg.emailFrom) payload.emailFrom = cfg.emailFrom;
      } else {
        payload.message = input.text;
      }
      if (input.attachmentUrls?.length) payload.attachments = input.attachmentUrls;
      const data = await call("POST", "/conversations/messages", payload);
      const messageId = data?.messageId || data?.id || data?.msg?.id;
      if (!messageId) throw new GhlError("GHL send returned no message id");
      return { messageId: String(messageId) };
    },

    async addTags(contactId, tags) {
      if (tags.length === 0) return;
      await call("POST", `/contacts/${encodeURIComponent(contactId)}/tags`, { tags });
    },

    async addNote(contactId, body) {
      await call("POST", `/contacts/${encodeURIComponent(contactId)}/notes`, { body });
    },
  };
}
