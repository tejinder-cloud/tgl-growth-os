# WhatsApp templates for the /aeo audit funnel (PLAN-D11)

Source of truth for the wording is `services/tgl-ops/src/lib/aeo-whatsapp-templates.ts`. `test-d11-aeo.ts` fails if a body breaks a Meta rule (variable at start or end, adjacent variables, over 1024 characters, emoji, mis-numbered variables, sample count mismatch).

## Status

| Step | State |
| --- | --- |
| Wording written and rule-checked in code | Done in this PR |
| Submitted to Meta for approval | Not done. Needs a person with access to the GHL WhatsApp (Meta Business) account. See steps below. |
| Test send to a real handset | Not done. It can only happen after Meta approves. |

The brief's "submitted and tested" box stays open until the last two rows are done by the person holding the Meta Business account. This agent has no access to it and does not claim otherwise.

## Templates

All English, language code `en`. Variables are positional.

### aeo_audit_received - UTILITY - to the prospect
Trigger: opportunity enters `New request`.
> Hi {{1}}, we have received your request for an AI search audit of {{2}}. We will check how ChatGPT, Gemini and Perplexity describe your institute and send the written report on this number. If there is a question you want us to include, just reply here. The Growth Lab

Variables: 1 first name, 2 institute name. Samples: Rohit, Sharma Academy.

### aeo_audit_ready - UTILITY - to the prospect
Trigger: opportunity enters `Audit sent`.
> Hi {{1}}, the AI search audit for {{2}} is ready. You can read it here: {{3}}. If anything in it is unclear, reply with your question and our team will answer on this chat.

Variables: 1 first name, 2 institute name, 3 report link.

### aeo_audit_followup - MARKETING - to the prospect
Trigger: opportunity still in `Audit sent` with no reply after the wait the Architect agrees. Submitted as MARKETING because it nudges toward a call; Meta bills and rate-limits it as marketing.
> Hi {{1}}, a quick check on the AI search audit we sent for {{2}}. If a short call would help you act on it, reply with a time that suits you. If it is not relevant right now, reply STOP and we will not message again.

Variables: 1 first name, 2 institute name.

### aeo_internal_new_request - UTILITY - to the team
Trigger: opportunity enters `New request`. Send to the numbers of Rahul and the Architect only.
> New AEO audit request. Institute: {{1}}. Contact: {{2}} on {{3}}. Came from: {{4}}. It is in the AEO pipeline at stage New request.

Variables: 1 institute, 2 contact name, 3 contact WhatsApp number, 4 campaign source.

## Submitting (person with Meta Business access)

1. GHL > Settings > Phone Numbers (or WhatsApp) > Templates > Create template.
2. Copy name, category, language, body and the sample values exactly from above.
3. Submit. Review usually returns within a day. If Meta recategorises a UTILITY template as MARKETING, accept it; do not re-submit with disguised wording.
4. After approval, in GHL Automation create one workflow per template with the trigger shown above, action "Send WhatsApp template", and map the variables from contact fields (first name, company name, the opportunity name or report URL).
5. Test: create a contact with your own number, add an opportunity to `AEO` at `New request`, confirm `aeo_audit_received` arrives and `aeo_internal_new_request` reaches the team. Move it to `Audit sent` and confirm `aeo_audit_ready`. Record the date and handset in the PR.

Prospect messages are sent only to people who ticked the consent box on the form; the consent line is stored in the GHL note on every lead.
