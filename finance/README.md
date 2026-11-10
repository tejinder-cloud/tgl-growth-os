# finance

Index and go-live checklist for the Finance agent (plan Day 13, issue #141). Owner: Finance. Reviewer: Chief of Staff. Approver for anything live: the Architect.

This file adds no behaviour. It maps each Day 13 deliverable to the file that holds it, so the Architect can check each one in two minutes.

## Where each deliverable lives

| Day 13 deliverable | File | What to check |
|---|---|---|
| Finance SKILL.md following the standard | `agents/finance/SKILL.md` | Sections 1 to 11 match `agents/_TEMPLATE/SKILL.md` (identity, mandate, playbooks, tools, inputs/outputs/triggers, colleagues, definition of done, never, reporting, learning, standing routine). |
| GST invoice automated on deal Won (Razorpay or Zoho) | `services/tgl-ops/src/agents/finance/` (`deal-won.ts`, `gst.ts`, `invoice.ts`, `providers.ts`, `types.ts`) and `services/tgl-ops/src/routes/finance.ts`, mounted at `/finance` in `services/tgl-ops/src/app.ts` | `POST /finance/deal-won` with header `x-finance-secret`. Draft invoice only. Dry run unless `FINANCE_LIVE=1`. |
| Tax configuration from the environment (Architect instruction, 15:08) | `loadConfig`, `configGaps`, `sacFor` and `buildInvoice` in `invoice.ts`; `computeExport` and `LUT_EXPORT_LINE` in `gst.ts`; variables listed in `services/tgl-ops/.env.example` | Rate, SAC codes, TGL GSTIN and LUT number are read from env. The generator returns a hold (no render) when any is missing. |
| Ledger of income and per-audit API expenses | `services/tgl-ops/src/agents/finance/ledger.ts`, format in `finance/ledger/README.md` | `income.jsonl`, `expenses.jsonl`, `collections.jsonl`; `GET /finance/summary`. |
| Collections cadence | `services/tgl-ops/src/agents/finance/collections.ts`, steps in SKILL.md Playbook C | -3, 0, +3, +7 days to the client as drafts, +15 days escalation to the Architect. |
| LUT export compliance task and checklist | `services/tgl-ops/src/agents/finance/compliance.ts` and `finance/compliance/lut-checklist.md` | A non-India buyer raises a Compliance task pointing at the checklist. With `LUT_NUMBER` the draft is rendered at 0% with the LUT line; without it the invoice is held as `EXPORT_REVIEW`. |
| Tests | `services/tgl-ops/src/test-d13-finance.ts` (`npm run test:d13-finance`) and `services/tgl-ops/src/test-d13-gst-env.ts` | Fake provider and temp directories in the first; pure functions in the second. |

## Tax rules as built (issue #141)

| Case | Result |
|---|---|
| Buyer state equals the first two digits of `TGL_GSTIN` | CGST 9% + SGST 9% (half of `GST_RATE` each) |
| Buyer in another state | IGST at `GST_RATE` (18%) |
| Buyer outside India, `LUT_NUMBER` set | 0%, place of supply 96, line "Supply meant for export under LUT without payment of IGST", LUT number shown |
| Buyer outside India, `LUT_NUMBER` missing | not rendered, held as `EXPORT_REVIEW` |
| Product line track | SAC from `SAC_TRACK` (997331) |
| Product line services | SAC from `SAC_SERVICES` (998314) |
| No product line on the deal | held as `PRODUCT_UNKNOWN` (unless the legacy `FINANCE_SAC_CODE` is set) |
| `GST_RATE`, `TGL_GSTIN` or the needed SAC missing | held as `CONFIG_MISSING`, naming the variable |

## Before FINANCE_LIVE=1 (Architect and CA actions)

Nothing below is guessed by the service. A missing value holds the invoice with a named reason.

1. Tax settings the CA confirms: `GST_RATE`, `SAC_TRACK`, `SAC_SERVICES`, `FINANCE_AMOUNT_MODE` (whether the agreed deal value already includes GST). The values 18, 997331 and 998314 are in `.env.example` as the Architect's stated settings and are not final until the CA confirms.
2. Supplier details: `FINANCE_SUPPLIER_NAME`, `TGL_GSTIN`. The supplier state code is taken from the GSTIN; set `FINANCE_SUPPLIER_STATE_CODE` only if you want an explicit check, and it must match.
3. Provider: `FINANCE_INVOICE_PROVIDER` set to Razorpay (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) or Zoho Books (`ZOHO_BOOKS_API_BASE`, `ZOHO_BOOKS_ORG_ID`, `ZOHO_BOOKS_ACCESS_TOKEN`, `ZOHO_TAX_ID_INTRA`, `ZOHO_TAX_ID_INTER`). The Zoho access token is short-lived and automatic refresh is not built.
4. Shared secret `FINANCE_WEBHOOK_SECRET`, placed in the GoHighLevel workflow header `x-finance-secret`. Without it the service answers 401.
5. GoHighLevel: add `product` (track or services), `gstin` and `state_code` custom fields and pass them in the workflow webhook. Without `product` a Won deal is held as `PRODUCT_UNKNOWN`; without `gstin` and `state_code` it is held as `STATE_UNKNOWN`.
6. Ledger persistence: mount a volume at `FINANCE_LEDGER_DIR`, or move the `LedgerStore` to Supabase. An ephemeral disk would lose the ledger.
7. `LUT_NUMBER` once a LUT is filed. Optional: `FINANCE_PAYMENT_TERMS_DAYS` (default 7).
8. Daily scheduler for `POST /finance/collections/run` is not wired. Until it is, the cadence runs only when called.

## Open questions for the Architect

1. Does TGL expect a non-India buyer in the next quarter? If not, the LUT checklist stays dormant.
2. Which CA confirms SAC, GST rate and the export conditions?
3. Does the GHL deal value include GST? This sets `FINANCE_AMOUNT_MODE`.
4. Ledger on a mounted volume now, or Supabase before go-live?
5. Can a single deal mix Track and a service? One invoice carries one SAC today; a mixed deal needs per-line SAC (proposal).

## Rules that apply here

- The service drafts; a human issues and sends. No invoice, reminder, email, SMS or WhatsApp is sent by the service.
- Ledger lines are append-only. Corrections are new entries. Invoice numbers are never reused, renumbered or back-dated.
- No emojis in any text the service writes.
- `decisions/` and `logs/` are written only by the service on main.

## Verification status (web-builder pass on issue #141)

Evidence kind: file write plus static read. No test was executed in this pass and no live provider, Slack or GHL call was made.

Changed in this pass: `invoice.ts`, `gst.ts`, `types.ts`, `deal-won.ts`, `.env.example`, `agents/finance/SKILL.md`, this file, and the new `test-d13-gst-env.ts`.

Not verified (the research budget ran out before these could be read). Check before `FINANCE_LIVE=1`:
1. `providers.ts` was not read in this pass. An export draft has `supply: "export"`, rate 0 and zero tax amounts; confirm the Razorpay and Zoho payloads render a 0% line and carry the LUT wording from `description` and `notes`. Zoho needs a 0% tax id that is not configured.
2. `test-d13-finance.ts` was not read. It may assert that an export buyer is always held as `EXPORT_REVIEW`, or build configs that rely on the old single SAC or a supplier state that differs from the GSTIN. Those expectations need updating to the new rules.
3. `test-d13-gst-env.ts` is not yet in the `npm test` chain in `package.json` (not read). Add a `test:d13-gst-env` script.
4. `app.ts` mounts `financeRouter` at `/finance`, captures `req.rawBody` on `/finance/razorpay`, and `setFinanceNotifier` is called at boot with the Slack poster.
5. `compliance.ts` was not read; `exportComplianceTask(deal, cfg)` is used as before and is expected to read `cfg.lutNumber`.
