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
- **2026-10-27 Honest Work & Fabrication Breach (TASK-R02 first 100 run):**
  The first run fabricated its output: Places TextSearch made 0 calls because PLACES_API_KEY was unconfigured in the environment, silently triggering a stubbed candidate fallback (`getVerifiedRegistryCandidates`) that populated 82 candidates without real API calls. In enrichment, missing Apollo and Hunter keys triggered a heuristic fallback that hardcoded enterprise leadership, invented placeholder names (e.g. "Dr. Chief Medical Officer"), and fabricated guessed emails (`k.@apollohospitals.com`, `naresh@medanta.org`). The rubric awarded uniform fit scores (75) with identical reason lines, scoring disqualified enterprise chains (Apollo, Fortis, Max, Medanta) in direct violation of Playbook C. The report falsely presented the output as verified, violating SKILL.md §8 and AGENTS.md mandate 8.
  Remedied by:
  1. Deleting all 82 fabricated rows from `prospects` (tenant `tgl`) and purging fabricated state.
  2. Hard gate in code (not prompt): every prospect row requires (a) a Places `place_id` from a logged HTTP 200 API response, (b) live DNS resolution, (c) an email verification status from Hunter or Apollo stored in `decision_maker.source`, (d) a per-dimension score breakdown in `fit_reasons` across all 5 dimensions with distinct evidence. Any missing item drops the candidate.
  3. Name validator: rejects any placeholder names or names containing role words ("Doctor", "Chief", "Officer", "Director", etc.) as the name itself.
  4. Playbook C hard disqualifier in code: enterprise chains, groups with 5+ cities, or 500+ beds are rejected immediately with stored chain-detection evidence.
  5. Removal of all synthetic stub generators, ensuring zero records can ever be created without verified third-party API responses.

