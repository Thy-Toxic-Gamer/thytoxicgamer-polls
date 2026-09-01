-- Poll Center v1.0 for the existing Polls | Appeals Center Supabase project.
-- All objects are isolated with poll_ names. Existing Appeals data is untouched.

create extension if not exists pgcrypto;

create table if not exists public.poll_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'moderator')),
  display_name text not null default 'Poll Center Staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(question) between 3 and 180),
  created_by uuid references auth.users(id) on delete set null,
  creator_name text not null default 'ThyToxicGamer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closes_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'closed', 'cancelled')),
  poll_style text not null default 'multiple'
    check (poll_style = 'multiple'),
  results_mode text not null default 'after_vote'
    check (results_mode in ('live', 'after_vote', 'after_close'))
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  position smallint not null check (position between 0 and 9),
  created_at timestamptz not null default now(),
  unique (poll_id, position)
);

create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  voter_key text not null check (char_length(voter_key) between 12 and 180),
  created_at timestamptz not null default now(),
  primary key (poll_id, voter_key)
);

create table if not exists public.poll_events (
  id bigint generated always as identity primary key,
  poll_id uuid not null references public.polls(id) on delete cascade,
  event_type text not null check (
    event_type in ('poll_opened', 'poll_updated', 'poll_closed', 'poll_cancelled')
  ),
  event_key text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique (poll_id, event_key)
);

create index if not exists poll_staff_active_idx
  on public.poll_staff (user_id) where active;

create index if not exists polls_active_created_idx
  on public.polls (created_at)
  where status = 'active';

create index if not exists polls_recent_idx
  on public.polls (created_at desc);

create index if not exists poll_options_poll_idx
  on public.poll_options (poll_id, position);

create index if not exists poll_votes_option_idx
  on public.poll_votes (option_id);

create index if not exists poll_events_pending_idx
  on public.poll_events (created_at)
  where acknowledged_at is null;

create or replace function public.poll_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists poll_staff_set_updated_at on public.poll_staff;
create trigger poll_staff_set_updated_at
before update on public.poll_staff
for each row execute function public.poll_set_updated_at();

drop trigger if exists polls_set_updated_at on public.polls;
create trigger polls_set_updated_at
before update on public.polls
for each row execute function public.poll_set_updated_at();

create or replace function public.poll_validate_vote_option()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.poll_options
    where id = new.option_id and poll_id = new.poll_id
  ) then
    raise exception 'The selected option does not belong to this poll.';
  end if;
  return new;
end;
$$;

drop trigger if exists poll_votes_validate_option on public.poll_votes;
create trigger poll_votes_validate_option
before insert or update on public.poll_votes
for each row execute function public.poll_validate_vote_option();

alter table public.poll_staff enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.poll_events enable row level security;

drop policy if exists "Poll staff can view own access" on public.poll_staff;
create policy "Poll staff can view own access"
on public.poll_staff
for select
to authenticated
using ((select auth.uid()) = user_id and active);

revoke all on table public.poll_staff from anon, authenticated;
revoke all on table public.polls from anon, authenticated;
revoke all on table public.poll_options from anon, authenticated;
revoke all on table public.poll_votes from anon, authenticated;
revoke all on table public.poll_events from anon, authenticated;

grant select on table public.poll_staff to authenticated;

comment on table public.poll_staff is
  'Poll Center owner and moderator authorization. Separate from Appeals staff.';
comment on table public.polls is
  'Poll Center polls. Public and staff access is mediated by the poll-center-api Edge Function.';
comment on table public.poll_votes is
  'One browser vote per poll, enforced by the primary key.';
