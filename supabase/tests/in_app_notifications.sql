\set ON_ERROR_STOP on

begin;

update private.card_reward_control set enabled = true where singleton;

-- The inbox is a real private ledger, not a client-owned table.
select 1 / case when to_regclass('public.notifications') is not null then 1 else 0 end
  as assert_notifications_table_exists;

select 1 / case when exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'notifications'
    and column_name = 'dedupe_key'
    and is_nullable = 'NO'
) then 1 else 0 end as assert_notification_dedupe_key_exists;

select 1 / case when (
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (user_id, dedupe_key)'
  )
  and not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%source_id%'
  )
) then 1 else 0 end as assert_notification_dedupe_is_fixed_key_only;

select 1 / case when (
  not has_table_privilege('anon', 'public.notifications', 'select')
  and has_table_privilege('authenticated', 'public.notifications', 'select')
  and not has_table_privilege('authenticated', 'public.notifications', 'insert')
  and not has_table_privilege('authenticated', 'public.notifications', 'update')
  and not has_table_privilege('authenticated', 'public.notifications', 'delete')
  and not has_table_privilege('service_role', 'public.notifications', 'insert')
  and not has_table_privilege('service_role', 'public.notifications', 'update')
  and not has_table_privilege('service_role', 'public.notifications', 'delete')
) then 1 else 0 end as assert_notification_table_acl_is_read_only_for_owners;

select 1 / case when (
  not has_function_privilege('anon', 'public.open_notification(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.open_notification(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.open_notification(uuid)', 'execute')
  and not has_function_privilege(
    'anon',
    'public.set_ip_notification_preferences(text,boolean,boolean,boolean)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.set_ip_notification_preferences(text,boolean,boolean,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.set_ip_notification_preferences(text,boolean,boolean,boolean)',
    'execute'
  )
) then 1 else 0 end as assert_notification_user_rpc_acl;

select 1 / case when (
  not has_function_privilege(
    'authenticated',
    'private.notify_order_status_change()',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.notify_draw_ticket_insert_statement()',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.notify_good_insert()',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.notify_event_insert()',
    'execute'
  )
) then 1 else 0 end as assert_private_notification_helpers_are_not_callable;

with draw_trigger_definition as (
  select lower(
    pg_get_functiondef(
      'private.notify_draw_ticket_insert_statement()'::regprocedure
    )
  ) as definition
)
select 1 / case when (
  select strpos(definition, 'pg_advisory_xact_lock') > 0
    and strpos(definition, 'order by') > 0
    and strpos(definition, 'pg_advisory_xact_lock')
      < strpos(definition, 'with inserted_sources')
  from draw_trigger_definition
) then 1 else 0 end as assert_draw_ticket_sources_lock_before_snapshot;

select 1 / case when exists (
  select 1
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'notifications'
    and indexname = 'notifications_user_created_idx'
) then 1 else 0 end as assert_notification_owner_order_index_exists;

select 1 / case when exists (
  select 1
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'notifications'
    and indexname = 'notifications_user_unread_idx'
    and indexdef ilike '%where (read_at is null)%'
) then 1 else 0 end as assert_notification_unread_index_exists;

select 1 / case when exists (
  select 1
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'ip_follows'
    and indexname = 'ip_follows_ip_notification_idx'
) then 1 else 0 end as assert_ip_follower_fanout_index_exists;

select 1 / case when (
  select count(*) = 2
    and bool_and(is_nullable = 'NO')
    and bool_and(column_default = 'true')
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ip_follows'
    and column_name in ('notify_drops', 'notify_events')
) then 1 else 0 end as assert_follow_preferences_default_on;

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000001501',
    'authenticated',
    'authenticated',
    'notification-one@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000001502',
    'authenticated',
    'authenticated',
    'notification-two@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000001503',
    'authenticated',
    'authenticated',
    'notification-staff@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

