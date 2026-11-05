# Outreach Sequencer: Definition of Done trace (Issue #72, Plan Day 10)

Evidence kind: static read of the files named below, plus one file write (`services/tgl-ops/.env.example`). No tests were run in this session, and no network call was made.

The task brief says "create" for each deliverable. On this branch (cut from fresh main) most deliverables already exist. This file maps each Definition of Done item to the file that carries it, and lists what is still open.

## Mapping

| Definition of Done item | Where it lives | Observed |
|---|---|---|
| `agents/outreach-sequencer/SKILL.md` follows the standard | `agents/outreach-sequencer/SKILL.md` | Has sections 1-11 in the same order as `agents/_TEMPLATE/SKILL.md`: Identity and Seniority with Pushback Posture, Mandate, Playbooks A-D, Tools, Inputs/Outputs/Triggers, Colleagues, Definition of Done, Never, Reporting, Learning, Standing Routine. |
| 5-touch sequence automated through the GHL API | `services/tgl-ops/src/agents/outreach-sequencer/sequence.ts`, `ghl.ts`, `execute.ts`, `worker.ts` | Files exist. `worker.ts` was read in full: `runTick` enforces the send window, daily cap, live switch and the touch 2 hold rule through injected ports. `sequence.ts`, `ghl.ts` and `execute.ts` were not read in this session. |
| One-pager audit attached to touch 2 | `onepager.ts`, `execute.ts`, `worker.ts` | `worker.ts` converts a touch 2 `sent` or `dry_run` result with no `attachmentUrl` to `held` and alerts. `onepager.ts` was not read in this session. |
| Reply webhook routes intent to Sales Desk | `routes/outreach.ts`, `agents/outreach-sequencer/reply.ts` | `routes/outreach.ts` was read in full. `POST /outreach/ghl-reply` returns 503 when `OUTREACH_WEBHOOK_SECRET` is unset, 401 on a wrong secret (timing-safe compare), 503 when reply deps are not wired, otherwise calls `handleReply`. `reply.ts` was not read in this session. |

## Items checked in this session

| # | Item | Result |
|---|---|---|
| 1 | `src/app.ts` mounts `outreachRouter` at `/outreach` | Confirmed (static read). |
| 2 | `src/index.ts` calls `setOutreachReplyDeps` with the real store and GHL client | **Not present.** `index.ts` has no reference to the outreach sequencer. Until this is wired, every request to `/outreach/ghl-reply` returns 503 "outreach reply handler not wired". |
| 3 | 30-minute tick (Mon-Fri, 09:30-17:30 IST) registered | **Not present.** `index.ts` has no outreach cron entry. `runTick` exists but nothing calls it. |
| 4 | `.env.example` lists the outreach variables | Was missing. Added in this change: `OUTREACH_LIVE`, `OUTREACH_DAILY_SEND_CAP`, `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_API_BASE`, `GHL_API_VERSION`, `GHL_EMAIL_FROM`, `OUTREACH_WEBHOOK_SECRET`, `OUTREACH_ONEPAGER_BUCKET`, `SALES_DESK_CHANNEL_ID`. |
| 5 | `npx tsx src/test-day10-outreach.ts` passes | Not run. |
| 6 | `depends-on: 8` (short-form audit) merged | `agents/aeo-audit-engine/short-form.js` is not on this branch in the JS layout the task map lists; the code lives in `services/tgl-ops/src/agents/aeo-audit-engine/`. Not confirmed by read. |
| 7 | Repository map in the task message | It lists a JS layout (`agents/aeo-reports/`, `agents/prospect-researcher/worker.js`). That layout does not exist on this branch (reads of those paths returned not found). The code lives in `services/tgl-ops/src/agents/`. |

## Open work before the Definition of Done is met

1. In `services/tgl-ops/src/index.ts`, build the real store and GHL client, call `setOutreachReplyDeps(...)`, and register `cron.schedule("*/30 9-17 * * 1-5", wrapCronJob("Outreach Sequencer Tick", ...), { timezone: config.timezone })` calling `runTick` with real ports. `runTick` itself re-checks the 09:30-17:30 window, so the cron expression may be broad. This was not done in this session because the export names and signatures of `store.ts`, `ghl.ts`, `execute.ts` and `reply.ts` could not be read once the research budget ran out, and a guessed import would break service boot.
2. Run `npx tsx src/test-day10-outreach.ts` and `tsc` for the service.

## Safety posture (from SKILL.md Playbook B)

- Dry run is the default. Live sends need `OUTREACH_LIVE=1` exactly (`isLive` in `worker.ts`).
- Send window is Mon-Fri 09:30-17:30 IST (`isSendWindow` in `worker.ts`).
- Daily cap defaults to 40 (`dailyCap` in `worker.ts`).
- Merging this change sends nothing to any prospect.
