# TrueLead v0 — "Lead Accountability" · product spec
**25 October 2026 · Owner: Architect · Builder: Architect (sprint) + Web Builder (dashboard, data model) · Status: approved for the 15-day sprint, target 4 Nov**
Supersedes the 5-step gate in TEAM-v3.md. Decided in the 25 Oct office-hours session (see decisions/2026-10-25.md).

## 1. What it is
TrueLead is the single source of truth between a marketing team and a sales team for every lead: what the ad produced, what the callers did with it, what happened. The client's callers work inside it; the agency and the client's owner read it; Meta learns from it.

- **Category line:** every lead, accounted for.
- **Family:** TrueLead (what happened to my leads?) · TrueVisible (does AI see me?). Both "by The Growth Lab".
- **Buyer (software):** the agency owner — the person who feels the month-3 churn. **Reader with the larger risk:** the client's owner, who pays retainer + ads + tools + callers.
- **Service path:** every TGL retainer client gets TrueLead included; this is the product+service door.
- **Promise:** proof, in week one, of what is happening to every lead — not a prediction of lead quality. (ESM: 1,000 leads, 0 conversions, nobody could show where they died.)

## 2. The five-step gate (replaces TEAM-v3 §TrueLead)
1. **Agency connects Meta Lead Ads** (one authorisation) or uploads a CSV. Leads land in the TrueLead inbox under the client (brand). Historical CSV import → first Lead Accountability report within 15 minutes.
2. **Callers work inside TrueLead.** Mobile-first lead card: tap-to-call, outcome in two taps (unreachable · not interested · interested · follow-up · converted), optional remark, next follow-up date. New lead → WhatsApp ping to the assigned caller with the card link. Assignment: round-robin or manual.
3. **Outcomes → Meta daily** via CAPI quality events (Navkiran SOP), per brand's pixel/dataset. No GHL in the pipeline.
4. **Dashboard, two audiences, one data set.** Per lead: campaign, ad set, creative, cost (left) × time-to-first-call, attempts, outcome, remark (right). Views: Overview (funnel, time-to-call, outcome mix, by campaign/creative), Leads (the inbox), Callers (per-caller activity), Export (Sheet / CSV). Logins: agency owner, account manager, performance marketer; client owner, callers, sales head. Client sees only its brand.
5. **Monday email** to agency owner and client owner: the week's accountability numbers + link. **14-day trial → ₹2,999/month per brand** (+18% GST). Included in TGL retainers.

## 3. Gate metrics (Product QA runs these; the Architect does not decide by feel)
- **Adoption:** at the first real client, by end of week 2, ≥70% of leads have an outcome logged within 48h. Below → add sheet-import path and investigate before any other feature.
- **Time to first report:** < 15 min from CSV upload.
- **Time to first call** shown correctly for every lead (the number the owner will quote).
- **CAPI delivery:** ≥95% of outcomes acknowledged by Meta within 24h.
- Trial → paid target 10% (agencies see their own data; higher than TrueVisible's 5–8%).

## 4. Deferred (not in v0, revisit with data)
- AI lead score — trained on logged outcomes once ≥2,000 exist.
- AI classification of free-text remarks — unnecessary while outcomes are structured.
- Sheet-import path — only if adoption gate fails or a client refuses caller logins.
- GHL write-back, WhatsApp nurture, landing pages, forms — GHL upsell, separate.
- White-label — data model only (same as TrueVisible), UI v2.

## 5. Data model — shared with TrueVisible (Supabase, RLS by tenant)
`tenants` (direct | agency | agency_client) · `brands` (agency_id, white_label) · `users` (role: agency_owner | account_manager | marketer | client_owner | caller | sales_head) · `ad_accounts` · `campaigns/adsets/ads` (synced) · `leads` (brand_id, source, received_at, assigned_to, form fields jsonb) · `touches` (lead_id, caller_id, at, outcome, remark, next_follow_up) · `capi_events` (lead_id, event, sent_at, ack) · `reports` (weekly) · `subscriptions` · `usage_costs`. Reuse TrueVisible's `tenants / brands / subscriptions / usage_costs` tables and `agency_id / white_label / billing_owner` fields exactly.

## 6. Build order, 15 days (Architect ~2h/day + Web Builder)
Days 1–3 schema + auth + Meta Lead Ads sync + CSV import + first report · Days 4–7 lead inbox, caller card, WhatsApp ping, assignment · Days 8–9 CAPI sender · Days 10–12 dashboard views + export · Day 13 Monday email + Razorpay trial/paywall · Day 14 Product QA runs §2 and §3 from a fresh account · Day 15 fix list; go/no-go.

## 7. Before day 1 (the assignment from office hours)
Build nothing until this is done: make the Lead Accountability report by hand from a real account's leads + calling remarks (ESM if the sheet survives); show it to five agency owners; ask each what they would pay for it weekly on one client; ask one for ₹2,000 to run it on one account for 30 days. Two numbers out of five → sprint starts with evidence. Zero → the sprint waits, and we find out why.

## 8. Decisions recorded today
Buyer = agency owner; client is the second reader with the larger risk · callers work inside TrueLead (Architect's call over the sheet-reader proposal; adoption gate protects it) · dashboard over weekly-email-only · no GHL in the pipeline · AI score deferred · shared data model with TrueVisible · B2C clients reached through TGL's own retainers, not a separate software SKU.
