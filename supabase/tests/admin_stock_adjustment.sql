\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000701',
    'authenticated', 'authenticated', 'stock-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000702',
    'authenticated', 'authenticated', 'stock-fan@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000701',
    'stock-staff@example.test', 'stock_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000702',
    'stock-fan@example.test', 'stock_fan', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.verticals (key, label, color)
values ('admin-stock-test', '재고 테스트', '#000000')
on conflict (key) do nothing;

insert into public.ips (id, title, vertical_key)
values ('admin-stock-test-ip', '재고 테스트 IP', 'admin-stock-test')
on conflict (id) do nothing;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('admin-stock-test-good', 'admin-stock-test-ip', '재고 테스트 굿즈', '테스트', 1000, 'low', 10),
  ('admin-stock-manual-stop', 'admin-stock-test-ip', '판매 중지 굿즈', '테스트', 1000, 'soldout', 2),
  ('admin-stock-max', 'admin-stock-test-ip', '최대 재고 굿즈', '테스트', 1000, 'ok', 2147483647)
on conflict (id) do update set
  stock = excluded.stock,
  stock_qty = excluded.stock_qty;

-- 함수 ACL과 기존 직접 DML 차단 계약
select 1 / case when not has_function_privilege(
  'anon',
  'public.admin_adjust_stock(uuid,text,integer,integer,text)',
  'execute'
) then 1 else 0 end as assert_anon_cannot_adjust_stock;

select 1 / case when has_function_privilege(
  'authenticated',
  'public.admin_adjust_stock(uuid,text,integer,integer,text)',
  'execute'
) then 1 else 0 end as assert_authenticated_can_call_guarded_stock_rpc;

select 1 / case when not has_function_privilege(
  'service_role',
  'public.admin_adjust_stock(uuid,text,integer,integer,text)',
  'execute'
) then 1 else 0 end as assert_service_role_cannot_adjust_stock;

select 1 / case when not has_table_privilege(
  'authenticated',
  'public.goods',
  'update'
) then 1 else 0 end as assert_authenticated_cannot_update_goods_directly;

-- 일반 사용자는 authenticated 함수 권한이 있어도 내부 staff 가드를 통과하지 못한다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    perform public.admin_adjust_stock(
      '11111111-1111-4111-8111-111111111101',
      'admin-stock-test-good',
      10,
      1,
      '권한 없는 조정'
    );
  exception
    when insufficient_privilege then
      return;
  end;
  raise exception 'non-staff stock adjustment should be rejected';
end;
$$;

select 1 / case when (
  select stock_qty = 10 from public.goods where id = 'admin-stock-test-good'
) then 1 else 0 end as assert_non_staff_did_not_change_stock;

-- staff 입력 검증과 stale 수량 가드
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);

do $$
declare
  invalid_call record;
begin
  for invalid_call in
    select *
    from (values
      (null::uuid, 'admin-stock-test-good'::text, 10::integer, 1::integer, '입고'::text, 'invalid_adjustment_id'::text),
      ('11111111-1111-4111-8111-111111111102'::uuid, 'admin-stock-test-good', null::integer, 1, '입고', 'invalid_expected_stock_qty'),
      ('11111111-1111-4111-8111-111111111103'::uuid, 'admin-stock-test-good', 10, null::integer, '입고', 'invalid_stock_delta'),
      ('11111111-1111-4111-8111-111111111104'::uuid, 'admin-stock-test-good', 10, 0, '입고', 'invalid_stock_delta'),
      ('11111111-1111-4111-8111-111111111105'::uuid, 'admin-stock-test-good', 10, 1, null::text, 'invalid_stock_reason'),
      ('11111111-1111-4111-8111-111111111106'::uuid, 'admin-stock-test-good', 10, 1, '   ', 'invalid_stock_reason'),
      ('11111111-1111-4111-8111-111111111107'::uuid, 'admin-stock-test-good', 10, 1, repeat('가', 201), 'invalid_stock_reason'),
      ('11111111-1111-4111-8111-111111111108'::uuid, 'missing-good', 0, 1, '입고', 'good_not_found'),
      ('11111111-1111-4111-8111-111111111110'::uuid, 'admin-stock-test-good', 10, -11, '보정', 'stock_out_of_range'),
      ('11111111-1111-4111-8111-111111111111'::uuid, 'admin-stock-max', 2147483647, 1, '입고', 'stock_out_of_range')
    ) as invalid_values(adjustment_id, good_id, expected_qty, delta, reason, expected_message)
  loop
    begin
      perform public.admin_adjust_stock(
        invalid_call.adjustment_id,
        invalid_call.good_id,
        invalid_call.expected_qty,
        invalid_call.delta,
        invalid_call.reason
      );
    exception
      when others then
        if sqlerrm = invalid_call.expected_message then
          continue;
        end if;
        raise;
    end;
    raise exception 'invalid stock adjustment should fail with %', invalid_call.expected_message;
  end loop;
