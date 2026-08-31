\set ON_ERROR_STOP on

-- 쿠폰 도메인 스모크: 발급→카트 적용→주문 할인 확정→취소 복구의 돈 불변식.
-- 할인은 서버 주문 생성 RPC(place_order) 한 곳에서만 확정된다(ADR-0011).
-- 쿠폰 없는 주문의 금액 경로는 checkout_order.sql이 지키는 기존 계약 그대로여야 한다.

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000701',
    'authenticated', 'authenticated', 'coupon-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000702',
    'authenticated', 'authenticated', 'coupon-second@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000703',
    'authenticated', 'authenticated', 'coupon-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000701',
    'coupon-buyer@example.test', 'coupon_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000702',
    'coupon-second@example.test', 'coupon_second', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000703',
    'coupon-staff@example.test', 'coupon_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('cpn-ip', '쿠폰 스모크 IP', 'character')
on conflict (id) do nothing;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('cpn-g1', 'cpn-ip', '쿠폰 굿즈 3만', '피규어', 30000, 'ok', 100),
  ('cpn-g2', 'cpn-ip', '쿠폰 굿즈 4만', '피규어', 40000, 'ok', 100),
  ('cpn-g3', 'cpn-ip', '쿠폰 굿즈 9만', '피규어', 90000, 'ok', 100)
on conflict (id) do update set
  price = excluded.price, stock = excluded.stock, stock_qty = excluded.stock_qty;

-- ── 스키마·ACL 계약 ─────────────────────────────────────────────────────────

select 1 / case when (
  select count(*) = 4
  from pg_tables
  where schemaname = 'public'
    and tablename in ('coupons', 'user_coupons', 'coupon_redemptions', 'cart_coupon_selections')
    and rowsecurity
) then 1 else 0 end as assert_coupon_tables_have_rls;

select 1 / case when not has_table_privilege('anon', 'public.coupons', 'select')
  and not has_table_privilege('authenticated', 'public.coupons', 'insert')
  and not has_table_privilege('authenticated', 'public.coupons', 'update')
  and not has_table_privilege('authenticated', 'public.user_coupons', 'insert')
  and not has_table_privilege('authenticated', 'public.user_coupons', 'update')
  and not has_table_privilege('authenticated', 'public.coupon_redemptions', 'insert')
  and not has_table_privilege('authenticated', 'public.cart_coupon_selections', 'insert')
then 1 else 0 end as assert_coupon_tables_write_sealed;

select 1 / case when not has_function_privilege('anon', 'public.apply_cart_coupon_code(text)', 'execute')
  and has_function_privilege('authenticated', 'public.apply_cart_coupon_code(text)', 'execute')
  and not has_function_privilege('anon', 'public.apply_cart_coupon(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.apply_cart_coupon(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.clear_cart_coupon()', 'execute')
  and has_function_privilege('authenticated', 'public.clear_cart_coupon()', 'execute')
  and not has_function_privilege('anon', 'public.admin_upsert_coupon(text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, text, public.loyalty_grade, text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_upsert_coupon(text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, text, public.loyalty_grade, text)', 'execute')
then 1 else 0 end as assert_coupon_rpc_acl;

-- 주문당 applied redemption은 1장 — 스키마가 강제한다.
select 1 / case when exists (
  select 1 from pg_indexes
  where schemaname = 'public'
    and tablename = 'coupon_redemptions'
    and indexdef like '%UNIQUE%'
    and indexdef like '%order_id%'
    and indexdef like '%applied%'
) then 1 else 0 end as assert_one_applied_redemption_per_order;

-- ── 어드민 upsert 계약 (admin_upsert_* 시리즈와 동형) ───────────────────────

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000703', true);
set local role authenticated;

select public.admin_upsert_coupon(
  target_code => 'CPNFIX5K',
  target_name => '5천원 할인',
  target_discount_type => 'fixed',
  target_discount_value => 5000,
  target_max_discount_amount => null,
  target_min_subtotal => 20000,
  target_starts_at => now() - interval '1 hour',
  target_ends_at => now() + interval '30 days',
  target_issue_limit => null,
  target_status => 'active',
  target_grade_benefit => null,
  target_previous_code => null
);

