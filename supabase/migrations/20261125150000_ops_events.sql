-- One record of what the system did (25 Nov 2026), replacing GitHub log files as the source the dashboard reads.
-- One row per event: a time, which part of the system, what kind of thing, and one plain sentence.
-- Applied by Claude through the Supabase connection at the Architect's request (24 Nov 2026).

create table if not exists public.ops_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'tgl' references public.tenants(id),
  at timestamptz not null default now(),
  -- Which part of the system: prospect-researcher, outreach-sequencer, aeo-audit-engine, booking, system ...
  agent text not null,
  -- What kind of thing: run, sent, held, reply, bounce, approved, rejected, card, check, booked, error
  kind text not null,
  -- One sentence in plain words. Business names are fine; never a person's email or phone number.
  summary text not null,
  prospect_id uuid references public.prospects(id) on delete set null,
  detail jsonb not null default '{}'::jsonb
);
comment on table public.ops_events is 'What the system did, one row per event. Read by the private dashboard; written only by the service.';

create index if not exists ops_events_tenant_at on public.ops_events (tenant_id, at desc);
create index if not exists ops_events_kind_at on public.ops_events (tenant_id, kind, at desc);

alter table public.ops_events enable row level security;
revoke all on public.ops_events from anon, authenticated;
