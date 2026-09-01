-- Direct Twitch chat delivery for Poll Center.
-- OAuth tokens are encrypted with Supabase Vault and are never exposed to browsers.

create table if not exists public.poll_twitch_connection (
  singleton boolean primary key default true check (singleton),
  sender_user_id text not null,
  sender_login text not null,
  broadcaster_user_id text not null,
  broadcaster_login text not null,
  access_secret_id uuid not null,
  refresh_secret_id uuid not null,
  token_expires_at timestamptz not null,
  scopes text[] not null default '{}',
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text
);

create table if not exists public.poll_twitch_oauth_states (
  state_hash text primary key,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.poll_events
  add column if not exists delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'failed')),
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivery_last_error text,
  add column if not exists delivered_at timestamptz,
  add column if not exists external_message_id text;

-- Preserve acknowledgement history from the retired Streamer.bot delivery path.
update public.poll_events
set delivery_status = 'sent',
    delivery_attempts = greatest(delivery_attempts, 1),
    delivered_at = coalesce(delivered_at, acknowledged_at, created_at)
where acknowledged_at is not null
  and delivery_status = 'pending';

create index if not exists poll_events_delivery_idx
  on public.poll_events (created_at)
  where delivery_status in ('pending', 'failed');

create index if not exists poll_twitch_oauth_states_expiry_idx
  on public.poll_twitch_oauth_states (expires_at);

alter table public.poll_twitch_connection enable row level security;
alter table public.poll_twitch_oauth_states enable row level security;

revoke all on table public.poll_twitch_connection from anon, authenticated;
revoke all on table public.poll_twitch_oauth_states from anon, authenticated;

grant select, insert, update, delete
on table public.poll_twitch_connection, public.poll_twitch_oauth_states
to service_role;

create or replace function public.poll_twitch_store_connection(
  p_actor uuid,
  p_sender_user_id text,
  p_sender_login text,
  p_broadcaster_user_id text,
  p_broadcaster_login text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_scopes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access_secret_id uuid;
  v_refresh_secret_id uuid;
begin
  if not exists (
    select 1 from public.poll_staff
    where user_id = p_actor and role = 'owner' and active
  ) then
    raise exception 'poll_owner_required';
  end if;

  select access_secret_id, refresh_secret_id
  into v_access_secret_id, v_refresh_secret_id
  from public.poll_twitch_connection
  where singleton;

  if v_access_secret_id is null then
    select vault.create_secret(
      p_access_token,
      'poll_twitch_access_' || pg_catalog.gen_random_uuid()::text,
      'Poll Center ThyToxicBot access token'
    ) into v_access_secret_id;
  else
    perform vault.update_secret(v_access_secret_id, p_access_token);
  end if;

  if v_refresh_secret_id is null then
    select vault.create_secret(
      p_refresh_token,
      'poll_twitch_refresh_' || pg_catalog.gen_random_uuid()::text,
      'Poll Center ThyToxicBot refresh token'
    ) into v_refresh_secret_id;
  else
    perform vault.update_secret(v_refresh_secret_id, p_refresh_token);
  end if;

  insert into public.poll_twitch_connection (
    singleton,
    sender_user_id,
    sender_login,
    broadcaster_user_id,
    broadcaster_login,
    access_secret_id,
    refresh_secret_id,
    token_expires_at,
    scopes,
    connected_by,
    connected_at,
    updated_at,
    last_error
  ) values (
    true,
    p_sender_user_id,
    lower(p_sender_login),
    p_broadcaster_user_id,
    lower(p_broadcaster_login),
    v_access_secret_id,
    v_refresh_secret_id,
    p_expires_at,
    coalesce(p_scopes, '{}'),
    p_actor,
    now(),
    now(),
    null
  )
  on conflict (singleton) do update set
    sender_user_id = excluded.sender_user_id,
    sender_login = excluded.sender_login,
    broadcaster_user_id = excluded.broadcaster_user_id,
    broadcaster_login = excluded.broadcaster_login,
    access_secret_id = excluded.access_secret_id,
    refresh_secret_id = excluded.refresh_secret_id,
    token_expires_at = excluded.token_expires_at,
    scopes = excluded.scopes,
    connected_by = excluded.connected_by,
    connected_at = now(),
    updated_at = now(),
    last_error = null;
end;
$$;

create or replace function public.poll_twitch_get_connection()
returns table (
  sender_user_id text,
  sender_login text,
  broadcaster_user_id text,
  broadcaster_login text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[],
  connected_at timestamptz,
  last_success_at timestamptz,
  last_error text
)
language sql
security definer
set search_path = ''
as $$
  select
    connection.sender_user_id,
    connection.sender_login,
    connection.broadcaster_user_id,
    connection.broadcaster_login,
    access_secret.decrypted_secret,
    refresh_secret.decrypted_secret,
    connection.token_expires_at,
    connection.scopes,
    connection.connected_at,
    connection.last_success_at,
    connection.last_error
  from public.poll_twitch_connection connection
  join vault.decrypted_secrets access_secret
    on access_secret.id = connection.access_secret_id
  join vault.decrypted_secrets refresh_secret
    on refresh_secret.id = connection.refresh_secret_id
  where connection.singleton;
$$;

create or replace function public.poll_twitch_update_tokens(
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_scopes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access_secret_id uuid;
  v_refresh_secret_id uuid;
begin
  select access_secret_id, refresh_secret_id
  into v_access_secret_id, v_refresh_secret_id
  from public.poll_twitch_connection
  where singleton;

  if v_access_secret_id is null or v_refresh_secret_id is null then
    raise exception 'poll_twitch_not_connected';
  end if;

  perform vault.update_secret(v_access_secret_id, p_access_token);
  perform vault.update_secret(v_refresh_secret_id, p_refresh_token);

  update public.poll_twitch_connection
  set token_expires_at = p_expires_at,
      scopes = coalesce(p_scopes, scopes),
      updated_at = now(),
      last_error = null
  where singleton;
end;
$$;

create or replace function public.poll_twitch_mark_delivery(
  p_event_id bigint,
  p_status text,
  p_message_id text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'invalid_delivery_status';
  end if;

  update public.poll_events
  set delivery_status = p_status,
      delivery_attempts = delivery_attempts + 1,
      delivery_last_error = case when p_status = 'failed' then left(p_error, 500) else null end,
      delivered_at = case when p_status = 'sent' then now() else delivered_at end,
      external_message_id = coalesce(p_message_id, external_message_id),
      acknowledged_at = case when p_status = 'sent' then now() else acknowledged_at end
  where id = p_event_id;

  update public.poll_twitch_connection
  set last_success_at = case when p_status = 'sent' then now() else last_success_at end,
      last_error = case when p_status = 'failed' then left(p_error, 500) else null end,
      updated_at = now()
  where singleton;
end;
$$;

revoke all on function public.poll_twitch_store_connection(uuid, text, text, text, text, text, text, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.poll_twitch_get_connection() from public, anon, authenticated;
revoke all on function public.poll_twitch_update_tokens(text, text, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.poll_twitch_mark_delivery(bigint, text, text, text) from public, anon, authenticated;

grant execute on function public.poll_twitch_store_connection(uuid, text, text, text, text, text, text, timestamptz, text[]) to service_role;
grant execute on function public.poll_twitch_get_connection() to service_role;
grant execute on function public.poll_twitch_update_tokens(text, text, timestamptz, text[]) to service_role;
grant execute on function public.poll_twitch_mark_delivery(bigint, text, text, text) to service_role;
