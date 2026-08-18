\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 택배사 레지스트리 (#251)
--
-- 이 스모크가 고정하는 계약:
--   1. 택배사 추가가 **코드 변경 없이** 등록만으로 끝난다 (이슈 완료 조건)
--   2. 등록되지 않은 코드는 orders에 들어가지 못한다 (FK가 옛 CHECK를 대체)
--   3. 비활성 택배사는 새 운송장에 붙지 않지만 기존 주문에는 남는다
--   4. 주문이 참조하는 택배사는 삭제되지 않는다
--   5. 운송장 형식·쌍 제약은 그대로다 (20260807120002 계약 유지)
--   6. 레지스트리는 공개 읽기, 쓰기는 staff
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 계약: 시작값과 제약
-- ---------------------------------------------------------------------------
select 1 / case when (
  select is_active
    and tracking_url_template like 'https://%'
    and position('{trackingNumber}' in tracking_url_template) > 0
  from public.shipping_carriers
  where code = 'hanjin'
) then 1 else 0 end as assert_hanjin_is_seeded_and_active;

-- 옛 허용 목록 CHECK가 사라지고 FK가 그 자리를 대신한다.
select 1 / case when (
  not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_shipping_carrier_check'
  )
  and exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_shipping_carrier_fkey'
      and contype = 'f'
  )
) then 1 else 0 end as assert_check_is_replaced_by_fk;

-- 운송장 형식과 쌍 제약은 택배사 목록과 무관한 규칙이라 유지된다.
select 1 / case when (
  (select count(*) from pg_constraint
   where conrelid = 'public.orders'::regclass
     and conname in ('orders_tracking_number_check', 'orders_shipment_pairing_check')) = 2
) then 1 else 0 end as assert_tracking_constraints_survive;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000921',
    'authenticated', 'authenticated', 'carrier-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000922',
    'authenticated', 'authenticated', 'carrier-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000921',
    'carrier-buyer@example.test', 'carrier_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000922',
    'carrier-staff@example.test', 'carrier_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  role = excluded.role;

insert into public.orders (id, user_id, status, total, address, expires_at, confirmed_at)
values
  -- A: 새 택배사로 발송처리할 주문
  (
    '40000000-0000-4000-8000-000000000921',
    '00000000-0000-4000-8000-000000000921', 'confirmed', 10000, '{}'::jsonb, null, now()
  ),
  -- B: 비활성 택배사를 붙이려다 거절될 주문
  (
    '40000000-0000-4000-8000-000000000922',
    '00000000-0000-4000-8000-000000000921', 'confirmed', 10000, '{}'::jsonb, null, now()
  );

-- ---------------------------------------------------------------------------
-- 1. 등록되지 않은 코드는 저장되지 않는다
-- ---------------------------------------------------------------------------
-- 옛 CHECK는 'hanjin' 하나만 허용했고 그 밖은 형식이 맞아도 거절했다. FK도 같은
-- 결론을 내되 근거가 레지스트리 행이라는 점만 다르다.
do $$
begin
  update public.orders
  set shipping_carrier = 'cj_logistics', tracking_number = '123456789012'
  where id = '40000000-0000-4000-8000-000000000921';
  raise exception 'unregistered carrier must be rejected';
exception
  when foreign_key_violation then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 택배사 추가는 등록만으로 끝난다 — 이슈 #251의 완료 조건
