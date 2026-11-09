// services/tgl-ops/src/agents/sales-desk/ghl.ts
// GoHighLevel (LeadConnector) calls the Sales Desk needs: calendar events, notes, tasks, tags, workflow enrolment.
// fetch only, no new dependency. Reuses the same env vars as the outreach sequencer plus GHL_CALENDAR_ID.
import { GhlError, loadGhlConfig, type GhlConfig } from "../outreach-sequencer/ghl.js";
import type { Appointment } from "./types.js";

export interface SalesGhlClient {
  listAppointments(fromIso: string, toIso: string): Promise<Appointment[]>;
  /** Most recent note body on the contact dated after the given ISO time, or null. */
  latestNoteAfter(contactId: string, afterIso: string): Promise<string | null>;
  addNote(contactId: string, body: string): Promise<void>;
  createTask(contactId: string, task: { title: string; body: string; dueDate: string }): Promise<{ taskId: string }>;
  addTags(contactId: string, tags: string[]): Promise<void>;
  enrollWorkflow(contactId: string, workflowId: string): Promise<void>;
}

export function loadCalendarId(env: NodeJS.ProcessEnv = process.env): string {
  return (env.GHL_CALENDAR_ID || "").trim();
}

export function createSalesGhlClient(
  cfg: GhlConfig = loadGhlConfig(),
  calendarId: string = loadCalendarId(),
  fetchImpl: typeof fetch = fetch
): SalesGhlClient {
  if (!cfg.apiKey || !cfg.locationId) throw new GhlError("GHL_API_KEY and GHL_LOCATION_ID must be configured");

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
    if (!res.ok) throw new GhlError(`GHL ${method} ${path} failed: HTTP ${res.status} ${raw.slice(0, 300)}`, res.status);
    return parsed;
  }

  const enc = encodeURIComponent;

  return {
    async listAppointments(fromIso, toIso) {
      if (!calendarId) throw new GhlError("GHL_CALENDAR_ID must be configured");
      const q = `locationId=${enc(cfg.locationId)}&calendarId=${enc(calendarId)}&startTime=${Date.parse(fromIso)}&endTime=${Date.parse(toIso)}`;
      const data = await call("GET", `/calendars/events?${q}`);
      const events: any[] = Array.isArray(data?.events) ? data.events : [];
      return events
        .filter((e) => e?.id && e?.contactId && e?.startTime && e?.endTime)
        .map((e) => ({
          id: String(e.id),
          contactId: String(e.contactId),
          startTime: new Date(e.startTime).toISOString(),
          endTime: new Date(e.endTime).toISOString(),
          title: e.title ? String(e.title) : undefined,
          status: e.appointmentStatus || e.status ? String(e.appointmentStatus || e.status) : undefined,
        }));
    },

    async latestNoteAfter(contactId, afterIso) {
      const data = await call("GET", `/contacts/${enc(contactId)}/notes`);
      const notes: any[] = Array.isArray(data?.notes) ? data.notes : [];
      const after = Date.parse(afterIso);
      const recent = notes
        .filter((n) => n?.body && Date.parse(n.dateAdded || n.createdAt || "") > after)
        .sort((a, b) => Date.parse(b.dateAdded || b.createdAt) - Date.parse(a.dateAdded || a.createdAt));
      return recent.length ? String(recent[0].body) : null;
    },

    async addNote(contactId, body) {
      await call("POST", `/contacts/${enc(contactId)}/notes`, { body });
    },

    async createTask(contactId, task) {
      const data = await call("POST", `/contacts/${enc(contactId)}/tasks`, {
        title: task.title,
        body: task.body,
        dueDate: task.dueDate,
        completed: false,
      });
      const id = data?.task?.id || data?.id;
      if (!id) throw new GhlError("GHL task create returned no task id");
      return { taskId: String(id) };
    },

    async addTags(contactId, tags) {
      if (tags.length === 0) return;
      await call("POST", `/contacts/${enc(contactId)}/tags`, { tags });
    },

    async enrollWorkflow(contactId, workflowId) {
      await call("POST", `/contacts/${enc(contactId)}/workflow/${enc(workflowId)}`, {});
    },
  };
}
