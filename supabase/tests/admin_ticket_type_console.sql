\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000801',
    'authenticated', 'authenticated', 'ticket-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000802',
    'authenticated', 'authenticated', 'ticket-fan@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000801',
    'ticket-staff@example.test', 'ticket_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000802',
    'ticket-fan@example.test', 'ticket_fan', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.events (id, title, mode, status)
values
  ('admin-ticket-event-a', '티켓 테스트 이벤트 A', '오프라인', '예매중'),
  ('admin-ticket-event-b', '티켓 테스트 이벤트 B', '오프라인', '예정')
on conflict (id) do update set title = excluded.title;

-- 함수와 테이블 ACL: authenticated는 guarded RPC만 실행하고 직접 쓰지 못한다.
select 1 / case when not has_function_privilege(
  'anon',
  'public.admin_upsert_ticket_type(uuid,uuid,text,text,integer,integer)',
  'execute'
) then 1 else 0 end as assert_anon_cannot_upsert_ticket_type;

select 1 / case when has_function_privilege(
  'authenticated',
  'public.admin_upsert_ticket_type(uuid,uuid,text,text,integer,integer)',
  'execute'
) then 1 else 0 end as assert_authenticated_can_call_guarded_ticket_type_rpc;

select 1 / case when not has_function_privilege(
  'service_role',
  'public.admin_upsert_ticket_type(uuid,uuid,text,text,integer,integer)',
  'execute'
) then 1 else 0 end as assert_service_role_cannot_upsert_ticket_type;

select 1 / case when has_table_privilege('anon', 'public.ticket_types', 'select')
  then 1 else 0 end as assert_anon_can_read_ticket_types;

select 1 / case when has_table_privilege('authenticated', 'public.ticket_types', 'select')
  then 1 else 0 end as assert_authenticated_can_read_ticket_types;

select 1 / case when not has_table_privilege('authenticated', 'public.ticket_types', 'insert')
  and not has_table_privilege('authenticated', 'public.ticket_types', 'update')
  and not has_table_privilege('authenticated', 'public.ticket_types', 'delete')
  then 1 else 0 end as assert_authenticated_cannot_write_ticket_types_directly;

select 1 / case when not exists (
  select 1
  from pg_policies
  where schemaname = 'public'
    and tablename = 'ticket_types'
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
) then 1 else 0 end as assert_ticket_type_write_policies_are_removed;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);

do $$
begin
  begin
    perform public.admin_upsert_ticket_type(
      '11111111-1111-4111-8111-111111111801',
      '22222222-2222-4222-8222-222222222801',
      'admin-ticket-event-a',
      '권한 없는 회차',
      10000,
      10
    );
  exception
    when insufficient_privilege then
      return;
  end;
  raise exception 'non-staff ticket type upsert should be rejected';
end;
$$;

select 1 / case when not exists (
  select 1 from public.ticket_types where id = '22222222-2222-4222-8222-222222222801'
) then 1 else 0 end as assert_non_staff_did_not_create_ticket_type;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000801', true);

-- 입력 검증은 행과 감사 로그를 남기지 않는다.
do $$
declare
  invalid_call record;
begin
  for invalid_call in
    select *
    from (values
      (null::uuid, '22222222-2222-4222-8222-222222222811'::uuid, 'admin-ticket-event-a'::text, '회차'::text, 10000::integer, 10::integer, 'invalid_operation_id'::text),
      ('11111111-1111-4111-8111-111111111812'::uuid, null::uuid, 'admin-ticket-event-a', '회차', 10000, 10, 'invalid_ticket_type_id'),
      ('11111111-1111-4111-8111-111111111813'::uuid, '22222222-2222-4222-8222-222222222813'::uuid, 'missing-event', '회차', 10000, 10, 'event_not_found'),
      ('11111111-1111-4111-8111-111111111814'::uuid, '22222222-2222-4222-8222-222222222814'::uuid, 'admin-ticket-event-a', '   ', 10000, 10, 'invalid_ticket_type_name'),
      ('11111111-1111-4111-8111-111111111815'::uuid, '22222222-2222-4222-8222-222222222815'::uuid, 'admin-ticket-event-a', '회차', -1, 10, 'invalid_ticket_type_price'),
      ('11111111-1111-4111-8111-111111111816'::uuid, '22222222-2222-4222-8222-222222222816'::uuid, 'admin-ticket-event-a', '회차', 10000, -1, 'invalid_ticket_type_capacity')
    ) as invalid_values(operation_id, ticket_type_id, event_id, name, price, capacity, expected_message)
  loop
    begin
      perform public.admin_upsert_ticket_type(
        invalid_call.operation_id,
        invalid_call.ticket_type_id,
        invalid_call.event_id,
        invalid_call.name,
        invalid_call.price,
        invalid_call.capacity
      );
    exception
      when others then
        if sqlerrm = invalid_call.expected_message then
          continue;
        end if;
        raise;
    end;
    raise exception 'invalid ticket type call should fail with %', invalid_call.expected_message;
  end loop;
