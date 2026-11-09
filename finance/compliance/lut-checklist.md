# LUT export compliance checklist (owner: Compliance)

Purpose: before TGL invoices any buyer outside India for services, confirm the supply qualifies as an export of services and that a valid Letter of Undertaking (LUT) is in force, so the invoice can be zero-rated without paying IGST.

Status of this document: working checklist prepared by Finance. It is not tax advice. Every item marked CA must be confirmed by TGL's chartered accountant before the first export invoice. Nothing here has been filed.

Trigger: the Finance service holds any Won deal whose buyer country is not India and posts a "Compliance task" line. The service creates no invoice for these deals.

## A. Is it an export of services? (all five must be true; CA to confirm)
- [ ] Supplier (TGL) is located in India.
- [ ] Recipient is located outside India.
- [ ] Place of supply of the service is outside India.
- [ ] Payment is received in convertible foreign exchange, or in INR where RBI permits it.
- [ ] Supplier and recipient are not merely establishments of the same legal person.
- [ ] Record the buyer's legal name, country, registered address and any foreign tax ID in the deal notes.

## B. LUT in force
- [ ] Check whether a LUT exists for the financial year of the invoice date (LUT is filed per financial year).
- [ ] If none: file the LUT on the GST portal (Form GST RFD-11) before issuing the first zero-rated invoice of that year. CA / authorised signatory files with DSC or EVC.
- [ ] Record the LUT ARN and validity year. Set FINANCE_LUT_NUMBER to the ARN (Architect action).
- [ ] Put a calendar reminder to renew before 1 April each year.
- [ ] If a LUT cannot be obtained, the alternative is to pay IGST and claim a refund. That is a CA and Architect decision; do not default to it.

## C. Invoice content (CA to confirm exact wording)
- [ ] Invoice raised in the currency agreed with the buyer; record the currency and the rupee equivalent method used.
- [ ] Mark the supply as export of services under LUT, quoting the LUT ARN, tax charged at nil.
- [ ] Supplier GSTIN, SAC code, invoice number in the TGL consecutive series, date, buyer details.
- [ ] Invoice is created manually in the provider. Draft only until the Architect issues it.

## D. After the invoice
- [ ] Track receipt of foreign exchange against the invoice. Keep the bank advice and the inward remittance certificate (FIRC or equivalent) on file.
- [ ] Confirm with the CA the time limit for realisation of payment under the GST rules and the consequence of missing it; add the invoice due date plus that limit to the calendar.
- [ ] Report the invoice as a zero-rated export in the GST return for the period (CA).
- [ ] Add the income to finance/ledger with the INR amount actually realised. Never book a guessed FX rate.

## E. Close-out
- [ ] Compliance records the LUT ARN, filing date and validity in finance/compliance/ and tells the Architect in one line.
- [ ] Finance re-runs the held deal once FINANCE_LUT_NUMBER is set and the Architect approves.

Open questions for the Architect (answer on the card):
1. Does TGL expect any non-India buyers in the next quarter? If not, this checklist stays dormant and no LUT needs filing yet.
2. Which CA signs off the export conditions and files the LUT?
3. In which currency would an export be invoiced, and which bank account receives it?