insert into public.profiles (
  id,
  email,
  nickname,
  birth_date,
  role,
  consents,
  onboarded_at
)
values
  (
    '00000000-0000-4000-8000-000000001501',
    'notification-one@example.test',
    'notification_one',
    '2000-01-01',
    'user',
    '{"terms":true,"privacy":true}'::jsonb,
    now()
  ),
  (
    '00000000-0000-4000-8000-000000001502',
    'notification-two@example.test',
    'notification_two',
    '2000-01-01',
    'user',
    '{"terms":true,"privacy":true}'::jsonb,
    now()
  ),
  (
    '00000000-0000-4000-8000-000000001503',
    'notification-staff@example.test',
    'notification_staff',
    '2000-01-01',
    'staff',
    '{"terms":true,"privacy":true}'::jsonb,
    now()
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  role = excluded.role,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at;

insert into public.ips (id, title, vertical_key)
values
  ('notification-ip', '알림 테스트 IP', 'character'),
  ('notification-other-ip', '미팔로우 테스트 IP', 'character');

insert into public.ip_follows (user_id, ip_id)
values
  ('00000000-0000-4000-8000-000000001501', 'notification-ip'),
  ('00000000-0000-4000-8000-000000001502', 'notification-ip');

select 1 / case when (
  select bool_and(notify_drops and notify_events)
  from public.ip_follows
  where ip_id = 'notification-ip'
) then 1 else 0 end as assert_existing_follow_rows_start_with_both_channels_enabled;

-- Auto-follow and the requested channel state are one transaction. A failure
-- after the follow INSERT must also roll back the fan count change.
create function pg_temp.reject_notification_preference_update()
returns trigger
language plpgsql
as $$
begin
  if new.ip_id = 'notification-other-ip' then
    raise exception 'forced_notification_preference_failure' using errcode = 'P7701';
  end if;
  return new;
end;
$$;

create trigger reject_notification_preference_update
before update on public.ip_follows
for each row
execute function pg_temp.reject_notification_preference_update();

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001501', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    perform public.set_ip_notification_preferences(
      'notification-other-ip',
      false,
      true,
      true
    );
    raise exception 'auto-follow preference failure was not propagated' using errcode = 'P7702';
  exception
    when sqlstate 'P7701' then
      null;
  end;
end;
$$;

reset role;

drop trigger reject_notification_preference_update on public.ip_follows;

select 1 / case when (
  not exists (
    select 1
    from public.ip_follows
    where user_id = '00000000-0000-4000-8000-000000001501'
      and ip_id = 'notification-other-ip'
  )
  and (
    select fans_count = 0
    from public.ips
    where id = 'notification-other-ip'
  )
) then 1 else 0 end as assert_auto_follow_and_preferences_rollback_together;

set local role authenticated;

select *
from public.set_ip_notification_preferences(
  'notification-other-ip',
  false,
  true,
  true
);

select 1 / case when (
  select not notify_drops and notify_events
  from public.ip_follows
  where user_id = '00000000-0000-4000-8000-000000001501'
    and ip_id = 'notification-other-ip'
) then 1 else 0 end as assert_auto_follow_applies_requested_preferences;

select public.unfollow_ip('notification-other-ip');
reset role;

-- Preference updates preserve omitted channels and never create a follow row.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001501', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select *
from public.set_ip_notification_preferences('notification-ip', false, null);

select 1 / case when (
  select not notify_drops and notify_events
  from public.ip_follows
  where user_id = '00000000-0000-4000-8000-000000001501'
    and ip_id = 'notification-ip'
) then 1 else 0 end as assert_omitted_event_preference_is_preserved;

do $$
begin
  begin
    perform public.set_ip_notification_preferences('notification-other-ip', true, true);
  exception
    when no_data_found then
      return;
  end;

  raise exception 'a non-followed IP preference update should fail closed';
end;
$$;

select *
from public.set_ip_notification_preferences('notification-ip', true, false);

select 1 / case when (
  select notify_drops and not notify_events
  from public.ip_follows
  where user_id = '00000000-0000-4000-8000-000000001501'
    and ip_id = 'notification-ip'
) then 1 else 0 end as assert_first_follower_channel_matrix;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001502', true);

select *
from public.set_ip_notification_preferences('notification-ip', false, true);

reset role;

-- Seed and migration catalog writes have no runtime actor and never fan out.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

insert into public.goods (
  id,
  ip_id,
  name,
  type,
  price,
  stock,
  stock_qty
)
values (
  'notification-seed-good',
  'notification-ip',
  '시드 굿즈',
  '문구',
  1000,
  'ok',
  1
);

insert into public.events (
  id,
  ip_id,
  title,
  mode,
  status
)
values (
  'notification-seed-event',
  'notification-ip',
  '시드 이벤트',
  '온라인',
  '예정'
);

select 1 / case when not exists (
  select 1
  from public.notifications
  where source_id in ('notification-seed-good', 'notification-seed-event')
) then 1 else 0 end as assert_catalog_seed_writes_do_not_notify;

