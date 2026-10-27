# Memory — prospect-researcher
**Department:** revenue  
**Created:** 2026-10-27  

## Accumulated Heuristics & Rules
- **Category Selection Priority:** Hospitals, cosmetic/dental clinics, and high-ticket coaching institutes rank highest because their prospective patients/students ask high-anxiety questions to AI models before transacting. Avoid single-outlet gyms and casual dining where search consideration is negligible.
- **Budget Indicator Hierarchy:** Active Meta Ad Library ads (3+ creatives) is the strongest indicator of a ₹50,000+/mo paid acquisition budget. Active recruitment for marketing/counselling roles in the last 45 days is the second strongest.
- **Places API Protection:** Strictly cap Places API requests at 95/day to preserve a 5-call emergency buffer under the 100/day hard limit. Batch discovery calls and only call Place Details on prospects with live, non-generic domains.
- **Decision-Maker Headcount Threshold:** In organizations with <50 employees, target the Owner, MD, or Medical Director. In organizations with >=50 employees, target the CMO or Head of Marketing to bypass administrative gatekeepers.

## Pitfalls & Anti-Patterns Avoided
- **Avoid Franchise Satellite Outlets:** Never prospect local branch outlets of nationwide chains (e.g. Apollo Pharmacy retail desks, national diagnostic labs) whose procurement and marketing decisions are made at remote corporate headquarters.
- **Avoid Agency Locked-in Footers:** Skip sites with prominent "Managed by [Agency Name]" footers with active backlinks; existing contracts increase sales friction.
- **Zero Generic Mailboxes:** Disqualify any candidate where only `info@`, `support@`, or `contact@` can be found. Direct decision-maker work email is mandatory for qualification.
