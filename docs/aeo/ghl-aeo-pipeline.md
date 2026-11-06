# GHL "AEO" pipeline and lead capture (PLAN-D11)

This is the one-time GoHighLevel setup that the /aeo audit form writes into. GHL does not let an API create a pipeline, so a person creates it once in the GHL UI and puts the ids in the tgl-ops environment.

## 1. Create the pipeline

GHL > Opportunities > Pipelines > Create. Name it exactly `AEO`. Stages, in order:

1. New request - the form drops every lead here. Entering this stage triggers the WhatsApp workflows `aeo_audit_received` (to the prospect) and `aeo_internal_new_request` (to the team).
2. Audit running - set by the person or agent running the AEO audit engine.
3. Audit sent - report delivered. Entering this stage triggers `aeo_audit_ready`.
4. Call booked
5. Won
6. Lost or not a fit

Tick "Show in funnel chart" on all stages so the Meta spend can be compared with stage counts.

## 2. Environment variables (Railway, service tgl-ops)

| Variable | Value |
| --- | --- |
| GHL_API_KEY | Private Integration token with contacts.write and opportunities.write |
| GHL_LOCATION_ID | The sub-account (location) id |
| GHL_AEO_PIPELINE_ID | Id of the `AEO` pipeline |
| GHL_AEO_STAGE_NEW_ID | Id of the `New request` stage |
| AEO_ALLOWED_ORIGINS | Optional. Comma-separated. Defaults to https://thegrowthlab.co.in and https://www.thegrowthlab.co.in |

The pipeline and stage ids are visible in the GHL URL when the pipeline is open, or via `GET https://services.leadconnectorhq.com/opportunities/pipelines?locationId=...` with the same token.

With any of the four GHL variables missing, `POST /aeo/lead` returns 503 and saves nothing. The form tells the visitor to try again; it never shows a false success.

## 3. What the form writes

`POST /aeo/lead` (route `services/tgl-ops/src/routes/aeo.ts`, mounted at `/aeo`):

1. Validates the fields and normalises the phone number to E.164.
2. `POST /contacts/upsert`: GHL merges with an existing contact on phone or email. Tags: `aeo-audit-request`, `source:aeo-page`.
3. `POST /contacts/{id}/notes`: institute, website, contact, the optional question, consent, and every UTM parameter.
4. `POST /opportunities/`: named `AEO audit - <institute>`, in pipeline AEO, stage New request.
5. Posts a plain-text line to the alerts channel in Slack.

If step 2 to 4 fails the visitor sees an error, the alerts channel is told, and no success is reported.

## 4. Site wiring

The WordPress theme reads the endpoint from the constant `TGL_AEO_ENDPOINT` (or the `tgl_aeo_endpoint` filter). Add this to wp-config.php once the tgl-ops service is mounted:

```php
define('TGL_AEO_ENDPOINT', 'https://<tgl-ops public domain>/aeo/lead');
```

If it is not defined the form shows "Requests are temporarily unavailable" and does not post anywhere.

## 5. Mounting the route

In `services/tgl-ops/src/app.ts` add:

```ts
import { aeoRouter } from "./routes/aeo.js";
app.use("/aeo", aeoRouter);
```

The route parses its own JSON body, so it works whether or not the app already has a JSON parser.