end;
$$;

do $$
begin
  begin
    perform public.admin_adjust_stock(
      '11111111-1111-4111-8111-111111111109',
      'admin-stock-test-good',
      9,
      1,
      '입고'
    );
  exception
    when sqlstate 'P0001' then
      if sqlerrm = 'stock_changed' then
        return;
      end if;
      raise;
  end;
  raise exception 'stale stock adjustment should fail without a serialization retry signal';
end;
$$;

select 1 / case when (
  select stock_qty = 10 from public.goods where id = 'admin-stock-test-good'
) then 1 else 0 end as assert_invalid_adjustments_are_atomic;

-- 첫 입고와 응답 유실 재시도는 한 번만 반영된다.
select 1 / case when public.admin_adjust_stock(
  '22222222-2222-4222-8222-222222222201',
  'admin-stock-test-good',
  10,
  5,
  '  신규 입고  '
) = 15 then 1 else 0 end as assert_staff_can_receive_stock;

select 1 / case when public.admin_adjust_stock(
  '22222222-2222-4222-8222-222222222201',
  'admin-stock-test-good',
  10,
  5,
  '신규 입고'
) = 15 then 1 else 0 end as assert_same_adjustment_is_idempotent;

select 1 / case when (
  select stock_qty = 15 and stock = 'low'
  from public.goods
  where id = 'admin-stock-test-good'
) then 1 else 0 end as assert_idempotent_adjustment_preserves_raw_stock;

do $$
begin
  begin
    perform public.admin_adjust_stock(
      '22222222-2222-4222-8222-222222222201',
      'admin-stock-test-good',
      10,
      6,
      '신규 입고'
    );
  exception
    when others then
      if sqlerrm = 'adjustment_conflict' then
        return;
      end if;
      raise;
  end;
  raise exception 'reused adjustment id with different input should be rejected';
end;
$$;

select 1 / case when public.admin_adjust_stock(
  '22222222-2222-4222-8222-222222222202',
  'admin-stock-test-good',
  15,
  -15,
  '재고 조사 보정'
) = 0 then 1 else 0 end as assert_exact_zero_adjustment_is_allowed;

select 1 / case when (
  select stock_qty = 0 and stock = 'low'
  from public.goods
  where id = 'admin-stock-test-good'
) then 1 else 0 end as assert_zero_quantity_does_not_rewrite_raw_stock;

select 1 / case when public.admin_adjust_stock(
  '22222222-2222-4222-8222-222222222203',
  'admin-stock-manual-stop',
  2,
  3,
  '판매 전 입고'
) = 5 then 1 else 0 end as assert_manual_stop_stock_can_be_received;

select 1 / case when (
  select stock_qty = 5 and stock = 'soldout'
  from public.goods
  where id = 'admin-stock-manual-stop'
) then 1 else 0 end as assert_positive_manual_soldout_is_preserved;

reset role;

-- 감사 로그는 멱등키 자체가 ID이며 성공한 세 건만 정확한 diff를 남긴다.
select 1 / case when (
  select count(*)
  from public.audit_log
  where id in (
    '22222222-2222-4222-8222-222222222201',
    '22222222-2222-4222-8222-222222222202',
    '22222222-2222-4222-8222-222222222203'
  )
) = 3 then 1 else 0 end as assert_successful_adjustments_are_audited_once;

select 1 / case when exists (
  select 1
  from public.audit_log
  where id = '22222222-2222-4222-8222-222222222201'
    and actor_id = '00000000-0000-4000-8000-000000000701'
    and action = 'admin.good.stock_adjusted'
    and target = 'goods:admin-stock-test-good'
    and diff = '{"from":10,"delta":5,"to":15,"reason":"신규 입고"}'::jsonb
) then 1 else 0 end as assert_stock_audit_payload_is_exact;

select 1 / case when not exists (
  select 1
  from public.audit_log
  where id in (
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111102',
    '11111111-1111-4111-8111-111111111103',
    '11111111-1111-4111-8111-111111111104',
    '11111111-1111-4111-8111-111111111105',
    '11111111-1111-4111-8111-111111111106',
    '11111111-1111-4111-8111-111111111107',
    '11111111-1111-4111-8111-111111111108',
    '11111111-1111-4111-8111-111111111109',
    '11111111-1111-4111-8111-111111111110',
    '11111111-1111-4111-8111-111111111111'
  )
) then 1 else 0 end as assert_rejected_adjustments_are_not_audited;

select lower(pg_get_functiondef(
  'public.admin_adjust_stock(uuid,text,integer,integer,text)'::regprocedure
)) as stock_function_body \gset

select 1 / case when strpos(:'stock_function_body', 'for update') > 0
  then 1 else 0 end as assert_stock_adjustment_locks_good_row;

select 1 / case when strpos(:'stock_function_body', 'pg_advisory_xact_lock') > 0
  then 1 else 0 end as assert_stock_adjustment_serializes_idempotency_key;

rollback;
