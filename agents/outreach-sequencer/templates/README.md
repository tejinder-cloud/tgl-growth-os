# Outreach touch templates

The Architect's editable copy for the five touches. `services/tgl-ops/src/agents/outreach-sequencer/sequence.ts`
(`renderTouch`) is the code rendering of these files and must be kept in step with them; wiring the worker to read
these files directly is part of the follow-up issue (live sends).

Cadence (decided by the Architect, issue #72): T1 email day 0 · T2 WhatsApp day 2 · T3 email with the audit PDF day 4 ·
T4 WhatsApp day 7 · T5 email day 12. Business days. WhatsApp falls back to email when there is no business phone.

Placeholders, all filled from stored data (prospect row or the prospect's own audit run), never typed by hand:
`{{first_name}}` `{{company}}` `{{city}}` `{{category}}` `{{brand_mentions}}` `{{competitor_mentions}}`
`{{top_competitor}}` `{{weakest_query}}` `{{audit_date}}` `{{booking_link}}` `{{work_email}}`.

Rules: every message ends with the opt-out line; no number appears that is not in the audit; no emojis.
