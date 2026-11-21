---
touch: 4
channel: whatsapp
day: 7
fallback: email
skip_if: touch 2 was blocked or answered STOP
---
{{first_name}}, one line from the report: {{#if weakest_competitor}}for "{{weakest_query}}", {{weakest_competitor}} is named and {{company}} is not.{{/if}}{{#if weakest_query_only}}for "{{weakest_query}}", no engine named {{company}}.{{/if}}{{#if no_weakest_query}}{{company}} was named in {{brand_mentions}} of {{total_answers}} answers.{{/if}} Want the 20-minute walkthrough? Reply with a day. Reply STOP to hear no more.
