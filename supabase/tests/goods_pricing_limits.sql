\set ON_ERROR_STOP on

-- 현업 요청 슬라이스 1 — 할인 · KC 인증 · 구매 수량 상한 · 성인 전용

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000009a1', 'authenticated', 'authenticated', 'price-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000009a2', 'authenticated', 'authenticated', 'price-minor@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000009a1', 'price-buyer@example.test', 'price_buyer', '1995-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-0000000009a2', 'price-minor@example.test', 'price_minor', '2010-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, role = excluded.role;

insert into public.verticals (key, label, color) values ('price-test', '가격 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('price-ip', '가격 테스트 IP', 'price-test') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('price-g1', 'price-ip', '할인 테스트 굿즈', '문구', 10000, 'ok', 50),
  ('price-g2', 'price-ip', '수량 상한 굿즈', '키링', 3000, 'ok', 50),
  ('price-g3', 'price-ip', '성인 전용 굿즈', '문구', 5000, 'ok', 50)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A. 할인은 저장하지 않고 파생한다
-- ---------------------------------------------------------------------------
select 1 / case when (
  select public.good_effective_price(good) = 10000 and public.good_discount_rate(good) = 0
  from public.goods as good where good.id = 'price-g1'
) then 1 else 0 end as assert_no_discount_keeps_price;

update public.goods set discount_kind = 'percent', discount_value = 20 where id = 'price-g1';
select 1 / case when (
  select public.good_effective_price(good) = 8000 and public.good_discount_rate(good) = 20
  from public.goods as good where good.id = 'price-g1'
) then 1 else 0 end as assert_percent_discount;

-- 할인율 노출을 끄면 값은 깎이되 표시용 비율은 0이다.
update public.goods set discount_shows_rate = false where id = 'price-g1';
select 1 / case when (
  select public.good_effective_price(good) = 8000 and public.good_discount_rate(good) = 0
  from public.goods as good where good.id = 'price-g1'
) then 1 else 0 end as assert_hidden_rate_still_discounts;
update public.goods set discount_shows_rate = true where id = 'price-g1';

-- 기간 밖이면 원가다. 배치가 아니라 조회 시 판정이라 초 단위로 정확하다.
update public.goods set discount_starts_at = now() + interval '1 day' where id = 'price-g1';
select 1 / case when (
  select public.good_effective_price(good) = 10000
  from public.goods as good where good.id = 'price-g1'
) then 1 else 0 end as assert_discount_before_window;

update public.goods set discount_starts_at = null, discount_ends_at = now() - interval '1 minute' where id = 'price-g1';
select 1 / case when (
  select public.good_effective_price(good) = 10000
  from public.goods as good where good.id = 'price-g1'
) then 1 else 0 end as assert_discount_after_window;

-- 정액 할인이 판매가를 넘어도 음수로 내려가지 않는다.
update public.goods
set discount_kind = 'amount', discount_value = 99999, discount_starts_at = null, discount_ends_at = null
where id = 'price-g1';
select 1 / case when (
  select public.good_effective_price(good) = 0
  from public.goods as good where good.id = 'price-g1'
) then 1 else 0 end as assert_discount_never_negative;

-- ---------------------------------------------------------------------------
-- B. 표시가와 청구가가 같은 함수를 본다
-- ---------------------------------------------------------------------------
update public.goods set discount_kind = 'percent', discount_value = 30 where id = 'price-g1';

select 1 / case when (
  select effective_price = 7000 from public.goods_storefront where id = 'price-g1'
) then 1 else 0 end as assert_storefront_shows_discounted_price;

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-0000000009a1', 'price-g1', 2);

select public.place_order(
  '00000000-0000-4000-8000-0000000009a1'::uuid,
  '{"recipientName":"홍길동","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1","address2":"101동"}'::jsonb,
  '00000000-0000-4000-8000-0000000009f1'::uuid
) as discounted_order \gset

-- 화면이 7,000원이라고 했으면 주문도 7,000원으로 잡혀야 한다. 여기가 갈리면 돈 사고다.
select 1 / case when (
  select unit_price = 7000 from public.order_items where order_id = :'discounted_order'::uuid
) then 1 else 0 end as assert_order_charges_the_shown_price;

-- ---------------------------------------------------------------------------
-- C. 구매 수량 상한 — 문은 하나
-- ---------------------------------------------------------------------------
update public.goods set min_order_qty = 2, max_order_qty = 5, max_qty_per_account = 6 where id = 'price-g2';

select 1 / case when (
  public.good_purchase_block_reason('price-g2', 1) = 'below_min_order_qty'
  and public.good_purchase_block_reason('price-g2', 6) = 'above_max_order_qty'
  and public.good_purchase_block_reason('price-g2', 3) is null
) then 1 else 0 end as assert_per_order_quantity_bounds;

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-0000000009a1', 'price-g2', 5);
select public.place_order(
  '00000000-0000-4000-8000-0000000009a1'::uuid,
  '{"recipientName":"홍길동","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1","address2":"101동"}'::jsonb,
  '00000000-0000-4000-8000-0000000009f2'::uuid
) as limit_order \gset

-- 5개를 샀으니 계정 상한 6에서 2개를 더 사면 넘는다.
select 1 / case when (
  public.good_purchase_block_reason('price-g2', 2, '00000000-0000-4000-8000-0000000009a1') = 'above_account_limit'
  and public.good_purchase_block_reason('price-g2', 2, '00000000-0000-4000-8000-0000000009a2') is null
) then 1 else 0 end as assert_account_limit_counts_past_orders;

-- 취소한 만큼은 다시 살 수 있다 — 취소분까지 세면 취소한 사람이 손해를 본다.
update public.order_items set qty_canceled = 5 where order_id = :'limit_order'::uuid;
select 1 / case when (
  public.good_purchase_block_reason('price-g2', 2, '00000000-0000-4000-8000-0000000009a1') is null
) then 1 else 0 end as assert_account_limit_excludes_canceled;

-- 주문 시점에도 다시 본다. 카트에 담긴 뒤 상한이 바뀌었을 수 있다.
update public.goods set min_order_qty = 1, max_order_qty = 1 where id = 'price-g2';
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-0000000009a1', 'price-g2', 4);
do $$
begin
  perform public.place_order(
    '00000000-0000-4000-8000-0000000009a1'::uuid,
    '{"recipientName":"홍길동","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1","address2":"101동"}'::jsonb,
    '00000000-0000-4000-8000-0000000009f3'::uuid
  );
  raise exception 'expected the order to be blocked by the quantity limit';
exception when check_violation then null;
end;
$$;
delete from public.cart_items where user_id = '00000000-0000-4000-8000-0000000009a1';

-- ---------------------------------------------------------------------------
-- D. 성인 전용 — 모르는 것을 통과시키지 않는다
-- ---------------------------------------------------------------------------
update public.goods set adult_only = true where id = 'price-g3';

select 1 / case when (
  public.good_purchase_block_reason('price-g3', 1) = 'adult_only'
  and public.good_purchase_block_reason('price-g3', 1, '00000000-0000-4000-8000-0000000009a2') = 'adult_only'
  and public.good_purchase_block_reason('price-g3', 1, '00000000-0000-4000-8000-0000000009a1') is null
) then 1 else 0 end as assert_adult_only_gate;

update public.profiles set birth_date = null where id = '00000000-0000-4000-8000-0000000009a1';
select 1 / case when (
  public.good_purchase_block_reason('price-g3', 1, '00000000-0000-4000-8000-0000000009a1')
    = 'adult_verification_required'
) then 1 else 0 end as assert_missing_birth_date_blocks;
update public.profiles set birth_date = '1995-01-01' where id = '00000000-0000-4000-8000-0000000009a1';

-- ---------------------------------------------------------------------------
-- E. 표기 제약 — 「없음」과 「미확인」을 나누고, 번호 없는 인증은 못 적는다
-- ---------------------------------------------------------------------------
select 1 / case when (
  select kc_status = 'unknown' from public.goods where id = 'price-g1'
) then 1 else 0 end as assert_kc_defaults_to_unknown;

do $$
begin
  begin
    update public.goods set kc_status = 'certified', kc_number = null where id = 'price-g1';
    raise exception 'expected certified without a number to be rejected';
  exception when check_violation then null;
  end;

  begin
    update public.goods set discount_kind = 'percent', discount_value = 150 where id = 'price-g1';
    raise exception 'expected a percent discount above 100 to be rejected';
  exception when check_violation then null;
  end;

  begin
    update public.goods set min_order_qty = 5, max_order_qty = 2 where id = 'price-g2';
    raise exception 'expected max below min to be rejected';
  exception when check_violation then null;
  end;

  begin
    update public.goods set discount_starts_at = now(), discount_ends_at = now() - interval '1 day' where id = 'price-g1';
    raise exception 'expected an inverted discount window to be rejected';
  exception when check_violation then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- E-2. 어드민 RPC 를 실제로 부른다 — 권한만 확인하면 런타임 실패를 못 잡는다
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000009a3', 'authenticated', 'authenticated', 'price-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values ('00000000-0000-4000-8000-0000000009a3', 'price-staff@example.test', 'price_staff', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff')
on conflict (id) do update set role = 'staff';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009a3', true);

select 1 / case when (
  (public.admin_set_good_discount('price-g1', 'percent', 15, null, null, true, gen_random_uuid())).discount_value = 15
  and (public.admin_set_good_compliance('price-g1', 'certified', '안전확인', 'XU-1', '아이콘스', true, '880123', gen_random_uuid())).kc_status = 'certified'
  and (public.admin_set_good_purchase_limits('price-g1', 2, 4, 8, gen_random_uuid())).max_order_qty = 4
) then 1 else 0 end as assert_admin_rpcs_actually_run;
reset role;

-- ---------------------------------------------------------------------------
-- F. 권한 — 어드민 RPC 는 staff 만, 판정 함수는 anon 에게 주지 않는다
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_set_good_discount(text,text,integer,timestamptz,timestamptz,boolean,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_set_good_discount(text,text,integer,timestamptz,timestamptz,boolean,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_set_good_compliance(text,text,text,text,text,boolean,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_set_good_purchase_limits(text,integer,integer,integer,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.good_purchase_block_reason(text,integer,uuid)', 'execute')
  and has_function_privilege('anon', 'public.good_effective_price(public.goods,timestamptz)', 'execute')
) then 1 else 0 end as assert_pricing_acl;

rollback;
