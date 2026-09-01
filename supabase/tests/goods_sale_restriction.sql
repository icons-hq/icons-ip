\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 판매 제한 상품과 주문 단위 provider 파생 (#392)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   1. 제한 축은 goods 컬럼이고 기본값은 none이다 — 기존 상품이 조용히
--      판매 중지로 바뀌지 않는다
--   2. 제한 전환은 staff 세션 전용 setter로만 일어나고 감사 기록이 남는다
--   3. 제한 상품 구매는 주문 생성에서 막힌다 — 스토어 비노출은 쿼리
--      레이어라 보안 경계가 아니다
--   4. 카드 provider는 주문 구성에서 파생된다 — 일반 주문은 toss, 제한
--      주문은 korpay뿐이고 클라이언트가 고를 수 없다
--   5. 무통장은 PG가 아니라 업종 제한과 무관하다 — 제한 주문에서도 열린다
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 계약: enum 값 · 타입 usage · 실행 권한
-- ---------------------------------------------------------------------------
-- 'random_box'(이치방쿠지형)는 도입 확정 전까지 값으로 넣지 않는다. 미확정
-- 값이 미리 있으면 앱이 그 값을 분기하기 시작한다.
select 1 / case when (
  'none' = any (
    select value::text
    from unnest(enum_range(null::public.goods_sale_restriction)) as t(value)
  )
  and 'adult' = any (
    select value::text
    from unnest(enum_range(null::public.goods_sale_restriction)) as t(value)
  )
  and not (
    'random_box' = any (
      select value::text
      from unnest(enum_range(null::public.goods_sale_restriction)) as t(value)
    )
  )
) then 1 else 0 end as assert_sale_restriction_enum_defers_random_box;

-- goods는 공개 읽기 테이블이다. anon에게 타입 usage가 없으면 로그인하지 않은
-- 방문자의 상품 조회(그리고 sale_restriction = 'none' 필터)가 깨진다.
select 1 / case when (
  has_type_privilege('anon', 'public.goods_sale_restriction', 'usage')
  and has_type_privilege('authenticated', 'public.goods_sale_restriction', 'usage')
  and has_type_privilege('service_role', 'public.goods_sale_restriction', 'usage')
) then 1 else 0 end as assert_sale_restriction_type_is_readable_by_public_surfaces;

-- 운영 스위치는 staff 세션(authenticated)만. anon도, service role도 아니다.
select 1 / case when (
  not has_function_privilege(
    'anon',
    'public.admin_set_good_sale_restriction(text, public.goods_sale_restriction)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.admin_set_good_sale_restriction(text, public.goods_sale_restriction)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_set_good_sale_restriction(text, public.goods_sale_restriction)',
    'execute'
  )
) then 1 else 0 end as assert_sale_restriction_setter_is_staff_session_only;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000f01',
    'authenticated', 'authenticated', 'restrict-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000f02',
    'authenticated', 'authenticated', 'restrict-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000f01',
    'restrict-buyer@example.test', 'restrict_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role
  ),
  (
    '00000000-0000-4000-8000-000000000f02',
    'restrict-staff@example.test', 'restrict_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'::public.user_role
  )
-- auth.users 트리거가 먼저 만든 프로필 행이 있으면 온보딩 칸이 비어 있다.
-- place_order는 그 칸들을 전부 본다 — 갱신에서 빠뜨리면 'onboarding required'다.
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('restrict-ip', '판매 제한 IP', 'character');

-- 두 굿즈 모두 컬럼을 명시하지 않는다. 제한 전환은 아래 setter가 한다 —
-- 운영 경로를 거치지 않은 값으로 뒤 절들을 세우면 setter가 고장나도 통과한다.
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('restrict-plain-goods', 'restrict-ip', '일반 굿즈', '문구', 20000, 'ok', 10),
  ('restrict-adult-goods', 'restrict-ip', '판매 제한 굿즈', '문구', 20000, 'ok', 10);

-- 새 컬럼의 기본값은 제한 없음이다. 기존 상품이 조용히 판매 중지로 바뀌면
-- 마이그레이션 한 번에 스토어가 비어 버린다.
select 1 / case when (
  select count(*) = 2
  from public.goods
  where id in ('restrict-plain-goods', 'restrict-adult-goods')
    and sale_restriction = 'none'
) then 1 else 0 end as assert_sale_restriction_defaults_to_none;

