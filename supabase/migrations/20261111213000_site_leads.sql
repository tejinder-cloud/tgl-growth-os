-- Migration: 20261111213000_site_leads.sql
-- Description: website lead forms (POST /aeo/lead, POST /automation/lead). Save-first store; GHL outcome recorded.
-- Personal data kept to the DPDP minimum: name, business, work email, work phone, what the visitor typed.
-- Project: rmrauejublipukulnjou. Applied by the Architect in the Supabase SQL Editor.

create table if not exists public.site_leads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('aeo','automation')),
  business_name text not null,
  name text not null,
  email text not null,
  phone text,
  website text,
  industry text check (industry is null or industry in ('healthcare','education','hospitality','realestate','ecommerce','saas','other')),
  city text,
  for_slug text,
  job text check (job is null or job in ('enquiries','followup','qualify','booking','reports','other')),
  message text,
  consent boolean not null default true,
  source text,
  page text,
  campaign jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  ghl_contact_id text,
  ghl_opportunity_id text,
  ghl_error text,
  ghl_at timestamptz,
  status text not null default 'new' check (status in ('new','contacted','audit_sent','booked','closed','spam')),
  created_at timestamptz not null default now()
);

comment on table public.site_leads is 'Leads from the website forms. Row first, then GoHighLevel; the row is the record.';
create index if not exists idx_site_leads_created on public.site_leads (created_at desc);
create index if not exists idx_site_leads_email on public.site_leads (lower(email));
create index if not exists idx_site_leads_status on public.site_leads (status);

alter table public.site_leads enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'site_leads' and policyname = 'service_role_full_access_site_leads') then
    create policy service_role_full_access_site_leads on public.site_leads for all to service_role using (true) with check (true);
  end if;
end $$;
