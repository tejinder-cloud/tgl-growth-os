-- Migration: 20261112160000_prospect_audits.sql
-- Description: one row per prospect audit posted to #revenue for the Architect's review (decisions/2026-11-12.md).
-- Holds the PDF itself, so "Send on email" works after a redeploy, and the outcome of each review:
-- sent as it was, or refined first. That record is the basis for any later decision to send without review.
-- Personal data kept to the DPDP minimum: contact name and work email, only when given for this request.
-- Project: rmrauejublipukulnjou. Applied by the Architect in the Supabase SQL Editor.

create table if not exists public.prospect_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'tgl',
  site_lead_id uuid references public.site_leads(id) on delete set null,
  refined_from uuid references public.prospect_audits(id) on delete set null,
  source text not null check (source in ('site_lead','architect','outreach')),
  business_name text not null,
  domain text not null,
  category_phrase text not null,
  phrase_from text not null check (phrase_from in ('architect','name','industry')),
  city text,
  prompts jsonb not null,
  total_mentions integer not null,
  total_queries integer not null,
  summary jsonb not null default '{}'::jsonb,
  cost_usd numeric(10,4) not null default 0,
  pdf_filename text not null,
  pdf_base64 text not null,
  contact_name text,
  contact_email text,
  slack_channel text,
  slack_ts text,
  slack_file_id text,
  status text not null default 'ready' check (status in ('ready','sending','sent','send_failed','refined')),
  sent_to text,
  sent_at timestamptz,
  email_id text,
  send_error text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.prospect_audits is 'Prospect audits awaiting or past the Architect''s review. An audit is emailed only on his tap; status and decided_by record it.';
create index if not exists idx_prospect_audits_created on public.prospect_audits (created_at desc);
create index if not exists idx_prospect_audits_status on public.prospect_audits (status);
create index if not exists idx_prospect_audits_domain on public.prospect_audits (domain);

alter table public.prospect_audits enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'prospect_audits' and policyname = 'service_role_full_access_prospect_audits') then
    create policy service_role_full_access_prospect_audits on public.prospect_audits for all to service_role using (true) with check (true);
  end if;
end $$;
