// services/tgl-ops/src/test-d10b-reply-route.ts
// Offline check that POST /outreach/ghl-reply is mounted on the real Express app and works once
// setOutreachReplyDeps has been called with the dependencies the composition root builds (PLAN-D10b).
// Store is in memory, GHL is a fake, Slack notify is captured. Binds an ephemeral localhost port only.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { buildReplyDeps } from "./agents/outreach-sequencer/live.js";
import type { GhlClient } from "./agents/outreach-sequencer/ghl.js";
import { createMemoryStore, getOutreachState, type OutreachProspect } from "./agents/outreach-sequencer/store.js";
import type { OutreachState } from "./agents/outreach-sequencer/types.js";
import { OUTREACH_SECRET_HEADER, setOutreachReplyDeps } from "./routes/outreach.js";

const SECRET = "d10b-test-secret";
process.env.OUTREACH_WEBHOOK_SECRET = SECRET;

function prospect(): OutreachProspect {
  const state = {
    state: "active",
    enrolled_at: "2026-03-09T00:00:00.000Z",
    next_touch: 2,
    next_due_at: "2026-03-11T00:00:00.000Z",
    touches: [{ n: 1, channel: "Email", sent_at: "2026-03-09T04:30:00.000Z", dry_run: false }],
    audit_attempts: 0,
    send_failures: 0,
    ghl_contact_id: "ghl-contact-9",
  } as unknown as OutreachState;
  return {
    id: "p9",
    tenant_id: "tgl",
    company: "Bright Smile Dental",
    website: "https://brightsmile.example",
    city: "Pune",
    door: "aeo",
    status: "handed_to_outreach",
    fit_score: 82,
    fit_reasons: [],
    decision_maker: { name: "Asha Rao", email: "asha@brightsmile.example" },
    signals: { outreach: state },
  } as unknown as OutreachProspect;
}

async function main() {
  const store = createMemoryStore([prospect()]);
  const tags: string[][] = [];
  const ghl: GhlClient = {
    async upsertContact() {
      return { contactId: "x" };
    },
    async sendMessage() {
      return { messageId: "x" };
    },
    async addTags(_id, t) {
      tags.push(t);
    },
    async addNote() {},
  };
  const notes: Array<{ channel: string; text: string }> = [];
  const deps = { ...buildReplyDeps({ store, ghl }), notify: async (channel: string, text: string) => void notes.push({ channel, text }) };
  assert.equal(deps.store, store);
  assert.equal(deps.ghl, ghl);

  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (headers: Record<string, string>, body: unknown) =>
    fetch(`${base}/outreach/ghl-reply`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  try {
    setOutreachReplyDeps(null);
    const unwired = await post({ [OUTREACH_SECRET_HEADER]: SECRET }, { contactId: "ghl-contact-9", body: "Yes, interested" });
    assert.equal(unwired.status, 503, "route is mounted and refuses until wired");

    setOutreachReplyDeps(deps);
    const wrong = await post({ [OUTREACH_SECRET_HEADER]: "nope" }, { contactId: "ghl-contact-9", body: "Yes" });
    assert.equal(wrong.status, 401);

    const ok = await post({ [OUTREACH_SECRET_HEADER]: SECRET }, { contactId: "ghl-contact-9", messageId: "m1", body: "Yes, interested. Can we talk Thursday?" });
    assert.equal(ok.status, 200);
    const json = (await ok.json()) as { status: string; matched: boolean; intent: string };
    assert.equal(json.status, "routed");
    assert.equal(json.matched, true);
    assert.equal(json.intent, "meeting_request");
    assert.equal(getOutreachState(store.rows[0])!.state, "replied", "sequence stopped");
    assert.equal(notes.length, 1, "routed to the Sales Desk once");
    assert.ok(tags.some((t) => t.includes("tgl-replied")));

    const dup = await post({ [OUTREACH_SECRET_HEADER]: SECRET }, { contactId: "ghl-contact-9", messageId: "m1", body: "Yes, interested. Can we talk Thursday?" });
    assert.equal(((await dup.json()) as { status: string }).status, "duplicate");
    assert.equal(notes.length, 1, "duplicate delivery is not routed again");
  } finally {
    setOutreachReplyDeps(null);
    server.close();
  }

  console.log("test-d10b-reply-route: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
