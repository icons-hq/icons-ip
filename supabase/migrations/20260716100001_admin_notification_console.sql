-- Audited, immediate in-app announcement fan-out for staff operations (#105).

create index audit_log_admin_notification_sent_idx
  on public.audit_log (created_at desc, id desc)
  where action = 'admin.notification.sent';

create or replace function public.admin_estimate_notification_recipients(
  target_scope text,
  target_ip_id text default null
)
returns table (
  scope text,
  ip_id text,
  ip_title text,
  recipient_count bigint,
  can_send boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_scope text := pg_catalog.btrim(target_scope, E' \t\n\r\f\v');
  normalized_ip_id text := nullif(
    pg_catalog.btrim(target_ip_id, E' \t\n\r\f\v'),
    ''
  );
  selected_ip_title text;
  estimated_recipient_count bigint;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_scope is null
    or normalized_scope not in ('all', 'ip_followers')
  then
    raise exception 'invalid_notification_scope' using errcode = '22023';
  end if;

  if normalized_scope = 'all' then
    if normalized_ip_id is not null then
      raise exception 'invalid_notification_target' using errcode = '22023';
    end if;

    select pg_catalog.count(*)
      into estimated_recipient_count
    from public.profiles;
  else
    if normalized_ip_id is null then
      raise exception 'invalid_notification_target' using errcode = '22023';
    end if;

    select ip.title
      into selected_ip_title
    from public.ips as ip
    where ip.id = normalized_ip_id;

    if not found then
      raise exception 'ip_not_found' using errcode = 'P0002';
    end if;

    select pg_catalog.count(*)
      into estimated_recipient_count
    from public.ip_follows as follow
    where follow.ip_id = normalized_ip_id;
  end if;

  return query
    select
      normalized_scope,
      normalized_ip_id,
      selected_ip_title,
      estimated_recipient_count,
      estimated_recipient_count > 0;
end;
$$;

create or replace function public.admin_send_notification(
  target_operation_id uuid,
  target_scope text,
  target_ip_id text,
  target_title text,
  target_body text
)
returns table (
  recipient_count bigint,
  sent_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_scope text := pg_catalog.btrim(target_scope, E' \t\n\r\f\v');
  normalized_ip_id text := nullif(
    pg_catalog.btrim(target_ip_id, E' \t\n\r\f\v'),
    ''
  );
  normalized_title text := pg_catalog.btrim(target_title, E' \t\n\r\f\v');
  normalized_body text := pg_catalog.btrim(target_body, E' \t\n\r\f\v');
  request_payload jsonb;
  requested_target text;
  selected_ip_title text;
  actual_recipient_count bigint;
  sent_timestamp timestamptz;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
  existing_sent_at timestamptz;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'invalid_operation_id' using errcode = '22004';
  end if;

  if normalized_scope is null
    or normalized_scope not in ('all', 'ip_followers')
  then
    raise exception 'invalid_notification_scope' using errcode = '22023';
  end if;

  if normalized_scope = 'all' then
    if normalized_ip_id is not null then
      raise exception 'invalid_notification_target' using errcode = '22023';
    end if;
    requested_target := 'notifications:all';
  else
    if normalized_ip_id is null then
      raise exception 'invalid_notification_target' using errcode = '22023';
    end if;
    requested_target := 'notifications:ip_followers:' || normalized_ip_id;
  end if;

  if normalized_title is null
    or pg_catalog.char_length(normalized_title) < 1
    or pg_catalog.char_length(normalized_title) > 120
  then
    raise exception 'invalid_notification_title' using errcode = '22023';
  end if;

  if normalized_body is null
    or pg_catalog.char_length(normalized_body) < 1
    or pg_catalog.char_length(normalized_body) > 500
  then
    raise exception 'invalid_notification_body' using errcode = '22023';
  end if;

  request_payload := pg_catalog.jsonb_build_object(
    'scope', normalized_scope,
    'ip_id', normalized_ip_id,
    'title', normalized_title,
    'body', normalized_body
  );

  -- A lost-response retry must observe the first commit before deciding whether
  -- the operation is an idempotent replay or a conflicting reuse.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_notification_operation:' || target_operation_id::text,
      0
    )
  );

  select
    audit.actor_id,
    audit.action,
    audit.target,
    audit.diff,
    audit.created_at
  into
    existing_actor_id,
    existing_action,
    existing_target,
    existing_diff,
    existing_sent_at
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.notification.sent'
      and existing_target = requested_target
      and existing_diff -> 'request' = request_payload
    then
      return query
        select
          (existing_diff #>> '{result,recipient_count}')::bigint,
          existing_sent_at;
      return;
    end if;

    raise exception 'operation_conflict' using errcode = '23505';
  end if;

  if normalized_scope = 'ip_followers' then
    select ip.title
      into selected_ip_title
    from public.ips as ip
    where ip.id = normalized_ip_id
    for key share;

    if not found then
      raise exception 'ip_not_found' using errcode = 'P0002';
    end if;
  end if;

  if normalized_scope = 'all' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    select
      profile.id,
      'announcement',
      normalized_title,
      normalized_body,
      '/notifications',
      'admin_announcement',
      target_operation_id::text,
      'announcement:' || target_operation_id::text
    from public.profiles as profile;
  else
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    select
      follow.user_id,
      'announcement',
      normalized_title,
      normalized_body,
      '/notifications',
      'admin_announcement',
      target_operation_id::text,
      'announcement:' || target_operation_id::text
    from public.ip_follows as follow
    where follow.ip_id = normalized_ip_id;
  end if;

  get diagnostics actual_recipient_count = row_count;

  if actual_recipient_count = 0 then
    raise exception 'notification_no_recipients' using errcode = '22023';
  end if;

  sent_timestamp := pg_catalog.clock_timestamp();

  insert into public.audit_log (
    id,
    actor_id,
    action,
    target,
    diff,
    created_at
  )
  values (
    target_operation_id,
    actor_id,
    'admin.notification.sent',
    requested_target,
    pg_catalog.jsonb_build_object(
      'request', request_payload,
      'result', pg_catalog.jsonb_build_object(
        'ip_title', selected_ip_title,
        'link_path', '/notifications',
        'recipient_count', actual_recipient_count
      )
    ),
    sent_timestamp
  );

  return query
    select actual_recipient_count, sent_timestamp;
end;
$$;

create or replace function public.admin_list_notification_history(
  target_limit integer default 20,
  target_offset integer default 0
)
returns table (
  operation_id uuid,
  actor_name text,
  scope text,
  ip_id text,
  ip_title text,
  title text,
  body text,
  recipient_count bigint,
  sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'invalid_history_limit' using errcode = '22023';
  end if;

  if target_offset is null or target_offset < 0 then
    raise exception 'invalid_history_offset' using errcode = '22023';
  end if;

  return query
    select
      audit.id,
      case
        when profile.nickname is null or profile.nickname = '' then '운영자'
        else profile.nickname
      end,
      audit.diff #>> '{request,scope}',
      audit.diff #>> '{request,ip_id}',
      audit.diff #>> '{result,ip_title}',
      audit.diff #>> '{request,title}',
      audit.diff #>> '{request,body}',
      (audit.diff #>> '{result,recipient_count}')::bigint,
      audit.created_at
    from public.audit_log as audit
    left join public.profiles as profile
      on profile.id = audit.actor_id
    where audit.action = 'admin.notification.sent'
    order by audit.created_at desc, audit.id desc
    limit target_limit
    offset target_offset;
end;
$$;

revoke all on function public.admin_estimate_notification_recipients(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_estimate_notification_recipients(text, text)
  to authenticated;

revoke all on function public.admin_send_notification(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_send_notification(uuid, text, text, text, text)
  to authenticated;

revoke all on function public.admin_list_notification_history(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_notification_history(integer, integer)
  to authenticated;