select public.admin_upsert_coupon(
  target_code => 'CPNPCT10',
  target_name => '10% 할인',
  target_discount_type => 'percent',
  target_discount_value => 10,
  target_max_discount_amount => 8000,
  target_min_subtotal => 50000,
  target_starts_at => now() - interval '1 hour',
  target_ends_at => now() + interval '30 days',
  target_issue_limit => null,
  target_status => 'active',
  target_grade_benefit => null,
  target_previous_code => null
);

select public.admin_upsert_coupon(
  target_code => 'CPNBIG',
  target_name => '5만원 할인',
  target_discount_type => 'fixed',
  target_discount_value => 50000,
  target_max_discount_amount => null,
  target_min_subtotal => 0,
  target_starts_at => now() - interval '1 hour',
  target_ends_at => null,
  target_issue_limit => null,
  target_status => 'active',
  target_grade_benefit => null,
  target_previous_code => null
);

select public.admin_upsert_coupon(
  target_code => 'CPNONE',
  target_name => '한도 1장',
  target_discount_type => 'fixed',
  target_discount_value => 1000,
  target_max_discount_amount => null,
  target_min_subtotal => 0,
  target_starts_at => now() - interval '1 hour',
  target_ends_at => null,
  target_issue_limit => 1,
  target_status => 'active',
  target_grade_benefit => null,
  target_previous_code => null
);

select public.admin_upsert_coupon(
  target_code => 'CPNMIN50',
  target_name => '5만 이상 3천원',
  target_discount_type => 'fixed',
  target_discount_value => 3000,
  target_max_discount_amount => null,
  target_min_subtotal => 50000,
  target_starts_at => now() - interval '1 hour',
  target_ends_at => null,
  target_issue_limit => null,
  target_status => 'active',
  target_grade_benefit => null,
  target_previous_code => null
);

select public.admin_upsert_coupon(
  target_code => 'CPNEXP',
  target_name => '만료 쿠폰',
  target_discount_type => 'fixed',
  target_discount_value => 1000,
  target_max_discount_amount => null,
  target_min_subtotal => 0,
  target_starts_at => now() - interval '2 days',
  target_ends_at => now() - interval '1 day',
  target_issue_limit => null,
  target_status => 'active',
  target_grade_benefit => null,
  target_previous_code => null
);

select public.admin_upsert_coupon(
  target_code => 'CPNSOON',
  target_name => '예정 쿠폰',
  target_discount_type => 'fixed',
  target_discount_value => 1000,
  target_max_discount_amount => null,
  target_min_subtotal => 0,
  target_starts_at => now() + interval '1 day',
  target_ends_at => null,
  target_issue_limit => null,
  target_status => 'active',
  target_grade_benefit => null,
  target_previous_code => null
);

select public.admin_upsert_coupon(
  target_code => 'CPNARCH',
  target_name => '보관 쿠폰',
  target_discount_type => 'fixed',
  target_discount_value => 1000,
  target_max_discount_amount => null,
  target_min_subtotal => 0,
  target_starts_at => now() - interval '1 hour',
  target_ends_at => null,
  target_issue_limit => null,
  target_status => 'archived',
  target_grade_benefit => null,
  target_previous_code => null
);

select 1 / case when (
  select count(*) from public.coupons
  where code in ('CPNFIX5K', 'CPNPCT10', 'CPNBIG', 'CPNONE', 'CPNMIN50', 'CPNEXP', 'CPNSOON', 'CPNARCH')
) = 8 then 1 else 0 end as assert_admin_created_coupons;

select 1 / case when exists (
  select 1 from public.audit_log
  where action = 'commerce.coupon.upsert'
    and actor_id = '00000000-0000-4000-8000-000000000703'
    and target = 'coupons:CPNFIX5K'
) then 1 else 0 end as assert_coupon_upsert_audited;

-- 같은 코드 신규 등록은 거부된다.
do $$
begin
  begin
    perform public.admin_upsert_coupon(
      target_code => 'CPNFIX5K',
      target_name => '중복 코드',
      target_discount_type => 'fixed',
      target_discount_value => 1000,
      target_max_discount_amount => null,
      target_min_subtotal => 0,
      target_starts_at => now(),
      target_ends_at => null,
      target_issue_limit => null,
      target_status => 'active',
      target_grade_benefit => null,
      target_previous_code => null
    );
    raise exception 'duplicate coupon code should be rejected';
  exception
    when unique_violation then
      if sqlerrm <> 'catalog_id_taken' then raise; end if;
  end;
