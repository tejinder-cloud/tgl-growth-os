# Finance runbook (plan Day 13)

Owner: Finance agent. Spec: `agents/finance/SKILL.md`. Code: `services/tgl-ops/src/agents/finance/` and `services/tgl-ops/src/routes/finance.ts`. Export checklist: `finance/compliance/lut-checklist.md`.

This runbook is the Architect-facing setup and check list for turning the Finance agent on. Nothing here is live until every step in "Go-live order" is done. The service defaults to dry run.

## 1. What runs, in one page

| Event | Endpoint | Auth | Result |
|---|---|---|---|
| GHL opportunity status changes to Won | `POST /finance/deal-won` | header `x-finance-secret` | One draft GST invoice in Razorpay or Zoho Books, one ledger line, one Slack line. Or one named hold. Repeat calls return `duplicate`. |
| Razorpay invoice issued, paid, cancelled, expired | `POST /finance/razorpay` | `x-razorpay-signature` (HMAC of raw body) | Status or payment line appended to the ledger. |
| Zoho or manual issue, cancel, paid | `POST /finance/invoice-status` | header `x-finance-secret` | Status line appended. |
| Audit finishes | `POST /finance/expense` | header `x-finance-secret` | API cost line for that audit id. |
| Daily scheduler | `POST /finance/collections/run` | header `x-finance-secret` | Next reminder draft for each issued, unpaid invoice. |
| Any time | `GET /finance/summary` | header `x-finance-secret` | Invoiced, GST, received, outstanding, expense, expense per audit. |

Every route returns 401 when its secret is not configured. The service never sends anything to a client.

## 2. Environment

Required before any invoice is created (missing values hold the deal with a named reason):

- `FINANCE_WEBHOOK_SECRET`
- `FINANCE_INVOICE_PROVIDER` (`razorpay` or `zoho`)
- `FINANCE_SUPPLIER_NAME`, `FINANCE_SUPPLIER_GSTIN`, `FINANCE_SUPPLIER_STATE_CODE`
- `FINANCE_SAC_CODE`, `FINANCE_GST_RATE`, `FINANCE_AMOUNT_MODE` (does the deal value include GST)
- `FINANCE_LIVE=1` (leave unset for dry run)

Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

Zoho Books: `ZOHO_BOOKS_API_BASE`, `ZOHO_BOOKS_ORG_ID`, `ZOHO_BOOKS_ACCESS_TOKEN`, `ZOHO_TAX_ID_INTRA`, `ZOHO_TAX_ID_INTER`. The access token is short-lived and refresh is not automated.

Optional: `FINANCE_PAYMENT_TERMS_DAYS` (default 7), `FINANCE_LUT_NUMBER`.

The Architect or the CA must confirm supplier GSTIN, state code, SAC and GST rate. Finance does not guess them.

## 3. GHL workflow (Architect action)

1. Add two custom fields to the GHL contact: `gstin` and `state_code` (two digits). Without them a Won deal is held with `STATE_UNKNOWN`.
2. Create a workflow with trigger "Opportunity status changed" and filter status is Won.
3. Action: Webhook, method POST, URL `<service base>/finance/deal-won`, header `x-finance-secret` with the value of `FINANCE_WEBHOOK_SECRET`.
4. Custom data keys: `status` (won), `opportunity_id`, `opportunity_name`, `monetaryValue` (rupees), `full_name`, `company_name`, `email`, `phone`, `gstin`, `state_code`, `country`.
5. Test with a deal worth a known amount while `FINANCE_LIVE` is unset. Expect a `dry_run` reply and no provider call.

## 4. Razorpay webhook (Architect action)

Dashboard, Webhooks, add `<service base>/finance/razorpay`, active events `invoice.issued`, `invoice.paid`, `invoice.cancelled`, `invoice.expired`, with the secret equal to `RAZORPAY_WEBHOOK_SECRET`. Separate from the `/billing` webhook used by TrueVisible Track.

## 5. Per-audit API cost

After each audit, the audit engine (or a manual curl) posts:

```
POST /finance/expense
{ "auditId": "<audit id>", "vendor": "<provider>", "description": "<what>", "usd": 0.00, "fxInrPerUsd": 0.00 }
```

or `"amountMinor"` in paise when the amount is already in rupees. USD without an FX rate is stored as unconverted and counted in the summary; the service never picks a rate. Fill the real values from the provider invoice. Wiring the audit engine to post automatically is a separate task and is not part of this one.

## 6. Collections schedule

Run `POST /finance/collections/run` once a day. No scheduler is wired by this task. Until one is, run it by hand or from a GHL or Railway cron. Cadence offsets from the due date: -3, 0, +3, +7 (client drafts), +15 (Architect escalation). Drafts only; a human sends.

## 7. Export deals and the LUT

A buyer outside India is held with `EXPORT_REVIEW`. No invoice is created. A Compliance task line points at `finance/compliance/lut-checklist.md`. Compliance works the checklist, the CA confirms, the Architect approves, and the invoice is raised by hand. Open questions on the checklist need Architect answers before the first export deal.

## 8. Go-live order

1. Confirm supplier GSTIN, state code, SAC, GST rate and amount mode with the CA. Set the env values.
2. Set `FINANCE_WEBHOOK_SECRET` and the provider keys. Leave `FINANCE_LIVE` unset.
3. Build the GHL workflow, send a test Won deal, check the `dry_run` reply and the Slack line.
4. Set `FINANCE_LIVE=1`. Send one Won deal for a small known amount. Open the draft in the provider and check: number format `TGL/<FY>/<0001>`, place of supply, CGST+SGST or IGST split, total equals the deal value in inclusive mode.
5. Send the same deal again. Expect `duplicate` and no second draft.
6. Issue the draft by hand. Check the Razorpay event lands in the ledger (`GET /finance/summary`).
7. Delete nothing. If a test invoice must go, cancel it in the provider; the ledger records the cancel as a new line.

## 9. Checks after go-live

- Invoice numbers have no gaps.
- Drafts older than 2 days that were never issued.
- Issued invoices past due with no reminder logged.
- Expense lines with unconverted USD.
- Any `totalMismatch` flag in a Slack line or ledger entry.

## 10. Evidence status

- The unit test is `npm run test:d13-finance` in `services/tgl-ops` and uses a fake provider and a temporary ledger directory. It is not a live invoice.
- No live Razorpay or Zoho call has been made by this task. Live behaviour is unverified until step 4 of the go-live order is done.
