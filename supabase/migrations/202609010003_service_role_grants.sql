-- Required because this project does not automatically expose/grant new tables.
-- The service role is used only inside the poll-center-api Edge Function.

grant usage on schema public to service_role;

grant select, insert, update, delete
on table
  public.poll_staff,
  public.polls,
  public.poll_options,
  public.poll_votes,
  public.poll_events
to service_role;

grant usage, select
on sequence public.poll_events_id_seq
to service_role;

grant execute on function public.poll_is_staff(uuid) to service_role;
grant execute on function public.poll_close_expired() to service_role;
grant execute on function public.poll_create(text, uuid, text, timestamptz, text, jsonb) to service_role;
grant execute on function public.poll_update(uuid, uuid, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.poll_change_status(uuid, uuid, text) to service_role;
grant execute on function public.poll_submit_vote(uuid, uuid, text) to service_role;