-- ---------------------------------------------------------------------------
-- setter — staff만 뒤집고, 감사 기록이 남는다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000f02', true);

select public.admin_set_good_sale_restriction(
  'restrict-adult-goods',
  'adult'::public.goods_sale_restriction
);

reset role;
select 1 / case when (
  select sale_restriction = 'adult'
  from public.goods
  where id = 'restrict-adult-goods'
) then 1 else 0 end as assert_staff_can_restrict_a_good;

-- 제한 전환은 매출과 노출을 동시에 끄는 결정이다. 누가 언제 무엇을 바꿨는지
-- 남지 않으면 사후에 되짚을 수 없다.
select 1 / case when (
  select count(*) = 1
    and bool_and(actor_id = '00000000-0000-4000-8000-000000000f02')
    and bool_and(diff ->> 'saleRestriction' = 'adult')
  from public.audit_log
  where action = 'catalog.good.sale_restriction_changed'
    and target = 'goods:restrict-adult-goods'
) then 1 else 0 end as assert_restriction_change_is_audited;

-- 구매자는 이 스위치에 손댈 수 없다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000f01', true);

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_set_good_sale_restriction(
      'restrict-adult-goods',
      'none'::public.goods_sale_restriction
    );
    accepted := true;
  exception
    when insufficient_privilege then accepted := false;
  end;

  if accepted then
    raise exception 'a buyer must not change a sale restriction';
  end if;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- 주문 생성 — 제한 상품은 서버가 막는다
-- ---------------------------------------------------------------------------
-- 주문 생성은 service role 경계 안에 있다. 스모크는 superuser 세션에서 그
-- 경계를 직접 부른다 — 브라우저 롤로는 닿을 수 없는 경로다.
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000f01', 'restrict-plain-goods', 1);

select public.place_order(
  '00000000-0000-4000-8000-000000000f01'::uuid,
  jsonb_build_object(
    'recipientName', '일반',
    'phone', '01012345678',
    'postalCode', '06236',
    'address1', '서울시 강남구'
  ),
  '9c000000-0000-4000-8000-000000000001'::uuid,
  'card'::public.order_payment_method
) as plain_order_id \gset

-- 제한이 없는 상품은 그대로 팔린다. 가드가 일반 주문까지 잡으면 이 절이 먼저 깨진다.
select 1 / case when (
  select status = 'pending' and total = 23000 and payment_method = 'card'
  from public.orders
  where id = :'plain_order_id'::uuid
) then 1 else 0 end as assert_unrestricted_good_still_orders;

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000f01', 'restrict-adult-goods', 1);

do $$
declare
  accepted boolean := false;
  blocked_message text := '';
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000f01'::uuid,
      jsonb_build_object(
        'recipientName', '제한',
        'phone', '01012345678',
        'postalCode', '06236',
        'address1', '서울시 강남구'
      ),
      '9c000000-0000-4000-8000-000000000002'::uuid,
      'card'::public.order_payment_method
    );
    accepted := true;
  exception
    when check_violation then blocked_message := sqlerrm;
  end;

  if accepted then
    raise exception 'a restricted good must not be ordered';
  end if;
  if blocked_message not like 'restricted good blocked:%' then
    raise exception 'a restricted good was rejected for the wrong reason: %', blocked_message;
  end if;
end;
$$;

-- 막힌 주문은 재고를 가져가지 않았다.
select 1 / case when (
  select stock_qty = 10 from public.goods where id = 'restrict-adult-goods'
) then 1 else 0 end as assert_blocked_restricted_order_holds_no_stock;

-- 거절된 주문은 장바구니를 비우지 않는다. 뒤 절이 이 굿즈를 딸려 담지 않도록 치운다.
delete from public.cart_items
where user_id = '00000000-0000-4000-8000-000000000f01'
  and good_id = 'restrict-adult-goods';

-- ---------------------------------------------------------------------------
-- provider 파생 — 일반 주문은 toss뿐이다
-- ---------------------------------------------------------------------------
do $$
declare
  accepted boolean := false;
  rejection text := '';
begin
  begin
    perform public.prepare_goods_payment_attempt(
      '00000000-0000-4000-8000-000000000f01',
      (
        select id from public.orders
        where checkout_key = '9c000000-0000-4000-8000-000000000001'
      ),
      'korpay'::public.payment_provider
    );
    accepted := true;
  exception
    when object_not_in_prerequisite_state then rejection := sqlerrm;
  end;

  if accepted then
    raise exception 'an unrestricted order must not open a korpay attempt';
  end if;
  if rejection <> 'goods_payment_provider_mismatch' then
    raise exception 'an unrestricted korpay attempt failed for the wrong reason: %', rejection;
  end if;
