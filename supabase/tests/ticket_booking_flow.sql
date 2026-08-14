\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000a01',
    'authenticated', 'authenticated', 'ticket-booking@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000a02',
    'authenticated', 'authenticated', 'ticket-incomplete@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000a03',
    'authenticated', 'authenticated', 'ticket-other@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values
  (
    '00000000-0000-4000-8000-000000000a01',
    'ticket-booking@example.test', 'ticket_booking', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  ),
  (
    '00000000-0000-4000-8000-000000000a02',
    'ticket-incomplete@example.test', 'ticket_incomplete', null,
    '{"terms":true,"privacy":true}'::jsonb, null
  ),
  (
    '00000000-0000-4000-8000-000000000a03',
    'ticket-other@example.test', 'ticket_other', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at;

insert into public.events (id, title, mode, status)
values
  ('ticket-booking-live', '예매 가능 이벤트', '오프라인', '예매중'),
  ('ticket-booking-scheduled', '예정 이벤트', '오프라인', '예정'),
  ('ticket-booking-ended', '종료 이벤트', '오프라인', '종료')
on conflict (id) do update set
  title = excluded.title,
  mode = excluded.mode,
  status = excluded.status;

insert into public.ticket_types (
  id, event_id, name, price, capacity, sold, per_user_limit, sales_open_at
)
values
  ('10000000-0000-4000-8000-000000000a01', 'ticket-booking-live', '기본 회차', 12000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a02', 'ticket-booking-live', '다른 회차', 15000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a03', 'ticket-booking-scheduled', '예정 회차', 10000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a04', 'ticket-booking-ended', '종료 회차', 10000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a05', 'ticket-booking-live', '무료 회차', 0, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a06', 'ticket-booking-live', '오픈 전 회차', 10000, 10, 0, 4, now() + interval '1 hour'),
  ('10000000-0000-4000-8000-000000000a07', 'ticket-booking-live', '1인 한도 회차', 10000, 10, 0, 1, null),
  ('10000000-0000-4000-8000-000000000a08', 'ticket-booking-live', '매진 회차', 10000, 1, 1, 4, null),
  ('10000000-0000-4000-8000-000000000a09', 'ticket-booking-live', '만료 회차', 10000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a10', 'ticket-booking-live', '승인 중 회차', 10000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a11', 'ticket-booking-live', '정수 경계 회차', 10000, 2147483647, 2147483646, 2147483647, null),
  ('10000000-0000-4000-8000-000000000a12', 'ticket-booking-live', '잔여량 경쟁 회차', 10000, 3, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a13', 'ticket-booking-live', '다중 결제 대기 회차', 10000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a14', 'ticket-booking-live', '결제 증거 환불 회차', 10000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a15', 'ticket-booking-live', 'paid 장부 불일치 회차', 10000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a16', 'ticket-booking-live', '결제 키 불일치 회차', 10000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000000a17', 'ticket-booking-live', 'Korpay 최소 금액 미만', 999, 10, 0, 4, null)
on conflict (id) do update set
  event_id = excluded.event_id,
  name = excluded.name,
  price = excluded.price,
  capacity = excluded.capacity,
  sold = excluded.sold,
  per_user_limit = excluded.per_user_limit,
  sales_open_at = excluded.sales_open_at;

-- 교체된 예약 RPC와 민감 티켓 테이블은 최소 권한만 노출한다.
select 1 / case when to_regprocedure('public.reserve_tickets(uuid,integer)') is null
  then 1 else 0 end as assert_legacy_reservation_rpc_is_removed;
select 1 / case when to_regprocedure('public.reserve_tickets(uuid,uuid,integer,uuid)') is not null
  then 1 else 0 end as assert_server_scoped_idempotent_reservation_rpc_exists;
select 1 / case when to_regprocedure('public.reserve_tickets(uuid,integer,uuid)') is null
  then 1 else 0 end as assert_browser_reservation_rpc_is_removed;

select 1 / case when not has_function_privilege(
  'anon', 'public.reserve_tickets(uuid,uuid,integer,uuid)', 'execute'
) then 1 else 0 end as assert_anon_cannot_reserve;
select 1 / case when not has_function_privilege(
  'authenticated', 'public.reserve_tickets(uuid,uuid,integer,uuid)', 'execute'
) then 1 else 0 end as assert_authenticated_cannot_reserve_directly;
select 1 / case when has_function_privilege(
  'service_role', 'public.reserve_tickets(uuid,uuid,integer,uuid)', 'execute'
) then 1 else 0 end as assert_service_role_can_reserve_for_verified_user;

select 1 / case when not has_function_privilege(
  'authenticated', 'public.confirm_ticket_payment(text,uuid,text,bigint,jsonb)', 'execute'
) and has_function_privilege(
  'service_role', 'public.confirm_ticket_payment(text,uuid,text,bigint,jsonb)', 'execute'
) then 1 else 0 end as assert_ticket_confirmation_is_service_only;

select 1 / case when not has_function_privilege(
  'authenticated', 'public.expire_stale_checkouts()', 'execute'
) and has_function_privilege(
  'service_role', 'public.expire_stale_checkouts()', 'execute'
) then 1 else 0 end as assert_expiry_sweep_is_service_only;

select 1 / case when to_regprocedure(
  'public.refund_ticket_order_with_provider_evidence(uuid,text,text,jsonb,boolean)'
) is not null then 1 else 0 end as assert_provider_evidence_refund_rpc_exists;
select 1 / case when (
  select pronargdefaults = 2
  from pg_catalog.pg_proc
  where oid = 'public.refund_ticket_order_with_provider_evidence(uuid,text,text,jsonb,boolean)'::regprocedure
) then 1 else 0 end as assert_provider_evidence_refund_keeps_three_arg_compatibility;
select 1 / case when not has_function_privilege(
  'anon',
  'public.refund_ticket_order_with_provider_evidence(uuid,text,text,jsonb,boolean)',
  'execute'
) and not has_function_privilege(
  'authenticated',
  'public.refund_ticket_order_with_provider_evidence(uuid,text,text,jsonb,boolean)',
  'execute'
) and has_function_privilege(
  'service_role',
  'public.refund_ticket_order_with_provider_evidence(uuid,text,text,jsonb,boolean)',
  'execute'
) then 1 else 0 end as assert_provider_evidence_refund_is_service_only;

select 1 / case when not has_table_privilege('anon', 'public.ticket_orders', 'select')
  and not has_table_privilege('anon', 'public.ticket_orders', 'insert')
  and not has_table_privilege('anon', 'public.tickets', 'select')
  and not has_table_privilege('anon', 'public.check_ins', 'select')
  then 1 else 0 end as assert_anon_has_no_private_ticket_table_access;

select 1 / case when has_table_privilege('authenticated', 'public.ticket_orders', 'select')
  and not has_table_privilege('authenticated', 'public.tickets', 'select')
  and has_column_privilege('authenticated', 'public.tickets', 'id', 'select')
  and has_column_privilege('authenticated', 'public.tickets', 'ticket_order_id', 'select')
  and has_column_privilege('authenticated', 'public.tickets', 'ticket_type_id', 'select')
  and has_column_privilege('authenticated', 'public.tickets', 'status', 'select')
  and has_column_privilege('authenticated', 'public.tickets', 'created_at', 'select')
  and not has_column_privilege('authenticated', 'public.tickets', 'qr_token', 'select')
  and has_table_privilege('authenticated', 'public.check_ins', 'select')
  and not has_table_privilege('authenticated', 'public.ticket_orders', 'insert')
  and not has_table_privilege('authenticated', 'public.ticket_orders', 'update')
  and not has_table_privilege('authenticated', 'public.ticket_orders', 'delete')
  and not has_table_privilege('authenticated', 'public.tickets', 'insert')
  and not has_table_privilege('authenticated', 'public.tickets', 'update')
  and not has_table_privilege('authenticated', 'public.tickets', 'delete')
  and not has_table_privilege('authenticated', 'public.check_ins', 'insert')
  and not has_table_privilege('authenticated', 'public.check_ins', 'update')
  and not has_table_privilege('authenticated', 'public.check_ins', 'delete')
  then 1 else 0 end as assert_authenticated_has_read_only_ticket_access;

select 1 / case when has_table_privilege('service_role', 'public.ticket_types', 'select')
  and has_table_privilege('service_role', 'public.ticket_orders', 'select')
  and has_table_privilege('service_role', 'public.ticket_orders', 'insert')
  and has_table_privilege('service_role', 'public.ticket_orders', 'update')
  and has_table_privilege('service_role', 'public.ticket_orders', 'delete')
  and has_table_privilege('service_role', 'public.tickets', 'select')
  and has_table_privilege('service_role', 'public.tickets', 'insert')
  and has_table_privilege('service_role', 'public.tickets', 'update')
  and has_table_privilege('service_role', 'public.tickets', 'delete')
  and has_table_privilege('service_role', 'public.check_ins', 'select')
  and has_table_privilege('service_role', 'public.check_ins', 'insert')
  and has_table_privilege('service_role', 'public.check_ins', 'update')
  and has_table_privilege('service_role', 'public.check_ins', 'delete')
  then 1 else 0 end as assert_service_role_can_operate_ticket_tables;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  begin
    perform public.reserve_tickets(
      '00000000-0000-4000-8000-000000000a02',
      '10000000-0000-4000-8000-000000000a01',
      1,
      '20000000-0000-4000-8000-000000000a01'
    );
    raise exception 'incomplete onboarding should be rejected';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'onboarding required' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.reserve_tickets(
      '00000000-0000-4000-8000-000000000a01',
      '10000000-0000-4000-8000-000000000a01',
      0,
      '20000000-0000-4000-8000-000000000a02'
    );
    raise exception 'zero quantity should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'quantity must be positive' then raise; end if;
  end;

  begin
    perform public.reserve_tickets(
      '00000000-0000-4000-8000-000000000a01',
      '10000000-0000-4000-8000-000000000a01',
      1,
      null
    );
    raise exception 'null reservation key should be rejected';
  exception
    when not_null_violation then
      if sqlerrm <> 'reservation key required' then raise; end if;
  end;
end;
$$;

-- 예매 가능 상태, 유료 결제 가능성, 오픈 시각을 DB에서 강제한다.
do $$
declare
  invalid_case record;
begin
  for invalid_case in
    select *
    from (values
      ('10000000-0000-4000-8000-000000000a03'::uuid, '20000000-0000-4000-8000-000000000a03'::uuid, 'event not bookable'::text),
      ('10000000-0000-4000-8000-000000000a04'::uuid, '20000000-0000-4000-8000-000000000a04'::uuid, 'event not bookable'::text),
      ('10000000-0000-4000-8000-000000000a05'::uuid, '20000000-0000-4000-8000-000000000a05'::uuid, 'paid ticket required'::text),
      ('10000000-0000-4000-8000-000000000a06'::uuid, '20000000-0000-4000-8000-000000000a06'::uuid, 'sales not open'::text),
      ('10000000-0000-4000-8000-000000000a17'::uuid, '20000000-0000-4000-8000-000000000a17'::uuid, 'payment amount below provider minimum'::text)
    ) as invalid_values(ticket_type_id, reservation_key, expected_message)
  loop
    begin
      perform public.reserve_tickets(
        '00000000-0000-4000-8000-000000000a01',
        invalid_case.ticket_type_id,
        1,
        invalid_case.reservation_key
      );
      raise exception 'invalid ticket type should fail with %', invalid_case.expected_message;
    exception
      when check_violation then
        if sqlerrm <> invalid_case.expected_message then raise; end if;
    end;
  end loop;
end;
$$;

do $$
begin
  begin
    perform public.reserve_tickets(
      '00000000-0000-4000-8000-000000000a01',
      '10000000-0000-4000-8000-000000000a08',
      1,
      '20000000-0000-4000-8000-000000000a08'
    );
    raise exception 'sold-out ticket type should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'sold out' then raise; end if;
  end;

  begin
    perform public.reserve_tickets(
      '00000000-0000-4000-8000-000000000a01',
      '10000000-0000-4000-8000-000000000a11',
      2,
      '20000000-0000-4000-8000-000000000a11'
    );
    raise exception 'integer-boundary remaining calculation should reject oversell';
  exception
    when check_violation then
      if sqlerrm <> 'sold out' then raise; end if;
  end;
end;
$$;

-- 동일 사용자/동일 key replay는 한 번만 선점하고, 다른 payload 재사용은 충돌한다.
select public.reserve_tickets(
  '00000000-0000-4000-8000-000000000a01',
  '10000000-0000-4000-8000-000000000a01',
  2,
  '20000000-0000-4000-8000-000000000a20'
) as first_ticket_order_id \gset

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000000a01',
  '10000000-0000-4000-8000-000000000a01',
  2,
  '20000000-0000-4000-8000-000000000a20'
) as replay_ticket_order_id \gset

select 1 / case when :'first_ticket_order_id'::uuid = :'replay_ticket_order_id'::uuid
  then 1 else 0 end as assert_exact_reservation_replay_returns_same_order;
select 1 / case when (
  select count(*) = 1
  from public.ticket_orders
  where user_id = '00000000-0000-4000-8000-000000000a01'
    and reservation_key = '20000000-0000-4000-8000-000000000a20'
) then 1 else 0 end as assert_reservation_key_creates_one_order;
select 1 / case when (
  select status = 'pending'
    and event_id = 'ticket-booking-live'
    and total = 24000
    and reservation_key = '20000000-0000-4000-8000-000000000a20'
    and expires_at between now() + interval '9 minutes' and now() + interval '11 minutes'
  from public.ticket_orders
  where id = :'first_ticket_order_id'::uuid
) then 1 else 0 end as assert_pending_ticket_order_uses_db_truth_and_ten_minute_expiry;
select 1 / case when (
  select ticket_type_id = '10000000-0000-4000-8000-000000000a01'
    and quantity = 2
    and unit_price = 12000
  from public.ticket_order_reservations
  where ticket_order_id = :'first_ticket_order_id'::uuid
) and not exists (
  select 1 from public.tickets
  where ticket_order_id = :'first_ticket_order_id'::uuid
) then 1 else 0 end as assert_reservation_creates_no_preapproval_tickets;
select 1 / case when (
  select sold = 2
  from public.ticket_types
  where id = '10000000-0000-4000-8000-000000000a01'
) then 1 else 0 end as assert_exact_replay_reserves_capacity_once;

do $$
begin
  begin
    perform public.reserve_tickets(
      '00000000-0000-4000-8000-000000000a01',
      '10000000-0000-4000-8000-000000000a01',
      1,
      '20000000-0000-4000-8000-000000000a20'
    );
    raise exception 'reservation key reuse with a different quantity should be rejected';
  exception
    when unique_violation then
      if sqlerrm <> 'reservation conflict' then raise; end if;
  end;

  begin
    perform public.reserve_tickets(
      '00000000-0000-4000-8000-000000000a01',
      '10000000-0000-4000-8000-000000000a02',
      2,
      '20000000-0000-4000-8000-000000000a20'
    );
    raise exception 'reservation key reuse with a different type should be rejected';
  exception
    when unique_violation then
      if sqlerrm <> 'reservation conflict' then raise; end if;
  end;
end;
$$;

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000000a01',
  '10000000-0000-4000-8000-000000000a07',
  1,
  '20000000-0000-4000-8000-000000000a21'
);

do $$
begin
  begin
    perform public.reserve_tickets(
      '00000000-0000-4000-8000-000000000a01',
      '10000000-0000-4000-8000-000000000a07',
      1,
      '20000000-0000-4000-8000-000000000a22'
    );
    raise exception 'per-user ticket limit should be enforced';
  exception
    when check_violation then
      if sqlerrm <> 'per-user limit exceeded' then raise; end if;
  end;
end;
$$;

-- 이미 선점된 잔여량보다 큰 다음 요청은 원자적으로 실패해 sold를 넘기지 않는다.
select public.reserve_tickets(
  '00000000-0000-4000-8000-000000000a01',
  '10000000-0000-4000-8000-000000000a12',
  2,
  '20000000-0000-4000-8000-000000000a23'
);

do $$
begin
  begin
    perform public.reserve_tickets(
      '00000000-0000-4000-8000-000000000a03',
      '10000000-0000-4000-8000-000000000a12',
      2,
      '20000000-0000-4000-8000-000000000a24'
    );
    raise exception 'remaining capacity must not be oversold';
  exception
    when check_violation then
      if sqlerrm <> 'sold out' then raise; end if;
  end;
end;
$$;

select 1 / case when (
  select sold = 2 and sold <= capacity
  from public.ticket_types
  where id = '10000000-0000-4000-8000-000000000a12'
) then 1 else 0 end as assert_remaining_capacity_is_not_oversold;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a03', true);
select 1 / case when not exists (
  select 1
  from public.ticket_orders
  where reservation_key = '20000000-0000-4000-8000-000000000a23'
) then 1 else 0 end as assert_other_user_cannot_read_ticket_order;

-- Legacy Toss finalization is known-only: an existing local Toss row and the
-- historical placeholder tickets must both be present. New ticket checkout is
-- exercised by ticket_payment_provider_seam.sql instead.
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

insert into public.tickets (ticket_order_id, ticket_type_id, qr_token, status)
select
  :'first_ticket_order_id'::uuid,
  '10000000-0000-4000-8000-000000000a01'::uuid,
  null,
  'valid'
from pg_catalog.generate_series(1, 2);

insert into public.payments (
  user_id, purpose, ref_id, provider, amount, status,
  payment_key, idempotency_key, raw
)
values (
  '00000000-0000-4000-8000-000000000a01',
  'ticket', :'first_ticket_order_id'::uuid, 'toss', 24000, 'pending',
  'ticket-payment-main', 'ticket-payment-main', null
);

select public.confirm_ticket_payment(
  'ticket-payment-main',
  :'first_ticket_order_id'::uuid,
  'ticket-payment-main',
  24000,
  '{"status":"DONE"}'::jsonb
);
select public.confirm_ticket_payment(
  'ticket-payment-main',
  :'first_ticket_order_id'::uuid,
  'ticket-payment-main',
  24000,
  '{"status":"DONE","delivery":"replay"}'::jsonb
);

select 1 / case when (
  select ticket_order.status = 'paid'
    and ticket_order.expires_at is null
    and payment.provider = 'toss'
    and payment.status = 'paid'
  from public.ticket_orders as ticket_order
  join public.payments as payment on payment.ref_id = ticket_order.id
  where ticket_order.id = :'first_ticket_order_id'::uuid
) and (
  select count(*) = 2
    and count(qr_token) = 2
    and count(distinct qr_token) = 2
  from public.tickets
  where ticket_order_id = :'first_ticket_order_id'::uuid
) then 1 else 0 end as assert_known_legacy_toss_replay_issues_qr_once;

do $$
declare
  target_order_id uuid;
  rejected boolean := false;
begin
  select id into strict target_order_id
  from public.ticket_orders
  where reservation_key = '20000000-0000-4000-8000-000000000a21';

  begin
    perform public.confirm_ticket_payment(
      'unknown-ticket-payment', target_order_id,
      'unknown-ticket-payment', 10000, '{}'::jsonb
    );
  exception when object_not_in_prerequisite_state then
    rejected := sqlerrm = 'legacy_toss_payment_unknown';
  end;
  if not rejected then
    raise exception 'unknown Toss ticket payment must stay closed';
  end if;
end;
$$;
-- 만료 sweep은 승인 증거가 없는 reservation만 원복한다.
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000000a01',
  '10000000-0000-4000-8000-000000000a09',
  2,
  '20000000-0000-4000-8000-000000000a30'
) as expiring_ticket_order_id \gset

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000000a01',
  '10000000-0000-4000-8000-000000000a10',
  1,
  '20000000-0000-4000-8000-000000000a31'
) as approving_ticket_order_id \gset