-- Runtime staff admin RPC inserts fan out once, while upsert updates do not.
select set_config(
  'test.long_event_id_one',
  repeat('long-event-', 12) || 'a',
  true
);
select set_config(
  'test.long_event_id_two',
  repeat('long-event-', 12) || 'b',
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001503', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.admin_upsert_good(
  'notification-runtime-good',
  'notification-ip',
  '런타임 드롭',
  '문구',
  2000,
  'NEW',
  'ok',
  null,
  null,
  '(주)아이콘즈', '대한민국', 'PVC', '80x80x30mm / 120g', '2026-07', '아이콘즈 CS', '02-000-0000',
  null, null, null,
  null
);

select public.admin_upsert_good(
  'notification-runtime-good',
  'notification-ip',
  '수정된 런타임 드롭',
  '문구',
  2500,
  'NEW',
  'ok',
  null,
  null,
  '(주)아이콘즈', '대한민국', 'PVC', '80x80x30mm / 120g', '2026-07', '아이콘즈 CS', '02-000-0000',
  null, null, null,
  'notification-runtime-good'
);

select public.admin_upsert_event(
  'notification-runtime-event',
  'notification-ip',
  '런타임 이벤트',
  '온라인',
  '예정',
  null,
  null,
  null,
  null,
  null,
  null
);

select public.admin_upsert_event(
  'notification-runtime-event',
  'notification-ip',
  '수정된 런타임 이벤트',
  '온라인',
  '예정',
  null,
  null,
  null,
  null,
  null,
  null,
  'notification-runtime-event'
);

select public.admin_upsert_event(
  'notification-joint-event',
  null,
  '합동 이벤트',
  '온라인',
  '예정',
  null,
  null,
  null,
  null,
  null,
  null
);

select public.admin_upsert_event(
  current_setting('test.long_event_id_one'),
  'notification-ip',
  '장문 식별자 이벤트 A',
  '온라인',
  '예정',
  null,
  null,
  null,
  null,
  null,
  null
);