end;
$$;

select public.prepare_goods_payment_attempt(
  '00000000-0000-4000-8000-000000000f01',
  :'plain_order_id'::uuid,
  'toss'::public.payment_provider
);

select 1 / case when (
  select count(*) = 1
    and bool_and(attempt.provider = 'toss')
    and bool_and(attempt.state = 'prepared')
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = :'plain_order_id'::uuid
) then 1 else 0 end as assert_unrestricted_order_opens_a_toss_attempt;

-- ---------------------------------------------------------------------------
-- provider 파생 — 제한 주문은 korpay뿐이다
-- ---------------------------------------------------------------------------
-- place_order가 제한 주문을 거절하므로 픽스처는 주문·아이템을 직접 만든다.
-- 성인인증(#209·#210)이 붙어 주문 생성 차단이 걷히면 실제로 이 모양의 주문이
-- 생기고, 그때 prepare가 유일한 provider 경계가 된다.
insert into public.orders (
  id, user_id, status, total, shipping_fee, discount_total,
  address, expires_at, checkout_key, payment_method
)
values
  (
    '2c000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000f01',
    'pending', 23000, 3000, 0,
    jsonb_build_object(
      'recipientName', '제한카드',
      'phone', '01012345678',
      'postalCode', '06236',
      'address1', '서울시 강남구'
    ),
    now() + interval '15 minutes',
    '9c000000-0000-4000-8000-000000000003',
    'card'
  ),
  (
    '2c000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000f01',
    'pending', 23000, 3000, 0,
    jsonb_build_object(
      'recipientName', '제한무통장',
      'phone', '01012345678',
      'postalCode', '06236',
      'address1', '서울시 강남구'
    ),
    now() + interval '24 hours',
    '9c000000-0000-4000-8000-000000000004',
    'bank_transfer'
  );

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values
  (
    '2c000000-0000-4000-8000-000000000001', 'restrict-adult-goods', 1, 20000,
    '판매 제한 굿즈', '문구', 'restrict-ip'
  ),
  (
    '2c000000-0000-4000-8000-000000000002', 'restrict-adult-goods', 1, 20000,
    '판매 제한 굿즈', '문구', 'restrict-ip'
  );

do $$
declare
  accepted boolean := false;
  rejection text := '';
begin
  begin
    perform public.prepare_goods_payment_attempt(
      '00000000-0000-4000-8000-000000000f01',
      '2c000000-0000-4000-8000-000000000001',
      'toss'::public.payment_provider
    );
    accepted := true;
  exception
    when object_not_in_prerequisite_state then rejection := sqlerrm;
  end;

  if accepted then
    raise exception 'a restricted order must not open a toss attempt';
  end if;
  if rejection <> 'goods_payment_provider_mismatch' then
    raise exception 'a restricted toss attempt failed for the wrong reason: %', rejection;
  end if;
end;
$$;

select public.prepare_goods_payment_attempt(
  '00000000-0000-4000-8000-000000000f01',
  '2c000000-0000-4000-8000-000000000001'::uuid,
  'korpay'::public.payment_provider
);

select 1 / case when (
  select count(*) = 1
    and bool_and(attempt.provider = 'korpay')
    and bool_and(attempt.state = 'prepared')
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = '2c000000-0000-4000-8000-000000000001'::uuid
) then 1 else 0 end as assert_restricted_order_opens_a_korpay_attempt;

-- 무통장은 PG 경로가 아니다. 업종 제한은 카드 매입사 계약의 문제이므로
-- 제한 상품이라고 자체 법인계좌 입금까지 막을 이유가 없다.
select public.prepare_goods_payment_attempt(
  '00000000-0000-4000-8000-000000000f01',
  '2c000000-0000-4000-8000-000000000002'::uuid,
  'bank_transfer'::public.payment_provider
);

select 1 / case when (
  select count(*) = 1
    and bool_and(attempt.provider = 'bank_transfer')
    and bool_and(attempt.state = 'prepared')
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = '2c000000-0000-4000-8000-000000000002'::uuid
) then 1 else 0 end as assert_restriction_does_not_close_bank_transfer;

rollback;