end;
$$;

-- 신규 생성과 lost-response replay는 한 번만 적용·감사된다.
select 1 / case when public.admin_upsert_ticket_type(
  '33333333-3333-4333-8333-333333333801',
  '44444444-4444-4444-8444-444444444801',
  'admin-ticket-event-a',
  '  7월 25일 1회차  ',
  25000,
  80
) = '44444444-4444-4444-8444-444444444801'::uuid then 1 else 0 end
  as assert_staff_can_create_ticket_type;

select 1 / case when public.admin_upsert_ticket_type(
  '33333333-3333-4333-8333-333333333801',
  '44444444-4444-4444-8444-444444444801',
  'admin-ticket-event-a',
  '7월 25일 1회차',
  25000,
  80
) = '44444444-4444-4444-8444-444444444801'::uuid then 1 else 0 end
  as assert_same_operation_is_idempotent;

select 1 / case when (
  select event_id = 'admin-ticket-event-a'
    and name = '7월 25일 1회차'
    and price = 25000
    and capacity = 80
    and sold = 0
    and per_user_limit = 4
    and sales_open_at is null
  from public.ticket_types
  where id = '44444444-4444-4444-8444-444444444801'
) then 1 else 0 end as assert_create_preserves_hidden_defaults;

select 1 / case when exists (
  select 1
  from public.audit_log
  where id = '33333333-3333-4333-8333-333333333801'
    and actor_id = '00000000-0000-4000-8000-000000000801'
    and action = 'admin.ticket_type.upserted'
    and target = 'ticket_types:44444444-4444-4444-8444-444444444801'
    and diff -> 'request' = '{"event_id":"admin-ticket-event-a","name":"7월 25일 1회차","price":25000,"capacity":80}'::jsonb
    and diff -> 'before' = 'null'::jsonb
    and diff -> 'after' = '{"event_id":"admin-ticket-event-a","name":"7월 25일 1회차","price":25000,"capacity":80,"sold":0}'::jsonb
) then 1 else 0 end as assert_create_audit_payload_is_exact;

select 1 / case when (
  select count(*) from public.audit_log where id = '33333333-3333-4333-8333-333333333801'
) = 1 then 1 else 0 end as assert_replay_is_audited_once;

do $$
begin
  begin
    perform public.admin_upsert_ticket_type(
      '33333333-3333-4333-8333-333333333801',
      '44444444-4444-4444-8444-444444444801',
      'admin-ticket-event-a',
      '다른 요청',
      25000,
      80
    );
  exception
    when unique_violation then
      if sqlerrm = 'operation_conflict' then
        return;
      end if;
      raise;
  end;
  raise exception 'operation id reuse with different payload should be rejected';
end;
$$;

-- 티켓 발급 전에는 이벤트 재연결이 가능하다.
select public.admin_upsert_ticket_type(
  '33333333-3333-4333-8333-333333333803',
  '44444444-4444-4444-8444-444444444803',
  'admin-ticket-event-a',
  '재연결 테스트',
  12000,
  10
);

select public.admin_upsert_ticket_type(
  '33333333-3333-4333-8333-333333333804',
  '44444444-4444-4444-8444-444444444803',
  'admin-ticket-event-b',
  '재연결 테스트',
  12000,
  10
);

select 1 / case when (
  select event_id = 'admin-ticket-event-b'
  from public.ticket_types
  where id = '44444444-4444-4444-8444-444444444803'
) then 1 else 0 end as assert_unsold_ticket_type_can_move_events;

-- 예약은 같은 type row를 잠그고 sold를 증가시킨다.
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select public.reserve_tickets(
  '00000000-0000-4000-8000-000000000802',
  '44444444-4444-4444-8444-444444444801',
  2,
  '55555555-5555-4555-8555-555555555801'
) as reserved_ticket_order_id \gset

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000801', true);

select 1 / case when public.admin_upsert_ticket_type(
  '33333333-3333-4333-8333-333333333805',
  '44444444-4444-4444-8444-444444444801',
  'admin-ticket-event-a',
  '7월 25일 1회차',
  25000,
  2
) = '44444444-4444-4444-8444-444444444801'::uuid then 1 else 0 end
  as assert_capacity_equal_to_locked_sold_is_allowed;

