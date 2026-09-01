-- Keep completed Poll Center records for 30 days, then permanently remove them.
-- Deleting a poll cascades to its options, votes, and event records.

create extension if not exists pg_cron;

create index if not exists polls_archive_retention_idx
  on public.polls (updated_at)
  where status in ('closed', 'cancelled');

create or replace function public.poll_purge_expired_archive()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  with deleted as (
    delete from public.polls
    where status in ('closed', 'cancelled')
      and updated_at <= now() - interval '30 days'
    returning id
  )
  select count(*)::integer into v_deleted from deleted;

  return v_deleted;
end;
$$;

revoke all on function public.poll_purge_expired_archive()
from public, anon, authenticated;

grant execute on function public.poll_purge_expired_archive()
to service_role;

select cron.schedule(
  'poll-archive-retention-30-days',
  '15 5 * * *',
  $$select public.poll_purge_expired_archive();$$
);

-- Apply the same retention rule immediately to any existing older records.
select public.poll_purge_expired_archive();