end;
$$;

-- 코드 변경 시도는 거부된다.
do $$
begin
  begin
    perform public.admin_upsert_coupon(
      target_code => 'CPNRENAME',
      target_name => '개명 시도',
      target_discount_type => 'fixed',
      target_discount_value => 1000,
      target_max_discount_amount => null,
      target_min_subtotal => 0,
      target_starts_at => now(),
      target_ends_at => null,
      target_issue_limit => null,
      target_status => 'active',
      target_grade_benefit => null,
      target_previous_code => 'CPNFIX5K'
    );
    raise exception 'coupon code change should be rejected';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'catalog_id_immutable' then raise; end if;
  end;
end;
$$;

-- 없는 레코드 수정은 거부된다.
do $$
begin
  begin
    perform public.admin_upsert_coupon(
      target_code => 'CPNMISSING',
      target_name => '없는 쿠폰',
      target_discount_type => 'fixed',
      target_discount_value => 1000,
      target_max_discount_amount => null,
      target_min_subtotal => 0,
      target_starts_at => now(),
      target_ends_at => null,
      target_issue_limit => null,
      target_status => 'active',
      target_grade_benefit => null,
      target_previous_code => 'CPNMISSING'
    );
    raise exception 'missing coupon update should be rejected';
  exception
    when no_data_found then
      if sqlerrm <> 'catalog_record_missing' then raise; end if;
  end;
end;
$$;

-- 정률 쿠폰 값 검증: 100 초과는 거부된다.
do $$
begin
  begin
    perform public.admin_upsert_coupon(
      target_code => 'CPNPCTBAD',
      target_name => '나쁜 정률',
      target_discount_type => 'percent',
      target_discount_value => 150,
      target_max_discount_amount => null,
      target_min_subtotal => 0,
      target_starts_at => now(),
      target_ends_at => null,
      target_issue_limit => null,
      target_status => 'active',
      target_grade_benefit => null,
      target_previous_code => null
    );
    raise exception 'percent over 100 should be rejected';
  exception
    when check_violation then null;
  end;
end;
$$;

-- 비스태프는 어드민 upsert를 부를 수 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);
do $$
begin
  begin
    perform public.admin_upsert_coupon(
      target_code => 'CPNHACK',
      target_name => '탈취 시도',
      target_discount_type => 'fixed',
      target_discount_value => 1000,
      target_max_discount_amount => null,
      target_min_subtotal => 0,
      target_starts_at => now(),
      target_ends_at => null,
      target_issue_limit => null,
      target_status => 'active',
      target_grade_benefit => null,
      target_previous_code => null
    );
    raise exception 'non-staff upsert should be rejected';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- ── 발급·카트 적용 (u701) ───────────────────────────────────────────────────

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);
set local role authenticated;

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000701', 'cpn-g1', 1);

-- 코드 직접 입력: 발급과 카트 적용이 한 번에 이뤄진다. 소문자·공백은 정규화된다.
select public.apply_cart_coupon_code('  cpnfix5k ') as fix5k_user_coupon_id \gset

select 1 / case when (
  select status = 'active' and coupon_code = 'CPNFIX5K'
  from public.user_coupons
  where id = :'fix5k_user_coupon_id'::uuid
    and user_id = '00000000-0000-4000-8000-000000000701'
) then 1 else 0 end as assert_code_entry_issues_active_coupon;

select 1 / case when (
  select user_coupon_id = :'fix5k_user_coupon_id'::uuid
  from public.cart_coupon_selections
  where user_id = '00000000-0000-4000-8000-000000000701'
) then 1 else 0 end as assert_code_entry_applies_to_cart;

-- 이미 보유한 코드 재입력은 멱등 적용이다(재발급 아님).
select public.apply_cart_coupon_code('CPNFIX5K') as fix5k_reapplied_id \gset
select 1 / case when :'fix5k_reapplied_id'::uuid = :'fix5k_user_coupon_id'::uuid then 1 else 0 end
  as assert_reentry_is_idempotent;
select 1 / case when (
  select count(*) from public.user_coupons
  where user_id = '00000000-0000-4000-8000-000000000701' and coupon_code = 'CPNFIX5K'
) = 1 then 1 else 0 end as assert_reentry_does_not_duplicate;