-- ---------------------------------------------------------------------------
-- 마이그레이션도 배포도 없이 insert 한 줄이면 그 택배사로 발송처리가 통과해야 한다.
insert into public.shipping_carriers (code, label, tracking_url_template, sort_order)
values (
  'cj_logistics', 'CJ대한통운',
  'https://example.test/track?no={trackingNumber}', 20
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000922', true);

select public.admin_update_order_status(
  '40000000-0000-4000-8000-000000000921', 'shipping', 'cj_logistics', '123456789012'
);

select 1 / case when (
  select status = 'shipping'
    and shipping_carrier = 'cj_logistics'
    and tracking_number = '123456789012'
    and shipped_at is not null
  from public.orders
  where id = '40000000-0000-4000-8000-000000000921'
) then 1 else 0 end as assert_new_carrier_needs_registry_only;

-- ---------------------------------------------------------------------------
-- 3. 비활성 택배사는 새 운송장에 붙지 않는다
-- ---------------------------------------------------------------------------
-- FK로는 표현할 수 없는 규칙이다. 비활성 택배사는 기존 주문에 남아야 하므로
-- 참조 자체를 막을 수 없고, "지금 고를 수 있는가"는 쓰기 경로가 판정한다.
reset role;
insert into public.shipping_carriers (code, label, is_active, tracking_url_template)
values (
  'retired_courier', '계약종료 택배', false,
  'https://example.test/old?no={trackingNumber}'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000922', true);

do $$
begin
  perform public.admin_update_order_status(
    '40000000-0000-4000-8000-000000000922', 'shipping', 'retired_courier', '999999999999'
  );
  raise exception 'inactive carrier must be rejected';
exception
  when check_violation then null;
end;
$$;

select 1 / case when (
  select status = 'confirmed' and shipping_carrier is null
  from public.orders
  where id = '40000000-0000-4000-8000-000000000922'
) then 1 else 0 end as assert_inactive_carrier_leaves_order_untouched;

-- ---------------------------------------------------------------------------
-- 4. 비활성화는 기존 주문의 조회를 지우지 않는다
-- ---------------------------------------------------------------------------
-- 계약이 끝난 택배사로 이미 나간 주문도 고객은 계속 추적할 수 있어야 한다.
-- 비활성화 뒤에도 배송완료 전이가 막히지 않는지 함께 본다.
reset role;
update public.shipping_carriers set is_active = false where code = 'cj_logistics';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000922', true);

select public.admin_update_order_status(
  '40000000-0000-4000-8000-000000000921', 'delivered', null, null
);

select 1 / case when (
  select status = 'delivered'
    and shipping_carrier = 'cj_logistics'
    and tracking_number = '123456789012'
    and delivered_at is not null
  from public.orders
  where id = '40000000-0000-4000-8000-000000000921'
) then 1 else 0 end as assert_deactivation_keeps_existing_shipment;

-- ---------------------------------------------------------------------------
-- 5. 주문이 참조하는 택배사는 지울 수 없다
-- ---------------------------------------------------------------------------
-- 삭제를 허용하면 배송조회가 조용히 사라진다. 목록에서 내리는 수단은 비활성화다.
reset role;
do $$
begin
  delete from public.shipping_carriers where code = 'cj_logistics';
  raise exception 'referenced carrier must not be deletable';
exception
  when foreign_key_violation then null;
end;
$$;

-- 참조가 없는 택배사는 지울 수 있다 — 잘못 등록한 행을 되돌릴 길은 있어야 한다.
delete from public.shipping_carriers where code = 'retired_courier';
select 1 / case when (
  not exists (select 1 from public.shipping_carriers where code = 'retired_courier')
) then 1 else 0 end as assert_unreferenced_carrier_is_deletable;

-- ---------------------------------------------------------------------------
-- 6. 템플릿 제약 — 자리표시자 없는 URL은 모든 주문을 같은 곳으로 보낸다
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.shipping_carriers (code, label, tracking_url_template)
  values ('no_token', '자리표시자 없음', 'https://example.test/track');
  raise exception 'template without placeholder must be rejected';
exception
  when check_violation then null;
end;
$$;

do $$
begin
  insert into public.shipping_carriers (code, label, tracking_url_template)
  values ('plain_http', '평문 HTTP', 'http://example.test/track?no={trackingNumber}');
  raise exception 'non-https template must be rejected';
exception
  when check_violation then null;
end;
$$;

do $$
begin
  insert into public.shipping_carriers (code, label, tracking_url_template)
  values ('BadCode', '대문자 코드', 'https://example.test/track?no={trackingNumber}');
  raise exception 'uppercase carrier code must be rejected';
exception
  when check_violation then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 권한 — 공개 읽기, staff 쓰기
-- ---------------------------------------------------------------------------
-- 배송조회 링크는 고객 주문 상세가 그린다. 읽기가 막히면 로그인 없이 주문을 볼 수
-- 없게 되는 것이 아니라, 등록된 운송장이 화면에서 통째로 사라진다.
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

select 1 / case when (
  (select count(*) from public.shipping_carriers where code = 'hanjin') = 1
) then 1 else 0 end as assert_registry_is_publicly_readable;

do $$
begin
  insert into public.shipping_carriers (code, label, tracking_url_template)
  values ('anon_carrier', '익명 등록', 'https://example.test/track?no={trackingNumber}');
  raise exception 'anon must not write the registry';
exception
  when insufficient_privilege then null;
end;
$$;

-- 일반 사용자도 등록할 수 없다. 택배사 추가는 staff 권한 안에서만 열린다.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000921', true);

do $$
begin
  insert into public.shipping_carriers (code, label, tracking_url_template)
  values ('user_carrier', '일반 사용자 등록', 'https://example.test/track?no={trackingNumber}');
  raise exception 'plain user must not write the registry';
exception
  when insufficient_privilege then null;
end;
$$;

-- staff는 등록할 수 있다 — 배포 없이 택배사를 늘리는 경로 그 자체다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000922', true);

insert into public.shipping_carriers (code, label, tracking_url_template)
values ('lotte', '롯데택배', 'https://example.test/lotte?no={trackingNumber}');

select 1 / case when (
  (select count(*) from public.shipping_carriers where code = 'lotte') = 1
) then 1 else 0 end as assert_staff_can_register_carrier;

rollback;
