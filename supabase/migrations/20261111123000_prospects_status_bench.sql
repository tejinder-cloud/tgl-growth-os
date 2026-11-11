-- Migration: 20261111123000_prospects_status_bench.sql
-- Description: prospects.status accepts 'bench' and 'nurture' (rubric v2 bench rotation, issues #171 and #177).
-- Applied by the Architect in the Supabase SQL Editor on 11 Nov 2026 12:38 IST (verified: constraint now lists both).
-- Project: rmrauejublipukulnjou

alter table public.prospects drop constraint if exists prospects_status_check;
alter table public.prospects add constraint prospects_status_check
  check (status = any (array['new','reviewed','rejected','handed_to_outreach','bench','nurture']));
