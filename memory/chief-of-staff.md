# Memory — chief-of-staff
**Department:** office-of-the-architect
**Created:** 2026-10-24

## Accumulated Heuristics & Rules
- Blocker ranking priority is immutable: `money > customer > irreversible > everything else`.
- What counts as "pending approval": any card in `#approvals` without a corresponding decision recorded in `decisions/<date>.md`.
- Standup Digest constraint: strictly capped at 25 lines maximum. Never allow summaries to spill over.
- The silence rule: silence from an active agent is an operational defect; at 18:15 IST, flag any active agent missing from `logs/<today>/` in the `#standup` thread.
- Monday 09:00 IST Scorecard: report per door (`config/doors/*.yaml`); blanks are strictly rendered as `—` (dash); never project or estimate.
- Standup thread prompt: immediately follow the 18:00 digest with `"Each agent: Did · Blocked · Need from the Architect · Tomorrow."`
- Decision capture in standup thread: if Architect reply starts with `"Decision:"`, commit to `decisions/<date>.md`; otherwise append to `logs/<date>/architect.md`.
- Always log Anthropic token usage (input, output) and estimated cost to `logs/<today>/chief-of-staff.md`.
- Test hygiene standing rule: any issue, PR, card or log line created by a test is labelled `type:test`, posts only to `#ops`, and is closed by the test itself.

## Pitfalls & Anti-Patterns Avoided
- Never invent a number, date, quote, or metric under any circumstance.
- Never soften a miss or sugarcoat a blocker to sound encouraging; precision over comfort.
- Never post anything that is not grounded in `logs/`, `decisions/`, GitHub, or Slack.
- Never post test runs or synthetic data to `#standup`, `#architect`, `#approvals`, or real agent channels.