-- 발급 거부 사유가 구분된다.
do $$
begin
  begin
    perform public.apply_cart_coupon_code('CPNEXP');
    raise exception 'expired coupon should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'coupon_expired' then raise; end if;
  end;
  begin
    perform public.apply_cart_coupon_code('CPNSOON');
    raise exception 'not started coupon should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'coupon_not_started' then raise; end if;
  end;
  begin
    perform public.apply_cart_coupon_code('CPNARCH');
    raise exception 'archived coupon should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'coupon_not_found' then raise; end if;
  end;
  begin
    perform public.apply_cart_coupon_code('CPNNOPE');
    raise exception 'unknown coupon should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'coupon_not_found' then raise; end if;
  end;
end;
$$;

-- 최소 주문 금액 미달은 적용 단계에서 거부된다(카트 소계 30,000 < 50,000).
do $$
begin
  begin
    perform public.apply_cart_coupon_code('CPNPCT10');
    raise exception 'min subtotal violation should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'coupon_min_subtotal' then raise; end if;
  end;
end;
$$;

-- 남의 보유 쿠폰은 적용할 수 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000702', 'cpn-g1', 1);
do $$
declare
  v_other uuid;
begin
  select id into v_other from public.user_coupons
  where user_id = '00000000-0000-4000-8000-000000000701' and coupon_code = 'CPNFIX5K';
  begin
    perform public.apply_cart_coupon(v_other);
    raise exception 'foreign coupon should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'coupon_not_owned' then raise; end if;
  end;
end;
$$;

-- 발급 한도: 마지막 1장을 u702가 가져가면 u701은 소진 거부를 받는다.
select public.apply_cart_coupon_code('CPNONE') as one_second_id \gset
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);
do $$
begin
  begin
    perform public.apply_cart_coupon_code('CPNONE');
    raise exception 'exhausted coupon should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'coupon_exhausted' then raise; end if;
  end;
end;
$$;

-- u702 카트 정리(뒤의 쿠폰 없는 회귀 주문을 위해 selection 해제).
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);
select public.clear_cart_coupon();
select 1 / case when not exists (
  select 1 from public.cart_coupon_selections
  where user_id = '00000000-0000-4000-8000-000000000702'
) then 1 else 0 end as assert_clear_cart_coupon;

-- ── RLS 격리 ────────────────────────────────────────────────────────────────

-- u702에게는 자기 보유 쿠폰과 그 정의만 보인다.
select 1 / case when (
  select count(*) from public.user_coupons
) = 1 then 1 else 0 end as assert_user_coupons_rls_scoped;
select 1 / case when not exists (
  select 1 from public.coupons where code = 'CPNFIX5K'
) then 1 else 0 end as assert_coupon_definitions_hidden_unless_held;
select 1 / case when exists (
  select 1 from public.coupons where code = 'CPNONE'
) then 1 else 0 end as assert_held_coupon_definition_visible;

-- ── 주문 통합: 쿠폰 없는 회귀 (u702) ────────────────────────────────────────

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);

select public.place_order(
  '00000000-0000-4000-8000-000000000702',
  '{"recipientName":"쿠폰없음","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
  '10000000-0000-4000-8000-000000000702',
  'card'::public.order_payment_method
) as plain_order_id \gset

reset role;

select 1 / case when (
  select total = 33000 and shipping_fee = 3000 and discount_total = 0
  from public.orders
  where id = :'plain_order_id'::uuid
) then 1 else 0 end as assert_couponless_order_amount_unchanged;

select 1 / case when not exists (
  select 1 from public.coupon_redemptions where order_id = :'plain_order_id'::uuid
) then 1 else 0 end as assert_couponless_order_has_no_redemption;

-- ── 주문 통합: 정액 쿠폰 (u701, 소계 30,000 − 5,000 + 배송비 3,000) ─────────

set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);

select public.place_order(
  '00000000-0000-4000-8000-000000000701',
  '{"recipientName":"쿠폰사용","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
  '10000000-0000-4000-8000-000000000701',
  'card'::public.order_payment_method
) as fix5k_order_id \gset

reset role;

select 1 / case when (
  select total = 28000 and shipping_fee = 3000 and discount_total = 5000
  from public.orders
  where id = :'fix5k_order_id'::uuid
) then 1 else 0 end as assert_fixed_discount_snapshot;