select 1 / case when (
  select capacity = 2 and sold = 2 and per_user_limit = 4 and sales_open_at is null
  from public.ticket_types
  where id = '44444444-4444-4444-8444-444444444801'
) then 1 else 0 end as assert_update_preserves_sold_and_deferred_settings;

select 1 / case when public.admin_upsert_ticket_type(
  '33333333-3333-4333-8333-333333333809',
  '44444444-4444-4444-8444-444444444801',
  'admin-ticket-event-a',
  '운영 표시명 변경',
  25000,
  2
) = '44444444-4444-4444-8444-444444444801'::uuid then 1 else 0 end
  as assert_reservation_allows_non_payment_name_change;

do $$
begin
  begin
    perform public.admin_upsert_ticket_type(
      '33333333-3333-4333-8333-333333333806',
      '44444444-4444-4444-8444-444444444801',
      'admin-ticket-event-a',
      '7월 25일 1회차',
      25000,
      1
    );
  exception
    when check_violation then
      if sqlerrm = 'capacity_below_sold' then
        return;
      end if;
      raise;
  end;
  raise exception 'capacity below sold should be rejected';
end;
$$;

select 1 / case when (
  select capacity = 2 and sold = 2
  from public.ticket_types
  where id = '44444444-4444-4444-8444-444444444801'
) then 1 else 0 end as assert_rejected_capacity_change_is_atomic;

do $$
begin
  begin
    perform public.admin_upsert_ticket_type(
      '33333333-3333-4333-8333-333333333807',
      '44444444-4444-4444-8444-444444444801',
      'admin-ticket-event-b',
      '변경된 회차',
      30000,
      3
    );
  exception
    when check_violation then
      if sqlerrm = 'ticket_type_catalog_locked' then
        return;
      end if;
      raise;
  end;
  raise exception 'reservation snapshot should lock event and price';
end;
$$;

-- 실제 취소 경로로 sold가 복원된 뒤에도 reservation 이력이 결제 필드를 잠근다.
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);
select public.refund_ticket_order(:'reserved_ticket_order_id'::uuid, '회차 콘솔 회귀 테스트');

reset role;

select 1 / case when (
  select status = 'canceled'
  from public.ticket_orders
  where id = :'reserved_ticket_order_id'::uuid
) then 1 else 0 end as assert_refund_cancels_ticket_order;

select 1 / case when not exists (
  select 1
  from public.tickets
  where ticket_order_id = :'reserved_ticket_order_id'::uuid
) then 1 else 0 end as assert_unpaid_refund_preserves_no_ticket_contract;

select 1 / case when (
  select sold = 0
  from public.ticket_types
  where id = '44444444-4444-4444-8444-444444444801'
) then 1 else 0 end as assert_refund_restores_ticket_allocation;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000801', true);

do $$
begin
  begin
    perform public.admin_upsert_ticket_type(
      '33333333-3333-4333-8333-333333333808',
      '44444444-4444-4444-8444-444444444801',
      'admin-ticket-event-b',
      '7월 25일 1회차',
      25000,
      2
    );
  exception
    when check_violation then
      if sqlerrm = 'ticket_type_catalog_locked' then
        return;
      end if;
      raise;
  end;
  raise exception 'canceled reservation history should keep event locked';
end;
$$;

select 1 / case when not exists (
  select 1
  from public.audit_log
  where id in (
    '33333333-3333-4333-8333-333333333806',
    '33333333-3333-4333-8333-333333333807',
    '33333333-3333-4333-8333-333333333808'
  )
) then 1 else 0 end as assert_rejected_updates_are_not_audited;

select lower(pg_get_functiondef(
  'public.admin_upsert_ticket_type(uuid,uuid,text,text,integer,integer)'::regprocedure
)) as ticket_type_function_body \gset

select 1 / case when strpos(:'ticket_type_function_body', 'pg_advisory_xact_lock') > 0
  then 1 else 0 end as assert_ticket_type_upsert_uses_advisory_locks;

select 1 / case when strpos(:'ticket_type_function_body', 'for key share') > 0
  then 1 else 0 end as assert_ticket_type_upsert_locks_parent_event;

select 1 / case when strpos(:'ticket_type_function_body', 'for update') > 0
  then 1 else 0 end as assert_ticket_type_upsert_locks_current_type;

select lower(pg_get_functiondef(
  'public.reserve_tickets(uuid,uuid,integer,uuid)'::regprocedure
)) as reserve_function_body \gset

select 1 / case when strpos(:'reserve_function_body', 'for update') > 0
  then 1 else 0 end as assert_reservation_locks_same_ticket_type_row;

rollback;