select public.admin_upsert_event(
  current_setting('test.long_event_id_two'),
  'notification-ip',
  '장문 식별자 이벤트 B',
  '온라인',
  '예정',
  null,
  null,
  null,
  null,
  null,
  null
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select 1 / case when (
  select count(*) = 1
    and bool_and(user_id = '00000000-0000-4000-8000-000000001501')
  from public.notifications
  where type = 'drop_published'
    and source_type = 'good'
    and source_id = 'notification-runtime-good'
    and dedupe_key = 'good:' || pg_catalog.encode(
      extensions.digest(source_id, 'sha256'),
      'hex'
    )
) then 1 else 0 end as assert_drop_fanout_respects_preference_and_first_insert;

select 1 / case when (
  select count(*) = 1
    and bool_and(user_id = '00000000-0000-4000-8000-000000001502')
  from public.notifications
  where type = 'event_published'
    and source_type = 'event'
    and source_id = 'notification-runtime-event'
    and dedupe_key = 'event:' || pg_catalog.encode(
      extensions.digest(source_id, 'sha256'),
      'hex'
    )
) then 1 else 0 end as assert_event_fanout_respects_preference_and_first_insert;

select 1 / case when not exists (
  select 1
  from public.notifications
  where source_type = 'event'
    and source_id = 'notification-joint-event'
) then 1 else 0 end as assert_joint_event_has_no_ip_fanout;

select 1 / case when (
  select count(*) = 2
    and count(distinct source_id) = 2
    and count(distinct dedupe_key) = 2
    and bool_and(user_id = '00000000-0000-4000-8000-000000001502')
    and bool_and(char_length(source_id) > 128)
    and bool_and(link_path = '/offline-popups')
    and bool_and(
      dedupe_key = 'event:' || pg_catalog.encode(
        extensions.digest(source_id, 'sha256'),
        'hex'
      )
    )
  from public.notifications
  where type = 'event_published'
    and source_id in (
      current_setting('test.long_event_id_one'),
      current_setting('test.long_event_id_two')
    )
) then 1 else 0 end as assert_long_catalog_sources_use_distinct_fixed_keys;

-- Authority-table state transitions issue exactly one order notification.
insert into public.orders (
  id,
  user_id,
  status,
  total,
  address,
  expires_at
)
values
  (
    '40000000-0000-4000-8000-000000001501',
    '00000000-0000-4000-8000-000000001501',
    'pending',
    10000,
    '{}'::jsonb,
    now() + interval '10 minutes'
  ),
  (
    '40000000-0000-4000-8000-000000001502',
    '00000000-0000-4000-8000-000000001502',
    'pending',
    10000,
    '{}'::jsonb,
    now() + interval '10 minutes'
  );

update public.orders
set status = 'paid', expires_at = null
where id in (
  '40000000-0000-4000-8000-000000001501',
  '40000000-0000-4000-8000-000000001502'
);

update public.orders
set status = 'paid'
where id = '40000000-0000-4000-8000-000000001501';

update public.orders
set status = 'shipping'
where id = '40000000-0000-4000-8000-000000001501';

update public.orders
set status = 'shipping'
where id = '40000000-0000-4000-8000-000000001501';

select 1 / case when (
  select count(*) = 1
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000001501'
    and type = 'order_paid'
    and source_type = 'order'
    and source_id = '40000000-0000-4000-8000-000000001501'
    and dedupe_key = 'order:paid:40000000-0000-4000-8000-000000001501'
    and link_path = '/orders/40000000-0000-4000-8000-000000001501'
) then 1 else 0 end as assert_paid_transition_is_idempotent;

select 1 / case when (
  select count(*) = 1
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000001501'
    and type = 'order_shipping'
    and source_type = 'order'
    and source_id = '40000000-0000-4000-8000-000000001501'
    and dedupe_key = 'order:shipping:40000000-0000-4000-8000-000000001501'
) then 1 else 0 end as assert_shipping_transition_is_idempotent;

-- Draw tickets aggregate each INSERT statement by user and source, then refresh
-- the same notification snapshot if the same source gains a real new ticket.
insert into public.card_pools (id, ip_id, name, active_from)
values (
  '20000000-0000-4000-8000-000000001501',
  'notification-ip',
  '알림 테스트 카드풀',
  now() - interval '1 day'
);

insert into public.draw_tickets (
  id,
  user_id,
  pool_id,
  source,
  source_id,
  ordinal
)
values
  (
    '60000000-0000-4000-8000-000000001501',
    '00000000-0000-4000-8000-000000001501',
    '20000000-0000-4000-8000-000000001501',
    'order_paid',
    '70000000-0000-4000-8000-000000001501',
    1
  ),
  (
    '60000000-0000-4000-8000-000000001502',
    '00000000-0000-4000-8000-000000001501',
    '20000000-0000-4000-8000-000000001501',
    'order_paid',
    '70000000-0000-4000-8000-000000001501',
    2
  );

select 1 / case when (
  select count(*) = 1
    and bool_and(body like '%2개%')
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000001501'
    and type = 'draw_ticket_issued'
    and source_type = 'order_paid'
    and source_id = '70000000-0000-4000-8000-000000001501'
    and dedupe_key = 'draw_ticket:order_paid:70000000-0000-4000-8000-000000001501'
) then 1 else 0 end as assert_draw_ticket_statement_is_aggregated;

select id as draw_notification_id
from public.notifications
where user_id = '00000000-0000-4000-8000-000000001501'
  and dedupe_key = 'draw_ticket:order_paid:70000000-0000-4000-8000-000000001501'
\gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001501', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.open_notification(:'draw_notification_id'::uuid);
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

update public.notifications
set created_at = now() - interval '1 day'
where id = :'draw_notification_id'::uuid;

select created_at as stale_draw_created_at
from public.notifications
where id = :'draw_notification_id'::uuid
\gset

insert into public.draw_tickets (
  id,
  user_id,
  pool_id,
  source,
  source_id,
  ordinal
)
values (
  '60000000-0000-4000-8000-000000001503',
  '00000000-0000-4000-8000-000000001501',
  '20000000-0000-4000-8000-000000001501',
  'order_paid',
  '70000000-0000-4000-8000-000000001501',
  3
);

select 1 / case when (
  select count(*) = 1
    and bool_and(body like '%3개%')
    and bool_and(read_at is null)
    and bool_and(created_at > :'stale_draw_created_at'::timestamptz)
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000001501'
    and type = 'draw_ticket_issued'
    and source_type = 'order_paid'
    and source_id = '70000000-0000-4000-8000-000000001501'
    and dedupe_key = 'draw_ticket:order_paid:70000000-0000-4000-8000-000000001501'
) then 1 else 0 end as assert_draw_ticket_follow_up_is_new_unread_news;

-- Invalid and duplicate ledger data is rejected at the table contract.
do $$
begin
  begin
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
    values (
      '00000000-0000-4000-8000-000000001501',
      'announcement',
      '잘못된 링크',
      '외부 경로는 허용되지 않습니다.',
      '//example.test/path',
      'test',
      'invalid-link',
      'test:invalid-protocol-relative-link'
    );
  exception
    when check_violation then
      return;
  end;

  raise exception 'protocol-relative notification links should be rejected';
end;
$$;

do $$
declare
  invalid_case record;
begin
  for invalid_case in
    select *
    from (
      values
        (
          E' \t\n',
          '정상 본문',
          '/notifications',
          'test',
          'invalid-title',
          'test:invalid-whitespace-title'
        ),
        (
          '정상 제목',
          E' \t\n',
          '/notifications',
          'test',
          'invalid-body',
          'test:invalid-whitespace-body'
        ),
        (
          '정상 제목',
          '정상 본문',
          '/notifications',
          E' \t\n',
          'invalid-source-type',
          'test:invalid-whitespace-source-type'
        ),
        (
          '정상 제목',
          '정상 본문',
          '/notifications',
          'test',
          E' \t\n',
          'test:invalid-whitespace-source-id'
        ),
        (
          '정상 제목',
          '정상 본문',
          '/notifications' || chr(10) || 'control',
          'test',
          'invalid-control-link',
          'test:invalid-control-link'
        ),
        (
          '정상 제목',
          '정상 본문',
          '/notifications',
          'test',
          'valid-source',
          repeat('d', 129)
        )
    ) as invalid_values (
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
  loop
    begin
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
      values (
        '00000000-0000-4000-8000-000000001501',
        'announcement',
        invalid_case.title,
        invalid_case.body,
        invalid_case.link_path,
        invalid_case.source_type,
        invalid_case.source_id,
        invalid_case.dedupe_key
      );
    exception
      when check_violation then
        continue;
    end;

    raise exception 'invalid notification boundary was accepted: %',
      invalid_case.dedupe_key;
  end loop;
end;
$$;

do $$
begin
  begin
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
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    from public.notifications
    where user_id = '00000000-0000-4000-8000-000000001501'
      and type = 'order_paid'
      and source_id = '40000000-0000-4000-8000-000000001501';
  exception
    when unique_violation then
      return;
  end;

  raise exception 'notification source dedupe should reject duplicates';
end;
$$;

-- RLS exposes only the current owner's rows, and direct writes remain closed.
select id as own_notification_id
from public.notifications
where user_id = '00000000-0000-4000-8000-000000001501'
  and type = 'order_paid'
  and source_id = '40000000-0000-4000-8000-000000001501'
\gset

select id as other_notification_id
from public.notifications
where user_id = '00000000-0000-4000-8000-000000001502'
  and type = 'order_paid'
  and source_id = '40000000-0000-4000-8000-000000001502'
\gset

select set_config('test.other_notification_id', :'other_notification_id', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001501', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select 1 / case when (
  select count(*) > 0
    and bool_and(user_id = '00000000-0000-4000-8000-000000001501')
  from public.notifications
) then 1 else 0 end as assert_owner_rls_hides_other_inboxes;

do $$
begin
  begin
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
    values (
      '00000000-0000-4000-8000-000000001501',
      'announcement',
      '직접 쓰기',
      '허용되지 않아야 합니다.',
      '/notifications',
      'test',
      'direct-write',
      'test:direct-write'
    );
  exception
    when insufficient_privilege then
      return;
  end;

  raise exception 'authenticated users should not insert notifications directly';
end;
$$;

do $$
begin
  begin
    perform public.open_notification(
      current_setting('test.other_notification_id')::uuid
    );
  exception
    when no_data_found then
      return;
  end;

  raise exception 'opening another user notification should not disclose it';
end;
$$;

select 1 / case when public.open_notification(:'own_notification_id'::uuid)
  = '/orders/40000000-0000-4000-8000-000000001501'
  then 1 else 0 end as assert_open_notification_returns_the_trusted_path;

select read_at as first_read_at
from public.notifications
where id = :'own_notification_id'::uuid
\gset

select pg_sleep(0.01);
select public.open_notification(:'own_notification_id'::uuid);

select 1 / case when (
  select read_at = :'first_read_at'::timestamptz
  from public.notifications
  where id = :'own_notification_id'::uuid
) then 1 else 0 end as assert_read_timestamp_is_monotonic;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

set local role service_role;
do $$
begin
  begin
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
    values (
      '00000000-0000-4000-8000-000000001501',
      'announcement',
      '서비스 직접 쓰기',
      'RPC 경계를 우회하면 안 됩니다.',
      '/notifications',
      'test',
      'service-direct-write',
      'test:service-direct-write'
    );
  exception
    when insufficient_privilege then
      return;
  end;

  raise exception 'service role should not insert notifications directly';
end;
$$;
reset role;

rollback;