select 1 / case when (
  select status = 'applied' and discount_amount = 5000
    and user_coupon_id = :'fix5k_user_coupon_id'::uuid
    and user_id = '00000000-0000-4000-8000-000000000701'
  from public.coupon_redemptions
  where order_id = :'fix5k_order_id'::uuid
) then 1 else 0 end as assert_redemption_ledger_written;

select 1 / case when (
  select status = 'used' and used_order_id = :'fix5k_order_id'::uuid and used_at is not null
  from public.user_coupons
  where id = :'fix5k_user_coupon_id'::uuid
) then 1 else 0 end as assert_user_coupon_marked_used;

select 1 / case when not exists (
  select 1 from public.cart_coupon_selections
  where user_id = '00000000-0000-4000-8000-000000000701'
) then 1 else 0 end as assert_selection_consumed;

-- 멱등 replay: 같은 checkout key 재호출은 같은 주문을 반환하고 원장을 늘리지 않는다.
set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);
select public.place_order(
  '00000000-0000-4000-8000-000000000701',
  '{"recipientName":"쿠폰사용","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
  '10000000-0000-4000-8000-000000000701',
  'card'::public.order_payment_method
) as fix5k_retry_id \gset

reset role;

select 1 / case when :'fix5k_retry_id'::uuid = :'fix5k_order_id'::uuid then 1 else 0 end
  as assert_replay_returns_same_order;
select 1 / case when (
  select count(*) from public.coupon_redemptions
  where order_id = :'fix5k_order_id'::uuid
) = 1 then 1 else 0 end as assert_replay_does_not_duplicate_redemption;

-- ── 취소 복구: redemption released, 쿠폰 재사용 가능 ────────────────────────

set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);
select public.cancel_order(:'fix5k_order_id'::uuid, '쿠폰 복구 스모크');

reset role;

select 1 / case when (
  select status = 'released' and released_at is not null
  from public.coupon_redemptions
  where order_id = :'fix5k_order_id'::uuid
) then 1 else 0 end as assert_cancel_releases_redemption;

select 1 / case when (
  select status = 'active' and used_at is null and used_order_id is null
  from public.user_coupons
  where id = :'fix5k_user_coupon_id'::uuid
) then 1 else 0 end as assert_cancel_restores_user_coupon;

-- 복구된 쿠폰은 새 주문에 다시 쓸 수 있고, 원장은 주문별로 분리된다.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);
set local role authenticated;

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000701', 'cpn-g1', 1);
select public.apply_cart_coupon(:'fix5k_user_coupon_id'::uuid);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);

select public.place_order(
  '00000000-0000-4000-8000-000000000701',
  '{"recipientName":"쿠폰재사용","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
  '10000000-0000-4000-8000-000000000711',
  'card'::public.order_payment_method
) as fix5k_second_order_id \gset

reset role;

select 1 / case when (
  select total = 28000 and discount_total = 5000
  from public.orders
  where id = :'fix5k_second_order_id'::uuid
) then 1 else 0 end as assert_released_coupon_reusable;

select 1 / case when (
  select count(*) from public.coupon_redemptions
  where user_coupon_id = :'fix5k_user_coupon_id'::uuid
) = 2 then 1 else 0 end as assert_ledger_keeps_released_history;

-- 사용된 쿠폰은 다시 적용할 수 없다.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);
set local role authenticated;
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000701', 'cpn-g1', 1);
do $$
declare
  v_used uuid;
begin
  select id into v_used from public.user_coupons
  where user_id = '00000000-0000-4000-8000-000000000701' and coupon_code = 'CPNFIX5K';
  begin
    perform public.apply_cart_coupon(v_used);
    raise exception 'used coupon should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'coupon_already_used' then raise; end if;
  end;
end;
$$;

-- ── 정률·상한·클램프·무료배송 상호작용 ──────────────────────────────────────

-- 소계 70,000(무료배송 유지): 10% = 7,000 ≤ 상한 8,000.
delete from public.cart_items where user_id = '00000000-0000-4000-8000-000000000701';
insert into public.cart_items (user_id, good_id, qty)
values
  ('00000000-0000-4000-8000-000000000701', 'cpn-g1', 1),
  ('00000000-0000-4000-8000-000000000701', 'cpn-g2', 1);