reset role;
update public.ticket_orders
set expires_at = now() - interval '6 minutes'
where id in (
  :'expiring_ticket_order_id'::uuid,
  :'approving_ticket_order_id'::uuid
);

insert into public.payments (
  user_id, purpose, ref_id, amount, status, payment_key, idempotency_key, raw
)
values (
  '00000000-0000-4000-8000-000000000a01',
  'ticket',
  :'approving_ticket_order_id'::uuid,
  10000,
  'pending',
  'ticket-payment-approving',
  'ticket-payment-approving',
  '{}'::jsonb
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.expire_stale_checkouts() as expired_count \gset

select 1 / case when :'expired_count'::integer = 1
  then 1 else 0 end as assert_expiry_sweep_closes_only_unapproved_ticket_order;
select 1 / case when (
  select status = 'canceled'
  from public.ticket_orders
  where id = :'expiring_ticket_order_id'::uuid
) and (
  select count(*) = 0
  from public.tickets
  where ticket_order_id = :'expiring_ticket_order_id'::uuid
) and (
  select sold = 0
  from public.ticket_types
  where id = '10000000-0000-4000-8000-000000000a09'
) then 1 else 0 end as assert_expiry_restores_sold_without_preapproval_tickets;
select 1 / case when (
  select status = 'pending'
  from public.ticket_orders
  where id = :'approving_ticket_order_id'::uuid
) and (
  select sold = 1
  from public.ticket_types
  where id = '10000000-0000-4000-8000-000000000a10'
) then 1 else 0 end as assert_expiry_preserves_approval_in_progress;

reset role;
select lower(pg_get_functiondef(
  'public.reserve_tickets(uuid,uuid,integer,uuid)'::regprocedure
)) as reserve_ticket_function_body \gset
select 1 / case when strpos(:'reserve_ticket_function_body', 'pg_advisory_xact_lock') > 0
  and strpos(:'reserve_ticket_function_body', 'for share of event_record') > 0
  and strpos(:'reserve_ticket_function_body', 'for share of event_record')
    < strpos(:'reserve_ticket_function_body', 'for update of ticket_type')
  then 1 else 0 end as assert_reservation_serializes_key_and_locks_event_before_type;

select lower(pg_get_functiondef(
  'public.confirm_ticket_payment(text,uuid,text,bigint,jsonb)'::regprocedure
)) as confirm_ticket_function_body \gset
select 1 / case when strpos(:'confirm_ticket_function_body', 'from public.ticket_orders') > 0
  and strpos(:'confirm_ticket_function_body', 'from public.ticket_orders')
    < strpos(:'confirm_ticket_function_body', 'from public.payments')
  then 1 else 0 end as assert_confirmation_locks_order_before_payment;

select lower(pg_get_functiondef(
  'public.expire_stale_checkouts()'::regprocedure
)) as expiry_function_body \gset
select 1 / case when strpos(
  :'expiry_function_body',
  'for update of ticket_orders skip locked'
) > 0 then 1 else 0 end as assert_ticket_expiry_uses_skip_locked;

rollback;
