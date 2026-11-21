-- WhatsApp coexistence connection (Architect, 21 Nov 2026): which WhatsApp account and number the service sends
-- from, and the business token Meta returns, kept in Vault. Applied by the Architect in the Supabase SQL Editor.

create table if not exists public.whatsapp_connection (
  id text primary key default 'tgl' check (id = 'tgl'),
  waba_id text not null,
  phone_number_id text,
  display_number text,
  webhooks_subscribed boolean not null default false,
  connected_at timestamptz not null default now(),
  connected_by text
);
comment on table public.whatsapp_connection is 'The one WhatsApp number TGL sends outreach from (coexistence). The token is in Vault, never here.';
alter table public.whatsapp_connection enable row level security;
revoke all on public.whatsapp_connection from anon, authenticated;

create or replace function public.svc_set_whatsapp_token(p_token text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  select s.id into v_id from vault.secrets s where s.name = 'whatsapp_business_token';
  if v_id is null then perform vault.create_secret(p_token, 'whatsapp_business_token', 'Business token for the TGL WhatsApp number (Embedded Signup)');
  else perform vault.update_secret(v_id, p_token); end if;
end $$;

create or replace function public.svc_whatsapp_token()
returns text language sql security definer set search_path to '' as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'whatsapp_business_token';
$$;

revoke execute on function public.svc_set_whatsapp_token(text) from public, anon, authenticated;
revoke execute on function public.svc_whatsapp_token() from public, anon, authenticated;
grant execute on function public.svc_set_whatsapp_token(text) to service_role;
grant execute on function public.svc_whatsapp_token() to service_role;
