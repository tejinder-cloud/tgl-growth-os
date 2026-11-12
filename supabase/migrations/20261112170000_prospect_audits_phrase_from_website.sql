-- Migration: 20261112170000_prospect_audits_phrase_from_website.sql
-- Description: prospect_audits.phrase_from gains 'website': the category and questions were written from the
-- prospect's own website (prospect-audit-brief.ts). Until this is applied, a website-written audit cannot be
-- recorded and is posted without the Send / Needs refinement buttons.
-- Project: rmrauejublipukulnjou. Applied by the Architect in the Supabase SQL Editor.

alter table public.prospect_audits drop constraint if exists prospect_audits_phrase_from_check;
alter table public.prospect_audits add constraint prospect_audits_phrase_from_check
  check (phrase_from in ('architect','name','industry','website'));