select public.apply_cart_coupon_code('CPNPCT10') as pct10_user_coupon_id \gset

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);

select public.place_order(
  '00000000-0000-4000-8000-000000000701',
  '{"recipientName":"정률쿠폰","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
  '10000000-0000-4000-8000-000000000712',
  'card'::public.order_payment_method
) as pct10_order_id \gset

-- 결제 준비 금액은 할인 후 총액과 일치한다(스냅샷 계약이 할인을 인지한다).
select (public.prepare_goods_payment_attempt(
  '00000000-0000-4000-8000-000000000701'::uuid,
  :'pct10_order_id'::uuid,
  'korpay'::public.payment_provider
) ->> 'amount')::bigint as pct10_attempt_amount \gset

reset role;

select 1 / case when :'pct10_attempt_amount'::bigint = 63000 then 1 else 0 end
  as assert_payment_attempt_uses_discounted_total;

-- 배송비 판정은 할인 전 소계(70,000) 기준이라 무료배송이 유지된다.
select 1 / case when (
  select total = 63000 and shipping_fee = 0 and discount_total = 7000
  from public.orders
  where id = :'pct10_order_id'::uuid
) then 1 else 0 end as assert_percent_discount_and_free_shipping_by_presale_subtotal;

-- 소계 90,000: 10% = 9,000 → 상한 8,000으로 잘린다.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);
set local role authenticated;
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000702', 'cpn-g3', 1);
select public.apply_cart_coupon_code('CPNPCT10');

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);

select public.place_order(
  '00000000-0000-4000-8000-000000000702',
  '{"recipientName":"상한쿠폰","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
  '10000000-0000-4000-8000-000000000713',
  'card'::public.order_payment_method
) as capped_order_id \gset

reset role;

select 1 / case when (
  select total = 82000 and shipping_fee = 0 and discount_total = 8000
  from public.orders
  where id = :'capped_order_id'::uuid
) then 1 else 0 end as assert_percent_discount_capped;

-- 정액 할인은 소계를 넘지 못한다(50,000 쿠폰, 소계 30,000 → 할인 30,000).
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);
set local role authenticated;
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000702', 'cpn-g1', 1);
select public.apply_cart_coupon_code('CPNBIG');

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);

select public.place_order(
  '00000000-0000-4000-8000-000000000702',
  '{"recipientName":"클램프","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
  '10000000-0000-4000-8000-000000000714',
  'card'::public.order_payment_method
) as clamped_order_id \gset

reset role;

select 1 / case when (
  select total = 3000 and shipping_fee = 3000 and discount_total = 30000
  from public.orders
  where id = :'clamped_order_id'::uuid
) then 1 else 0 end as assert_fixed_discount_clamped_to_subtotal;

-- ── 카트가 줄어 조건 미달이 된 selection은 주문 생성에서 거부된다 ────────────

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);
set local role authenticated;
-- 소계 70,000에서 CPNMIN50(min 50,000)을 적용해 두고, 카트를 30,000으로 줄인다.
insert into public.cart_items (user_id, good_id, qty)
values
  ('00000000-0000-4000-8000-000000000701', 'cpn-g1', 1),
  ('00000000-0000-4000-8000-000000000701', 'cpn-g2', 1);
select public.apply_cart_coupon_code('CPNMIN50') as min50_user_coupon_id \gset
delete from public.cart_items
where user_id = '00000000-0000-4000-8000-000000000701' and good_id = 'cpn-g2';

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);

do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000701',
      '{"recipientName":"조건미달","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
      '10000000-0000-4000-8000-000000000715',
      'card'::public.order_payment_method
    );
    raise exception 'stale selection below min subtotal should reject order';
  exception
    when check_violation then
      if sqlerrm <> 'coupon_min_subtotal' then raise; end if;
  end;
end;
$$;

-- 거부된 주문은 재고·카트·쿠폰 어느 것도 소비하지 않는다.
reset role;
select 1 / case when (
  select status = 'active' from public.user_coupons where id = :'min50_user_coupon_id'::uuid
) then 1 else 0 end as assert_rejected_order_leaves_coupon_active;
select 1 / case when (
  select count(*) from public.cart_items
  where user_id = '00000000-0000-4000-8000-000000000701'
) = 1 then 1 else 0 end as assert_rejected_order_leaves_cart;

rollback;
