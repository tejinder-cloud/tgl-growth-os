-- Booking page (Architect, 21 Nov 2026): call bookings and the Google sign-in for the bookings calendar.
-- Applied by the Architect in the Supabase SQL Editor.

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'tgl' references public.tenants(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- pending: slot held while Google creates the event; booked: Google confirmed; cancelled: released.
  status text not null default 'pending' check (status in ('pending', 'booked', 'cancelled')),
  guest_name text not null,
  guest_email text not null,
  company text not null,
  note text,
  prospect_id uuid references public.prospects(id),
  event_id text,
  meet_url text,
  created_at timestamptz not null default now()
);
comment on table public.bookings is 'Calls booked on /book. A row is booked only after Google Calendar confirmed the event.';

-- One live booking per slot: a second request for the same slot fails at the database, not just in code.
create unique index if not exists bookings_one_per_slot on public.bookings (tenant_id, starts_at) where status in ('pending', 'booked');

alter table public.bookings enable row level security;
revoke all on public.bookings from anon, authenticated;

-- The refresh token for the bookings calendar lives in Vault, read and written only by the service role.
create or replace function public.svc_set_booking_refresh_token(p_token text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  select s.id into v_id from vault.secrets s where s.name = 'booking_google_refresh';
  if v_id is null then perform vault.create_secret(p_token, 'booking_google_refresh', 'Google refresh token for the bookings calendar');
  else perform vault.update_secret(v_id, p_token); end if;
end $$;

create or replace function public.svc_booking_refresh_token()
returns text language sql security definer set search_path to '' as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'booking_google_refresh';
$$;

revoke execute on function public.svc_set_booking_refresh_token(text) from public, anon, authenticated;
revoke execute on function public.svc_booking_refresh_token() from public, anon, authenticated;
grant execute on function public.svc_set_booking_refresh_token(text) to service_role;
grant execute on function public.svc_booking_refresh_token() to service_role;
