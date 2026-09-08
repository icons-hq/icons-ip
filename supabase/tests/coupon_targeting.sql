\set ON_ERROR_STOP on

-- 현업 요청 슬라이스 4 — 쿠폰 조회 · 고객 타겟팅

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000009c1', 'authenticated', 'authenticated', 'cpn-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000009c2', 'authenticated', 'authenticated', 'cpn-new@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000009c3', 'authenticated', 'authenticated', 'cpn-repeat@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000009c1', 'cpn-staff@example.test', 'cpn_staff', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-0000000009c2', 'cpn-new@example.test', 'cpn_new', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-0000000009c3', 'cpn-repeat@example.test', 'cpn_repeat', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do update set role = excluded.role;

insert into public.verticals (key, label, color) values ('cpn', '쿠폰 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('cpn-ip', '쿠폰 테스트 IP', 'cpn') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('cpn-g1', 'cpn-ip', '쿠폰 테스트 굿즈', '문구', 10000, 'ok', 50)
on conflict (id) do nothing;

insert into public.coupons (code, name, discount_type, discount_value, target_kind)
values
  ('CPNALL', '누구나', 'fixed', 1000, 'all'),
  ('CPNFIRST', '첫 구매', 'fixed', 1000, 'first_purchase'),
  ('CPNAGAIN', '재구매', 'fixed', 1000, 'repeat_purchase')
on conflict (code) do nothing;
insert into public.coupons (code, name, discount_type, discount_value, target_kind, target_good_id)
values ('CPNGOOD', '이 상품 산 사람', 'fixed', 1000, 'bought_good', 'cpn-g1')
on conflict (code) do nothing;

-- 재구매 사용자에게 결제까지 간 주문을 하나 만든다.
insert into public.orders (id, user_id, status, total, address)
values ('00000000-0000-4000-8000-0000000009d0', '00000000-0000-4000-8000-0000000009c3', 'paid', 10000, '{}'::jsonb);
insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
values ('00000000-0000-4000-8000-0000000009d0', 'cpn-g1', 1, 10000, '쿠폰 테스트 굿즈', '문구', 'cpn-ip');

-- ---------------------------------------------------------------------------
-- A. 발급 자격
-- ---------------------------------------------------------------------------
select 1 / case when (
  public.coupon_issue_block_reason('CPNALL', '00000000-0000-4000-8000-0000000009c2') is null
  and public.coupon_issue_block_reason('CPNALL', null) is null
) then 1 else 0 end as assert_open_coupon_has_no_target_gate;

select 1 / case when (
  public.coupon_issue_block_reason('CPNFIRST', '00000000-0000-4000-8000-0000000009c2') is null
  and public.coupon_issue_block_reason('CPNFIRST', '00000000-0000-4000-8000-0000000009c3') = 'coupon_target_mismatch'
) then 1 else 0 end as assert_first_purchase_excludes_buyers;

select 1 / case when (
  public.coupon_issue_block_reason('CPNAGAIN', '00000000-0000-4000-8000-0000000009c3') is null
  and public.coupon_issue_block_reason('CPNAGAIN', '00000000-0000-4000-8000-0000000009c2') = 'coupon_target_mismatch'
) then 1 else 0 end as assert_repeat_purchase_needs_a_paid_order;

select 1 / case when (
  public.coupon_issue_block_reason('CPNGOOD', '00000000-0000-4000-8000-0000000009c3') is null
  and public.coupon_issue_block_reason('CPNGOOD', '00000000-0000-4000-8000-0000000009c2') = 'coupon_target_mismatch'
) then 1 else 0 end as assert_bought_good_target;

-- 취소된 주문은 「구매」로 세지 않는다. 취소한 사람이 재구매 쿠폰을 받으면 조건이 무의미하다.
update public.orders set status = 'canceled' where id = '00000000-0000-4000-8000-0000000009d0';
select 1 / case when (
  public.coupon_issue_block_reason('CPNAGAIN', '00000000-0000-4000-8000-0000000009c3') = 'coupon_target_mismatch'
  and public.coupon_issue_block_reason('CPNFIRST', '00000000-0000-4000-8000-0000000009c3') is null
) then 1 else 0 end as assert_canceled_orders_do_not_count;
update public.orders set status = 'paid' where id = '00000000-0000-4000-8000-0000000009d0';

-- ---------------------------------------------------------------------------
-- B. 발급 시점에 한 번 — 받은 쿠폰은 조건이 바뀌어도 살아 있다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009c2', true);

-- 아직 산 적 없는 사람은 첫 구매 쿠폰을 받는다.
select public.apply_cart_coupon_code('CPNFIRST') as claimed \gset

-- 자격이 없으면 발급 자체가 막힌다.
do $$
begin
  perform public.apply_cart_coupon_code('CPNAGAIN');
  raise exception 'expected the repeat-purchase coupon to be blocked';
exception when check_violation then
  if sqlerrm <> 'coupon_target_mismatch' then raise; end if;
end;
$$;
reset role;

-- 그 사람이 이제 구매자가 돼도 **이미 받은** 첫 구매 쿠폰은 남는다.
insert into public.orders (id, user_id, status, total, address)
values ('00000000-0000-4000-8000-0000000009d1', '00000000-0000-4000-8000-0000000009c2', 'paid', 10000, '{}'::jsonb);

select 1 / case when (
  (select count(*) from public.user_coupons
   where user_id = '00000000-0000-4000-8000-0000000009c2' and coupon_code = 'CPNFIRST') = 1
  and public.coupon_issue_block_reason('CPNFIRST', '00000000-0000-4000-8000-0000000009c2') = 'coupon_target_mismatch'
) then 1 else 0 end as assert_issued_coupon_survives_losing_eligibility;

-- ---------------------------------------------------------------------------
-- C. 제약 — 「이 상품 산 사람」인데 상품이 없으면 아무도 못 받는다
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.coupons (code, name, discount_type, discount_value, target_kind)
    values ('CPNBAD', '상품 없는 타겟', 'fixed', 1000, 'bought_good');
    raise exception 'expected bought_good without a good to be rejected';
  exception when check_violation then null;
  end;

  begin
    insert into public.coupons (code, name, discount_type, discount_value, target_kind, target_good_id)
    values ('CPNBAD2', '엉뚱한 상품', 'fixed', 1000, 'all', 'cpn-g1');
    raise exception 'expected a target good without bought_good to be rejected';
  exception when check_violation then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- D. 어드민 조회
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009c1', true);

select 1 / case when (
  (select count(*) from public.admin_search_coupons(p_query => 'CPNFIRST')) = 1
  and (select target_kind from public.admin_search_coupons(p_query => 'CPNFIRST')) = 'first_purchase'
  and (select issued_count from public.admin_search_coupons(p_query => 'CPNFIRST')) = 1
) then 1 else 0 end as assert_admin_search_finds_by_code;

select 1 / case when (
  (select count(*) from public.admin_search_coupons(p_target_kind => 'repeat_purchase')) = 1
  and (select count(*) from public.admin_search_coupons(p_status => 'archived')) = 0
) then 1 else 0 end as assert_admin_search_filters;

-- 기간은 **겹치는** 쿠폰을 찾는다 — 「이 기간에 시작한 것」만 보면 이미 돌고 있는 쿠폰이 빠진다.
select 1 / case when (
  (select count(*) from public.admin_search_coupons(
    p_query => 'CPNALL', p_from => now() + interval '1 day', p_to => now() + interval '2 day'
  )) = 1
) then 1 else 0 end as assert_admin_search_window_overlaps;

-- 어드민 저장이 타겟을 실제로 넣는다.
select public.admin_upsert_coupon(
  'CPNNEW', '새 타겟 쿠폰', 'fixed', 2000, null, 0, now(), null, null, 'active', null, null,
  'bought_good', 'cpn-g1'
);
select 1 / case when (
  select target_kind = 'bought_good' and target_good_id = 'cpn-g1'
  from public.coupons where code = 'CPNNEW'
) then 1 else 0 end as assert_admin_upsert_saves_target;
reset role;

-- ---------------------------------------------------------------------------
-- E. 권한
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_search_coupons(text,text,text,timestamptz,timestamptz,integer,integer)', 'execute')
  and not has_function_privilege('anon', 'public.admin_search_coupons(text,text,text,timestamptz,timestamptz,integer,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_search_coupons(text,text,text,timestamptz,timestamptz,integer,integer)', 'execute')
  and not has_function_privilege('anon', 'public.coupon_issue_block_reason(text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.coupon_issue_block_reason(text,uuid)', 'execute')
) then 1 else 0 end as assert_coupon_targeting_acl;

rollback;
