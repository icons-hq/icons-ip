\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 발송지연 메모와 지연 조회 (#251)
--
-- 이 스모크가 고정하는 계약:
--   1. 지연은 상태가 아니다 — order_status enum에 delayed가 없다
--   2. 메모는 staff만 읽고 쓰며, 쓰기 입구는 감사 로그를 남기는 RPC뿐이다
--   3. 사유를 비우면 메모가 지워진다 (지연 해제 경로)
--   4. 이미 발송된 주문에는 지연 메모가 붙지 않는다
--   5. admin_search_orders(p_confirmed_before)가 발주확인 시점으로 거른다
--   6. 발주확인 기록이 없는 주문은 지연 목록에 들어가지 않는다
-- ============================================================================

-- 지연을 위해 새 enum 값을 만들지 않았다. 사다리가 늘면 발송처리 때 되돌려야 하는
-- 전이가 생기고, 자사몰이라 지연에 붙는 페널티도 없다.
select 1 / case when (
  not exists (
    select 1
    from unnest(enum_range(null::public.order_status)) as t(value)
    where value::text = 'delayed'
  )
) then 1 else 0 end as assert_delay_is_not_a_status;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000931',
    'authenticated', 'authenticated', 'delay-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000932',
    'authenticated', 'authenticated', 'delay-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000931',
    'delay-buyer@example.test', 'delay_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000932',
    'delay-staff@example.test', 'delay_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  role = excluded.role;

insert into public.orders (
  id, user_id, status, total, address, expires_at, confirmed_at, shipped_at,
  shipping_carrier, tracking_number
)
values
  -- A: 발주확인 후 5일 — 지연 목록에 들어간다
  (
    '40000000-0000-4000-8000-000000000931',
    '00000000-0000-4000-8000-000000000931', 'confirmed', 10000, '{}'::jsonb, null,
    now() - interval '5 days', null, null, null
  ),
  -- B: 발주확인 후 1일 — 아직 지연이 아니다
  (
    '40000000-0000-4000-8000-000000000932',
    '00000000-0000-4000-8000-000000000931', 'confirmed', 10000, '{}'::jsonb, null,
    now() - interval '1 day', null, null, null
  ),
  -- C: 발주확인 기록이 없는 주문 — 기산점이 없으므로 지연으로 부르지 않는다
  (
    '40000000-0000-4000-8000-000000000933',
    '00000000-0000-4000-8000-000000000931', 'confirmed', 10000, '{}'::jsonb, null,
    null, null, null, null
  ),
  -- D: 이미 발송된 주문 — 지연 메모 대상이 아니다
  (
    '40000000-0000-4000-8000-000000000934',
    '00000000-0000-4000-8000-000000000931', 'shipping', 10000, '{}'::jsonb, null,
    now() - interval '9 days', now() - interval '8 days', 'hanjin', '123456789012'
  );

-- ---------------------------------------------------------------------------
-- 1. 메모 등록 — staff만, 감사 로그와 함께
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000932', true);

select public.admin_upsert_order_dispatch_delay(
  '40000000-0000-4000-8000-000000000931', '작가 재입고 지연', '2026-08-25'
);

select 1 / case when (
  select reason = '작가 재입고 지연'
    and expected_ship_date = date '2026-08-25'
    and noted_by = '00000000-0000-4000-8000-000000000932'
  from public.order_dispatch_delays
  where order_id = '40000000-0000-4000-8000-000000000931'
) then 1 else 0 end as assert_delay_note_is_recorded;

select 1 / case when (
  exists (
    select 1
    from public.audit_log
    where action = 'admin.order.dispatch_delay_noted'
      and target = 'order:40000000-0000-4000-8000-000000000931'
  )
) then 1 else 0 end as assert_delay_note_is_audited;

-- 같은 주문에 다시 쓰면 덮어쓴다. 주문당 한 줄이어야 지연 목록이 중복되지 않는다.
select public.admin_upsert_order_dispatch_delay(
  '40000000-0000-4000-8000-000000000931', '창고 이전 작업', null
);

select 1 / case when (
  select count(*) = 1
  from public.order_dispatch_delays
  where order_id = '40000000-0000-4000-8000-000000000931'
) then 1 else 0 end as assert_delay_note_is_one_row_per_order;

select 1 / case when (
  select reason = '창고 이전 작업' and expected_ship_date is null
  from public.order_dispatch_delays
  where order_id = '40000000-0000-4000-8000-000000000931'
) then 1 else 0 end as assert_delay_note_overwrites;

-- ---------------------------------------------------------------------------
-- 2. 사유를 비우면 해제된다
-- ---------------------------------------------------------------------------
-- 해제 수단이 없으면 운영자가 사유를 '해결'로 덮어쓰고 지연 목록이 영원히 줄지 않는다.
select public.admin_upsert_order_dispatch_delay(
  '40000000-0000-4000-8000-000000000931', '   ', null
);

select 1 / case when (
  not exists (
    select 1
    from public.order_dispatch_delays
    where order_id = '40000000-0000-4000-8000-000000000931'
  )
) then 1 else 0 end as assert_blank_reason_clears_note;

select 1 / case when (
  exists (
    select 1
    from public.audit_log
    where action = 'admin.order.dispatch_delay_cleared'
      and target = 'order:40000000-0000-4000-8000-000000000931'
  )
) then 1 else 0 end as assert_delay_clear_is_audited;

-- ---------------------------------------------------------------------------
-- 3. 이미 발송된 주문에는 붙지 않는다
-- ---------------------------------------------------------------------------
-- 나간 주문의 "지연 사유"는 기록이 아니라 혼선이다.
do $$
begin
  perform public.admin_upsert_order_dispatch_delay(
    '40000000-0000-4000-8000-000000000934', '늦었음', null
  );
  raise exception 'dispatched order must not accept a delay note';
exception
  when check_violation then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 권한 — 구매자는 읽지도 쓰지도 못한다
-- ---------------------------------------------------------------------------
-- 운영 기록이다. 지연 고지는 문구·기한·법적 함의가 따로 있는 별개 결정이라
-- 메모를 그대로 노출하면 그 결정을 건너뛰게 된다.
select public.admin_upsert_order_dispatch_delay(
  '40000000-0000-4000-8000-000000000932', '부자재 수급 지연', null
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000931', true);

select 1 / case when (
  (select count(*) from public.order_dispatch_delays) = 0
) then 1 else 0 end as assert_buyer_cannot_read_delay_notes;

do $$
begin
  perform public.admin_upsert_order_dispatch_delay(
    '40000000-0000-4000-8000-000000000932', '내가 쓰는 사유', null
  );
  raise exception 'plain user must not write a delay note';
exception
  when insufficient_privilege then null;
end;
$$;

-- 쓰기 정책이 없으므로 테이블 직접 쓰기도 막힌다 — 감사 로그를 남기는 RPC가
-- 유일한 입구여야 한다.
do $$
begin
  insert into public.order_dispatch_delays (order_id, reason)
  values ('40000000-0000-4000-8000-000000000932', '직접 입력');
  raise exception 'direct table write must be blocked';
exception
  when insufficient_privilege then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 발주확인 시점 필터
-- ---------------------------------------------------------------------------
-- 목록은 페이지네이션되므로 앱에서 가져온 뒤 걸러내면 건수와 페이지가 어긋난다.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000932', true);

-- 3일 경계: A(5일)만 남고 B(1일)와 C(기록 없음)는 빠진다.
select 1 / case when (
  (
    select array_agg(id order by id)
    from public.admin_search_orders(
      p_status := 'confirmed',
      p_confirmed_before := now() - interval '3 days'
    )
  ) = array['40000000-0000-4000-8000-000000000931'::uuid]
) then 1 else 0 end as assert_delayed_filter_uses_confirmed_at;

-- 경계를 주지 않으면 confirmed 전체가 나온다 — 기본값이 목록을 좁히면 안 된다.
select 1 / case when (
  (
    select count(*)
    from public.admin_search_orders(p_status := 'confirmed')
  ) = 3
) then 1 else 0 end as assert_default_search_is_unfiltered;

-- 발주확인 기록이 없는 주문을 지연으로 부르면 실제로 늦은 주문을 못 찾는다.
select 1 / case when (
  not exists (
    select 1
    from public.admin_search_orders(
      p_status := 'confirmed',
      p_confirmed_before := now()
    )
    where id = '40000000-0000-4000-8000-000000000933'
  )
) then 1 else 0 end as assert_missing_confirmed_at_is_not_delayed;

-- 창 함수 total_count도 필터를 함께 본다. 어긋나면 페이지네이션이 깨진다.
select 1 / case when (
  (
    select total_count
    from public.admin_search_orders(
      p_status := 'confirmed',
      p_confirmed_before := now() - interval '3 days'
    )
    limit 1
  ) = 1
) then 1 else 0 end as assert_delayed_total_count_matches;

-- ---------------------------------------------------------------------------
-- 6. RPC 실행 권한
-- ---------------------------------------------------------------------------
reset role;
select 1 / case when (
  not has_function_privilege('anon', 'public.admin_upsert_order_dispatch_delay(uuid, text, date)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_upsert_order_dispatch_delay(uuid, text, date)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_upsert_order_dispatch_delay(uuid, text, date)', 'execute')
) then 1 else 0 end as assert_delay_rpc_acl;

rollback;
