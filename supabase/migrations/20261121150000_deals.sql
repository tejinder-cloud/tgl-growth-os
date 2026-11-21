-- Sales pipeline (Architect, 21 Nov 2026): one row per business that might pay us, in exactly one stage.
-- Applied by the Architect in the Supabase SQL Editor.

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'tgl' references public.tenants(id),
  company text not null,
  contact_name text,
  contact_email text,
  city text,
  source text not null check (source in ('outreach', 'site', 'booking', 'manual')),
  prospect_id uuid references public.prospects(id),
  site_lead_id uuid references public.site_leads(id),
  booking_id uuid references public.bookings(id),
  stage text not null check (stage in ('in_outreach', 'audit_requested', 'replied', 'call_booked', 'call_done', 'proposal_sent', 'won', 'lost')),
  -- The proposal: one amount per month, in rupees or US dollars (Architect, 21 Nov 2026).
  amount numeric(12, 2) check (amount is null or amount > 0),
  currency text check (currency is null or currency in ('INR', 'USD')),
  lost_reason text,
  no_show boolean not null default false,
  call_at timestamptz,
  call_prompted_at timestamptz,
  -- Every move: [{ "stage": "...", "at": "...", "by": "..." }]
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.deals is 'Sales pipeline. Stages move automatically where the system knows (outreach, audit form, reply, booking) and by the Architect''s tap after a call.';

-- One open deal per contact email: a second signal for the same person moves the existing deal.
create unique index if not exists deals_one_open_per_email on public.deals (tenant_id, lower(contact_email))
  where contact_email is not null and stage not in ('won', 'lost');

alter table public.deals enable row level security;
revoke all on public.deals from anon, authenticated;
