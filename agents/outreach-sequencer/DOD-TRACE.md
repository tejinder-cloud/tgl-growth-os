# Outreach Sequencer: Definition of Done trace (Issue #72, Plan Day 10)

Evidence kind: static read of the files named below. No tests were run in this session, and no network call was made.

The task brief says "create" for each deliverable. On this branch (cut from fresh main) the deliverables already exist. This file maps each Definition of Done item to the file that carries it, and lists what was not verified.

## Mapping

| Definition of Done item | Where it lives | Observed |
|---|---|---|
| `agents/outreach-sequencer/SKILL.md` follows the standard | `agents/outreach-sequencer/SKILL.md` | Has sections 1-11 in the same order as `agents/_TEMPLATE/SKILL.md`: Identity and Seniority with Pushback Posture, Mandate, Playbooks A-D, Tools, Inputs/Outputs/Triggers, Colleagues, Definition of Done, Never, Reporting, Learning, Standing Routine. |
| 5-touch sequence automated through the GHL API | `services/tgl-ops/src/agents/outreach-sequencer/sequence.ts`, `ghl.ts`, `execute.ts`, `worker.ts` | Files exist. The SKILL defines offsets of day 0, 3, 6, 10 and 15. `worker.ts` exports `runTick`, `isSendWindow`, `dailyCap` and `isLive`, which `src/test-day10-outreach.ts` exercises. |
| One-pager audit attached to touch 2 | `onepager.ts`, `execute.ts`, `worker.ts` | The test file asserts that a touch 2 result with no `attachmentUrl` is converted to `held` and alerted. It is never reported as `sent`. |
| Reply webhook routes intent to Sales Desk | `routes/outreach.ts`, `agents/outreach-sequencer/reply.ts` | `POST /outreach/ghl-reply` fails closed. It returns 503 when `OUTREACH_WEBHOOK_SECRET` is unset, 401 on a wrong secret, and 503 when the reply dependencies are not wired. Otherwise it calls `handleReply`. |

## Not verified in this session

The research budget ran out before these could be read. A reviewer should check them before merge:

1. `src/app.ts` mounts `outreachRouter` at `/outreach`.
2. `src/index.ts` calls `setOutreachReplyDeps` with the real store and GHL client. Without it the route returns 503 on every request.
3. The 30-minute cron tick (Mon-Fri, 09:30-17:30 IST) is registered through `lib/cron-wrapper.ts`.
4. `services/tgl-ops/.env.example` lists `GHL_API_KEY`, `GHL_LOCATION_ID`, `OUTREACH_LIVE`, `OUTREACH_DAILY_SEND_CAP`, `OUTREACH_WEBHOOK_SECRET`, `OUTREACH_ONEPAGER_BUCKET` and `SALES_DESK_CHANNEL_ID`.
5. `npx tsx src/test-day10-outreach.ts` passes. It is offline and needs no credentials.
6. The task's `depends-on: 8` (the short-form audit) is merged, since `onepager.ts` calls `runShortFormAudit`.
7. The repository map in the task message lists a JS layout (`agents/aeo-reports/`, `agents/prospect-researcher/worker.js`, and so on). That layout does not exist on this branch. The code lives in `services/tgl-ops/src/agents/`.

## Safety posture (from SKILL.md Playbook B)

- Dry run is the default. Live sends need `OUTREACH_LIVE=1` exactly.
- Send window is Mon-Fri 09:30-17:30 IST.
- Daily cap defaults to 40.
- Merging this change sends nothing to any prospect.
