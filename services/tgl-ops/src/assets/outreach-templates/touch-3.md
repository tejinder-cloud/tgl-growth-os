---
touch: 3
channel: email
day: 4
attachment: one-pager audit PDF (held, never sent bare)
subject: "Your AI visibility report: {{company}}"
---
{{first_name}}, attached is one page from the check on {{audit_date}}: how often ChatGPT, Gemini and Perplexity named {{company}} when a customer in {{city}} asked for a {{category}}{{#if top_competitor}}, and who they named instead{{/if}}.

{{#if weakest_competitor}}The one I would fix first: "{{weakest_query}}". {{weakest_competitor}} is named there and {{company}} is not.{{/if}}{{#if weakest_query_only}}The one I would fix first: "{{weakest_query}}". No engine named {{company}} there.{{/if}}

Twenty minutes to walk through it, at a time of your choosing: {{booking_link}}

Tejinder Singh, The Growth Lab

Reply STOP and I will not write again.
