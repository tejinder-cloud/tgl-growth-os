# finance

Index and go-live checklist for the Finance agent (plan Day 13, issue #141). Owner: Finance. Reviewer: Chief of Staff. Approver for anything live: the Architect.

This file adds no behaviour. It maps each Day 13 deliverable to the file that holds it, so the Architect can check each one in two minutes.

## Where each deliverable lives

| Day 13 deliverable | File | What to check |
|---|---|---|
| Finance SKILL.md following the standard | `agents/finance/SKILL.md` | Sections 1 to 11 match `agents/_TEMPLATE/SKILL.md` (identity, mandate, playbooks, tools, inputs/outputs/triggers, colleagues, definition of done, never, reporting, learning, standing routine). |
| GST invoice automated on deal Won (Razorpay or Zoho) | `services/tgl-ops/src/agents/finance/` (`deal-won.ts`, `gst.ts`, `invoice.ts`, `providers.ts`, `types.ts`) and `services/tgl-ops/src/routes/finance.ts`, mounted at `/finance` in `services/tgl-ops/src/app.ts` | `POST /finance/deal-won` with header `x-finance-secret`. Draft invoice only. Dry run unless `FINANCE_LIVE=1`. |
| Ledger of income and per-audit API expenses | `services/tgl-ops/src/agents/finance/ledger.ts`, format in `finance/ledger/README.md` | `income.jsonl`, `expenses.jsonl`, `collections.jsonl`; `GET /finance/summary`. |
| Collections cadence | `services/tgl-ops/src/agents/finance/collections.ts`, steps in SKILL.md Playbook C | -3, 0, +3, +7 days to the client as drafts, +15 days escalation to the Architect. |
| LUT export compliance task and checklist | `services/tgl-ops/src/agents/finance/compliance.ts` and `finance/compliance/lut-checklist.md` | A non-India buyer is held as `EXPORT_REVIEW`, no invoice is created, and a Compliance task points at the checklist. |
| Tests | `services/tgl-ops/src/test-d13-finance.ts`, run with `npm run test:d13-finance` in `services/tgl-ops` | Part of `npm test`. Uses a fake provider and temp directories. |

## Before FINANCE_LIVE=1 (Architect and CA actions)

Nothing below is guessed by the service. A missing value holds the invoice with a named reason.

1. Supplier details: `FINANCE_SUPPLIER_NAME`, `FINANCE_SUPPLIER_GSTIN`, `FINANCE_SUPPLIER_STATE_CODE`.
2. Tax settings the CA confirms: `FINANCE_SAC_CODE`, `FINANCE_GST_RATE`, `FINANCE_AMOUNT_MODE` (whether the agreed deal value already includes GST).
3. Provider: `FINANCE_INVOICE_PROVIDER` set to Razorpay (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) or Zoho Books (`ZOHO_BOOKS_API_BASE`, `ZOHO_BOOKS_ORG_ID`, `ZOHO_BOOKS_ACCESS_TOKEN`, `ZOHO_TAX_ID_INTRA`, `ZOHO_TAX_ID_INTER`). The Zoho access token is short-lived and automatic refresh is not built.
4. Shared secret `FINANCE_WEBHOOK_SECRET`, placed in the GoHighLevel workflow header `x-finance-secret`. Without it the service answers 401.
5. GoHighLevel: add `gstin` and `state_code` custom fields to the contact. Without them a Won deal is held as `STATE_UNKNOWN`.
6. Ledger persistence: mount a volume at `FINANCE_LEDGER_DIR`, or move the `LedgerStore` to Supabase. An ephemeral disk would lose the ledger.
7. Optional: `FINANCE_PAYMENT_TERMS_DAYS` (default 7) and `FINANCE_LUT_NUMBER` once a LUT is filed.
8. Daily scheduler for `POST /finance/collections/run` is not wired. Until it is, the cadence runs only when called.

## Open questions for the Architect

1. Does TGL expect a non-India buyer in the next quarter? If not, the LUT checklist stays dormant.
2. Which CA confirms SAC, GST rate and the export conditions?
3. Does the GHL deal value include GST? This sets `FINANCE_AMOUNT_MODE`.
4. Ledger on a mounted volume now, or Supabase before go-live?

## Rules that apply here

- The service drafts; a human issues and sends. No invoice, reminder, email, SMS or WhatsApp is sent by the service.
- Ledger lines are append-only. Corrections are new entries. Invoice numbers are never reused, renumbered or back-dated.
- No emojis in any text the service writes.
- `decisions/` and `logs/` are written only by the service on main.

## Verification status (web-builder pass on issue #141)

Evidence kind: static read only. No test was executed in this pass and no live provider, Slack or GHL call was made.

Read and confirmed present on the branch:
- `agents/finance/SKILL.md` has all eleven template sections in order, with the Pushback Posture block, metrics, playbooks A to E, the GHL webhook contract and the never list.
- `finance/compliance/lut-checklist.md` has sections A to E (export test, LUT in force, invoice content, after the invoice, close-out) and three open questions for the Architect.
- `finance/ledger/README.md` documents the ledger files.
- `services/tgl-ops/src/routes/finance.ts` defines `/deal-won`, `/razorpay`, `/invoice-status`, `/expense`, `/collections/run` and `/summary`. Every route returns 401 when its secret is unset or does not match, compared with `timingSafeEqual`.
- `services/tgl-ops/package.json` has `test:d13-finance` and includes `test-d13-finance.ts` in `npm test`.

Not verified in this pass (the research budget ran out before these reads). The Architect or Reviewer should check them before `FINANCE_LIVE=1`:
1. `services/tgl-ops/src/app.ts` mounts `financeRouter` at `/finance`.
2. `app.ts` captures the raw request body as `req.rawBody` on `/finance/razorpay`. The signature check hashes `req.rawBody`. If it is missing, every Razorpay event gets 401, which fails closed but drops payment events.
3. `setFinanceNotifier` is called at boot with the Slack poster. Until then every Finance line goes to the console only, and the Architect would not see held deals or draft invoices.
4. `npm run test:d13-finance` passes in CI.
