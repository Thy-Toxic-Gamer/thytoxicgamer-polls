-- Atomic Poll Center operations used only by the poll-center-api Edge Function.

alter table public.poll_options
  drop constraint if exists poll_options_position_check;

alter table public.poll_options
  add constraint poll_options_position_check
  check (position between 0 and 99);

create or replace function public.poll_is_staff(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.poll_staff
    where user_id = p_user_id and active
  );
$$;

create or replace function public.poll_close_expired()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  with closed as (
    update public.polls
    set status = 'closed'
    where status = 'active' and closes_at <= now()
    returning id
  ), inserted as (
    insert into public.poll_events (poll_id, event_type, event_key)
    select id, 'poll_closed', 'closed' from closed
    on conflict (poll_id, event_key) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

create or replace function public.poll_create(
  p_question text,
  p_creator uuid,
  p_creator_name text,
  p_closes_at timestamptz,
  p_results_mode text,
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poll_id uuid := gen_random_uuid();
  v_option jsonb;
  v_position integer := 0;
begin
  if not public.poll_is_staff(p_creator) then
    raise exception 'poll_forbidden';
  end if;

  perform public.poll_close_expired();

  if length(btrim(coalesce(p_question, ''))) not between 3 and 180 then
    raise exception 'invalid_question';
  end if;
  if p_results_mode not in ('live', 'after_vote', 'after_close') then
    raise exception 'invalid_results_mode';
  end if;
  if p_closes_at <= now() + interval '29 seconds'
     or p_closes_at > now() + interval '30 minutes 1 second' then
    raise exception 'invalid_duration';
  end if;
  if jsonb_typeof(p_options) <> 'array'
     or jsonb_array_length(p_options) not between 2 and 10 then
    raise exception 'invalid_options';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(p_options) option_label
    where length(btrim(option_label)) not between 1 and 80
  ) then
    raise exception 'invalid_options';
  end if;
  if (
    select count(distinct lower(btrim(option_label)))
    from jsonb_array_elements_text(p_options) option_label
  ) <> jsonb_array_length(p_options) then
    raise exception 'duplicate_options';
  end if;
  if (select count(*) from public.polls where status = 'active') >= 3 then
    raise exception 'poll_limit_reached';
  end if;

  insert into public.polls (
    id, question, created_by, creator_name, closes_at, results_mode
  ) values (
    v_poll_id,
    btrim(p_question),
    p_creator,
    left(coalesce(nullif(btrim(p_creator_name), ''), 'ThyToxicGamer'), 80),
    p_closes_at,
    p_results_mode
  );

  for v_option in select value from jsonb_array_elements(p_options)
  loop
    insert into public.poll_options (poll_id, label, position)
    values (v_poll_id, btrim(v_option #>> '{}'), v_position);
    v_position := v_position + 1;
  end loop;

  insert into public.poll_events (poll_id, event_type, event_key)
  values (v_poll_id, 'poll_opened', 'opened');

  return v_poll_id;
end;
$$;

create or replace function public.poll_update(
  p_poll_id uuid,
  p_actor uuid,
  p_question text,
  p_results_mode text,
  p_reset_closes_at timestamptz,
  p_options jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option jsonb;
  v_id uuid;
  v_label text;
  v_position integer := 0;
  v_last_original_position integer := -1;
  v_original_position integer;
begin
  if not public.poll_is_staff(p_actor) then
    raise exception 'poll_forbidden';
  end if;

  perform public.poll_close_expired();
  if not exists (
    select 1 from public.polls where id = p_poll_id and status = 'active'
  ) then
    raise exception 'poll_not_active';
  end if;
  if length(btrim(coalesce(p_question, ''))) not between 3 and 180 then
    raise exception 'invalid_question';
  end if;
  if p_results_mode not in ('live', 'after_vote', 'after_close') then
    raise exception 'invalid_results_mode';
  end if;
  if p_reset_closes_at is not null and (
    p_reset_closes_at <= now() + interval '29 seconds'
    or p_reset_closes_at > now() + interval '30 minutes 1 second'
  ) then
    raise exception 'invalid_duration';
  end if;
  if jsonb_typeof(p_options) <> 'array'
     or jsonb_array_length(p_options) not between 2 and 10 then
    raise exception 'invalid_options';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_options) item
    where length(btrim(item ->> 'label')) not between 1 and 80
  ) then
    raise exception 'invalid_options';
  end if;
  if (
    select count(distinct lower(btrim(item ->> 'label')))
    from jsonb_array_elements(p_options) item
  ) <> jsonb_array_length(p_options) then
    raise exception 'duplicate_options';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_options) item
    where nullif(item ->> 'id', '') is not null
      and not exists (
        select 1 from public.poll_options current_option
        where current_option.id = (item ->> 'id')::uuid
          and current_option.poll_id = p_poll_id
      )
  ) then
    raise exception 'invalid_option';
  end if;
  if exists (
    select 1
    from public.poll_options current_option
    where current_option.poll_id = p_poll_id
      and not exists (
        select 1 from jsonb_array_elements(p_options) item
        where nullif(item ->> 'id', '')::uuid = current_option.id
      )
      and exists (
        select 1 from public.poll_votes vote
        where vote.option_id = current_option.id
      )
  ) then
    raise exception 'option_has_votes';
  end if;

  -- Existing choices may shift upward after a zero-vote choice is removed,
  -- but cannot be reordered around one another.
  for v_option in select value from jsonb_array_elements(p_options)
  loop
    v_id := nullif(v_option ->> 'id', '')::uuid;
    if v_id is not null then
      select position into v_original_position
      from public.poll_options where id = v_id and poll_id = p_poll_id;
      if v_original_position <= v_last_original_position then
        raise exception 'option_reordering_not_supported';
      end if;
      v_last_original_position := v_original_position;
    end if;
  end loop;

  delete from public.poll_options current_option
  where current_option.poll_id = p_poll_id
    and not exists (
      select 1 from jsonb_array_elements(p_options) item
      where nullif(item ->> 'id', '')::uuid = current_option.id
    );

  -- Move existing positions out of the unique range before assigning new ones.
  update public.poll_options set position = position + 20 where poll_id = p_poll_id;

  for v_option in select value from jsonb_array_elements(p_options)
  loop
    v_id := nullif(v_option ->> 'id', '')::uuid;
    v_label := btrim(v_option ->> 'label');
    if v_id is null then
      insert into public.poll_options (poll_id, label, position)
      values (p_poll_id, v_label, v_position);
    else
      update public.poll_options
      set label = v_label, position = v_position
      where id = v_id and poll_id = p_poll_id;
    end if;
    v_position := v_position + 1;
  end loop;
  update public.polls
  set question = btrim(p_question),
      results_mode = p_results_mode,
      closes_at = coalesce(p_reset_closes_at, closes_at)
  where id = p_poll_id and status = 'active';

  insert into public.poll_events (poll_id, event_type, event_key)
  values (p_poll_id, 'poll_updated', 'updated-' || extract(epoch from clock_timestamp())::text);
