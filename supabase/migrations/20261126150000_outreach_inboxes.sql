-- Sending inboxes for cold email (26 Nov 2026): free Gmail accounts the Architect connects, used in rotation.
-- Each inbox warms up from its warm_start date (5 a day, rising weekly). Its Google sign-in is kept in Vault,
-- never in this table. Applied by Claude through the Supabase connection at the Architect's request.

create table if not exists public.outreach_inboxes (
  email text primary key,
  tenant_id text not null default 'tgl' references public.tenants(id),
  status text not null default 'active' check (status in ('active', 'paused')),
  warm_start date not null default current_date,
  paused_reason text,
  connected_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.outreach_inboxes is 'Gmail inboxes that send cold email in rotation. Tokens live in Vault (outreach_inbox:<email>).';
alter table public.outreach_inboxes enable row level security;
revoke all on public.outreach_inboxes from anon, authenticated;

create or replace function public.svc_set_inbox_token(p_email text, p_token text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_id uuid; v_name text := 'outreach_inbox:' || lower(trim(p_email));
begin
  select s.id into v_id from vault.secrets s where s.name = v_name;
  if v_id is null then perform vault.create_secret(p_token, v_name, 'Google refresh token for an outreach sending inbox');
  else perform vault.update_secret(v_id, p_token); end if;
end $$;

create or replace function public.svc_inbox_token(p_email text)
returns text language sql security definer set search_path to '' as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'outreach_inbox:' || lower(trim(p_email));
$$;

revoke execute on function public.svc_set_inbox_token(text, text) from public, anon, authenticated;
revoke execute on function public.svc_inbox_token(text) from public, anon, authenticated;
grant execute on function public.svc_set_inbox_token(text, text) to service_role;
grant execute on function public.svc_inbox_token(text) to service_role;
