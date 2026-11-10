# finance/ledger

Append-only JSONL written by the Finance service (`services/tgl-ops/src/agents/finance/ledger.ts`). One JSON object per line. Amounts are integer paise (INR minor units). Never edit a line; correct by appending a new entry.

| File | Entry kinds | What it tracks |
|---|---|---|
| `income.jsonl` | `invoice`, `status`, `payment` | Draft GST invoices created on deal Won (number, deal id, taxable value, GST, total, due date), status changes (issued, cancelled, paid) and payments received. |
| `expenses.jsonl` | `expense` | Every API cost. `auditId` ties a cost to one audit; `category` is `audit_api` or `overhead`. |
| `collections.jsonl` | `reminder` | Which collections cadence step has been drafted for which invoice, so none repeats. |

Expense line: `{ kind, id, at, auditId, category, vendor, description, usd, fxInrPerUsd, amountMinor }`. `amountMinor` is null when only USD was given with no FX rate. It is never guessed and is counted as "unconverted" in the summary.

Invoice numbers: `TGL/<FY>/<0001>`, for example `TGL/26-27/0001`. Consecutive within a financial year (April to March), 14 characters, inside the 16-character GST limit.

Reading it: `GET /finance/summary` (header `x-finance-secret`) returns invoiced, GST collected, received, outstanding, total expense and expense per audit.

Writing an audit cost: `POST /finance/expense` with `{ "auditId": "...", "vendor": "anthropic", "usd": 0.42, "fxInrPerUsd": <rate you can source today> }` or `{ "amountMinor": 3800 }`.

Persistence warning: the runtime files live in `FINANCE_LEDGER_DIR` (default `finance/ledger` under the service working directory). If the host filesystem is ephemeral, mount a volume there or move the `LedgerStore` to Supabase before going live. Do not set `FINANCE_LIVE=1` until this is decided. Runtime `*.jsonl` files are git-ignored candidates; they are not committed by the service.