end;
$$;

create or replace function public.poll_change_status(
  p_poll_id uuid,
  p_actor uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.poll_is_staff(p_actor) then
    raise exception 'poll_forbidden';
  end if;
  if p_status not in ('closed', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  update public.polls
  set status = p_status
  where id = p_poll_id and status = 'active';

  if not found then
    raise exception 'poll_not_active';
  end if;

  insert into public.poll_events (poll_id, event_type, event_key)
  values (
    p_poll_id,
    case when p_status = 'closed' then 'poll_closed' else 'poll_cancelled' end,
    p_status
  );
end;
$$;

create or replace function public.poll_submit_vote(
  p_poll_id uuid,
  p_option_id uuid,
  p_voter_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.poll_close_expired();

  if not exists (
    select 1 from public.polls
    where id = p_poll_id and status = 'active' and closes_at > now()
  ) then
    raise exception 'poll_not_active';
  end if;
  if not exists (
    select 1 from public.poll_options
    where id = p_option_id and poll_id = p_poll_id
  ) then
    raise exception 'invalid_option';
  end if;

  insert into public.poll_votes (poll_id, option_id, voter_key)
  values (p_poll_id, p_option_id, p_voter_key);
exception
  when unique_violation then
    raise exception 'already_voted';
end;
$$;

revoke all on function public.poll_is_staff(uuid) from public, anon, authenticated;
revoke all on function public.poll_close_expired() from public, anon, authenticated;
revoke all on function public.poll_create(text, uuid, text, timestamptz, text, jsonb) from public, anon, authenticated;
revoke all on function public.poll_update(uuid, uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.poll_change_status(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.poll_submit_vote(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.poll_is_staff(uuid) to service_role;
grant execute on function public.poll_close_expired() to service_role;
grant execute on function public.poll_create(text, uuid, text, timestamptz, text, jsonb) to service_role;
grant execute on function public.poll_update(uuid, uuid, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.poll_change_status(uuid, uuid, text) to service_role;
grant execute on function public.poll_submit_vote(uuid, uuid, text) to service_role;
