\set ON_ERROR_STOP on

begin;

-- 고객 주문내역 품목 줄 표시값(MD-0036 수정 라운드 F1): my_order_item_display.
-- my_order_items와 같은 줄에 정가(v2)·복수구매 단가 할인·부분 취소 뒤 남은 수량을 붙이고, 본인 주문만 돌려주며,
-- 랜덤 판매 배정 행은 합친 줄 기준으로 계산하고, anon·service_role은 부를 수 없다.

-- 권한 표면: authenticated만 실행하고 PUBLIC·anon·service_role은 막힌다. 보안 정의자·stable·빈 search_path.
select 1 / case when (
  has_function_privilege('authenticated', 'public.my_order_item_display(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.my_order_item_display(uuid[])', 'execute')
  and not has_function_privilege('service_role', 'public.my_order_item_display(uuid[])', 'execute')
  and not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(procedure.proacl) as privilege
    where procedure.oid = 'public.my_order_item_display(uuid[])'::regprocedure
      and privilege.grantee = 0
  )
) then 1 else 0 end as assert_display_rpc_is_authenticated_only;

select 1 / case when (
  select procedure.prosecdef
    and procedure.provolatile = 's'
    and procedure.proconfig = array['search_path=""']
  from pg_catalog.pg_proc as procedure
  where procedure.oid = 'public.my_order_item_display(uuid[])'::regprocedure
) then 1 else 0 end as assert_display_rpc_is_stable_definer_with_empty_search_path;

-- 픽스처 --------------------------------------------------------------------------------------------------
-- 회원 A(주문자)·B(다른 회원). 굿즈 셋: a(선택)·b(선택)·c(랜덤 판매).
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000002201', 'authenticated', 'authenticated', 'item-display-owner@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000002202', 'authenticated', 'authenticated', 'item-display-other@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values
  ('00000000-0000-4000-8000-000000002201', 'item-display-owner@example.test', 'item_display_owner', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now()),
  ('00000000-0000-4000-8000-000000002202', 'item-display-other@example.test', 'item_display_other', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now())
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, suspended_at = null, suspension_reason = null;

insert into public.fulfillment_origins (id, code, name, default_carrier, base_fee, return_address, is_active)
values ('00000000-0000-4000-8000-000000002210', 'item-display-origin', 'TEST 표시값 출고지', 'hanjin', 3000, 'TEST 반품 주소', true);
insert into public.ips (id, title, vertical_key) values ('item-display-ip', 'TEST 표시값 IP', 'character');
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, origin_id) values
  ('item-display-a', 'item-display-ip', 'TEST 표시값 굿즈 A', '문구', 10000, 'ok', 50, '00000000-0000-4000-8000-000000002210'),
  ('item-display-b', 'item-display-ip', 'TEST 표시값 굿즈 B', '문구', 5000, 'ok', 50, '00000000-0000-4000-8000-000000002210'),
  ('item-display-c', 'item-display-ip', 'TEST 표시값 랜덤 굿즈 C', '문구', 9000, 'ok', 50, '00000000-0000-4000-8000-000000002210');
-- 랜덤 판매 굿즈의 옵션 셋(배정 행이 서로 다른 옵션을 가리킨다). 랜덤 조건 검증은 커밋에서 도는 지연 제약이라 이 시험은 되돌리므로 닿지 않는다.
insert into public.goods_variants (id, good_id, name, price, code) values
  ('00000000-0000-4000-8000-000000002221', 'item-display-c', 'TEST 옵션 X', 9000, 'ITEM-DISPLAY-C-X'),
  ('00000000-0000-4000-8000-000000002222', 'item-display-c', 'TEST 옵션 Y', 9000, 'ITEM-DISPLAY-C-Y'),
  ('00000000-0000-4000-8000-000000002223', 'item-display-c', 'TEST 옵션 Z', 9000, 'ITEM-DISPLAY-C-Z');
update public.goods set option_sale_mode = 'random' where id = 'item-display-c';

-- 주문(번호 끝자리 = 시나리오)
--   2231 v2: 굿즈 A 3개(8,000원·정가 10,000원·복수구매 단가 할인 1,000원)에서 1개 부분 취소 + 굿즈 B 1개(5,000원) 전부 부분 취소
--   2232 v1: 굿즈 A 2개(30,000원, 정가 스냅숏 36,000원이 남아 있어도 v1은 정가를 내지 않는다)
--   2233 v2, 다른 회원 B의 주문
--   2234 v2 랜덤: 굿즈 C 배정 행 셋(2개·1개·1개, 모두 7,000원·정가 9,000원·복수구매 500원), 배정 행 하나(1개)를 부분 취소
--   2235 v2 랜덤: 굿즈 C 배정 행 둘의 정가가 서로 다르다(정가·복수구매 할인을 내지 않는다)
insert into public.orders (id, user_id, status, total, calculation_version) values
  ('20000000-0000-4000-8000-000000002231', '00000000-0000-4000-8000-000000002201', 'paid', 30000, 2),
  ('20000000-0000-4000-8000-000000002232', '00000000-0000-4000-8000-000000002201', 'paid', 60000, 1),
  ('20000000-0000-4000-8000-000000002233', '00000000-0000-4000-8000-000000002202', 'paid', 10000, 2),
  ('20000000-0000-4000-8000-000000002234', '00000000-0000-4000-8000-000000002201', 'paid', 26000, 2),
  ('20000000-0000-4000-8000-000000002235', '00000000-0000-4000-8000-000000002201', 'paid', 14000, 2);

-- v2 주문은 거래 영수증 원장이 있어야 품목을 넣을 수 있다.
insert into private.order_goods_transactions (order_id, actor_id, source_kind, source_id, source_revision, quote_id, checkout_key, request_digest, request_salt, original_receipt)
select o.id, o.user_id, 'cart', extensions.gen_random_uuid(), 'item-display-test', extensions.gen_random_uuid(), extensions.gen_random_uuid(),
       'item-display-digest', extensions.gen_random_uuid(), '{}'::jsonb
from public.orders o where o.id in (
  '20000000-0000-4000-8000-000000002231', '20000000-0000-4000-8000-000000002233',
  '20000000-0000-4000-8000-000000002234', '20000000-0000-4000-8000-000000002235');

create function pg_temp.fixture_item(
  item_no integer, order_no integer, good text, variant uuid, quantity integer, unit integer,
  regular integer, volume integer, random_row boolean default false
) returns void language plpgsql as $$
begin
  insert into public.order_items (
    id, order_id, good_id, variant_id, qty, unit_price, regular_unit_price_snapshot, volume_unit_discount, volume_discount_total,
    good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, option_sale_mode_snapshot)
  values (
    ('50000000-0000-4000-8000-00000000' || lpad(item_no::text, 4, '0'))::uuid,
    ('20000000-0000-4000-8000-00000000' || lpad(order_no::text, 4, '0'))::uuid,
    good, variant, quantity, unit, regular, volume, quantity::bigint * volume,
    'TEST ' || good, '문구', 'item-display-ip', case when random_row then 'random' end);
end $$;

select pg_temp.fixture_item(2301, 2231, 'item-display-a', (select id from public.goods_variants where good_id = 'item-display-a' and is_default), 3, 8000, 10000, 1000);
select pg_temp.fixture_item(2302, 2231, 'item-display-b', (select id from public.goods_variants where good_id = 'item-display-b' and is_default), 1, 5000, 5000, 0);
select pg_temp.fixture_item(2303, 2232, 'item-display-a', (select id from public.goods_variants where good_id = 'item-display-a' and is_default), 2, 30000, 36000, 0);
select pg_temp.fixture_item(2304, 2233, 'item-display-b', (select id from public.goods_variants where good_id = 'item-display-b' and is_default), 1, 10000, 10000, 0);
select pg_temp.fixture_item(2305, 2234, 'item-display-c', '00000000-0000-4000-8000-000000002221', 2, 7000, 9000, 500, true);
select pg_temp.fixture_item(2306, 2234, 'item-display-c', '00000000-0000-4000-8000-000000002222', 1, 7000, 9000, 500, true);
select pg_temp.fixture_item(2307, 2234, 'item-display-c', '00000000-0000-4000-8000-000000002223', 1, 7000, 9000, 500, true);
select pg_temp.fixture_item(2308, 2235, 'item-display-c', '00000000-0000-4000-8000-000000002221', 1, 7000, 9000, 500, true);
select pg_temp.fixture_item(2309, 2235, 'item-display-c', '00000000-0000-4000-8000-000000002222', 1, 7000, 9500, 500, true);

-- 부분 취소 원장(적용됨 = 무통장 송금 대기). 트랜잭션 안에서 직접 쌓아 읽기 도우미가 보는 모양만 만든다.
create function pg_temp.fixture_partial_cancel(order_no integer, item_no integer, quantity integer) returns void language plpgsql as $$
declare
  order_id uuid := ('20000000-0000-4000-8000-00000000' || lpad(order_no::text, 4, '0'))::uuid;
  payment_id uuid := ('30000000-0000-4000-8000-00000000' || lpad(order_no::text, 4, '0'))::uuid;
  head_id uuid := ('60000000-0000-4000-8000-00000000' || lpad(item_no::text, 4, '0'))::uuid;
  shipment_id uuid := ('70000000-0000-4000-8000-00000000' || lpad(order_no::text, 4, '0'))::uuid;
  item_id uuid := ('50000000-0000-4000-8000-00000000' || lpad(item_no::text, 4, '0'))::uuid;
begin
  insert into public.payments (id, user_id, purpose, ref_id, amount, status, payment_key, idempotency_key, provider)
  values (payment_id, '00000000-0000-4000-8000-000000002201', 'order', order_id, 10000, 'paid', 'bank_transfer:' || order_id, 'item-display-payment-' || order_no, 'bank_transfer')
  on conflict (id) do nothing;
  insert into public.order_shipments (id, order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot)
  values (shipment_id, order_id, '00000000-0000-4000-8000-000000002210', 'TEST 표시값 출고지', 0, '{}'::jsonb)
  on conflict (id) do nothing;
  insert into private.order_partial_cancellations (
    id, order_id, payment_id, provider, sequence, reason_code, customer_decision, warehouse_stop_confirmed, payment_amount, balance_before,
    goods_refund_amount, shipping_refund_amount, refund_amount, state, operation_id, created_by, applied_at, filed_at, filed_by)
  values (
    head_id, order_id, payment_id, 'bank_transfer', item_no, 'out_of_stock', 'TEST 고객 결정', true, 10000, 10000,
    1000, 0, 1000, 'awaiting_transfer', extensions.gen_random_uuid(), '00000000-0000-4000-8000-000000002201', clock_timestamp(), clock_timestamp(),
    '00000000-0000-4000-8000-000000002201');
  insert into private.order_partial_cancellation_items (
    partial_cancellation_id, order_id, order_item_id, shipment_id, qty, canceled_qty_before, gross_amount, volume_discount, coupon_discount,
    store_credit_discount, goods_refund_amount)
  values (head_id, order_id, item_id, shipment_id, quantity, 0, 1000, 0, 0, 0, 1000);
end $$;

select pg_temp.fixture_partial_cancel(2231, 2301, 1);
select pg_temp.fixture_partial_cancel(2231, 2302, 1);
select pg_temp.fixture_partial_cancel(2234, 2306, 1);

-- 호출자 전환: 현재 롤을 authenticated로 두고 회원을 갈아 끼운다.
create function pg_temp.act_as(actor text) returns void language plpgsql as $$
begin
  if actor is null then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', actor)::text, true);
  end if;
end $$;
grant execute on function pg_temp.act_as(text) to authenticated, anon;

-- 한 줄씩 값을 꺼내는 도우미(주문번호 끝자리·품목 번호).
create function pg_temp.display_of(item_no integer) returns text language sql stable as $$
  select concat_ws('|', coalesce(d.regular_unit_price::text, 'null'), coalesce(d.volume_unit_discount::text, 'null'), coalesce(d.active_qty::text, 'null'))
  from public.my_order_item_display(array[
    '20000000-0000-4000-8000-000000002231', '20000000-0000-4000-8000-000000002232', '20000000-0000-4000-8000-000000002233',
    '20000000-0000-4000-8000-000000002234', '20000000-0000-4000-8000-000000002235']::uuid[]) d
  where d.item_id = ('50000000-0000-4000-8000-00000000' || lpad(item_no::text, 4, '0'))::uuid;
$$;
grant execute on function pg_temp.display_of(integer) to authenticated;

create function pg_temp.row_count_for(order_nos integer[]) returns integer language sql stable as $$
  select count(*)::integer from public.my_order_item_display(
    (select array_agg(('20000000-0000-4000-8000-00000000' || lpad(n::text, 4, '0'))::uuid) from unnest(order_nos) n));
$$;
grant execute on function pg_temp.row_count_for(integer[]) to authenticated;

-- 1) 익명(로그인 없음)은 부를 수 없다.
set local role anon;
select pg_temp.act_as(null);
do $$ begin
  perform public.my_order_item_display(array['20000000-0000-4000-8000-000000002231']::uuid[]);
  raise exception 'anon must not call my_order_item_display';
exception when insufficient_privilege then null;
end $$;

-- 2) 로그인했어도 인증 정보(auth.uid)가 없으면 거절한다.
reset role;
set local role authenticated;
select pg_temp.act_as(null);
do $$ begin
  perform public.my_order_item_display(array['20000000-0000-4000-8000-000000002231']::uuid[]);
  raise exception 'missing auth uid must be rejected';
exception when insufficient_privilege then null;
end $$;

-- 3) 본인 주문: 정가·복수구매 단가 할인·남은 수량.
select pg_temp.act_as('00000000-0000-4000-8000-000000002201');

-- 부분 취소된 v2 품목: 3개 중 1개 취소 → 남은 2개, 정가 10,000원·복수구매 단가 할인 1,000원.
select 1 / case when pg_temp.display_of(2301) = '10000|1000|2' then 1 else 0 end as assert_partial_cancel_reduces_active_qty;
-- 전부 부분 취소된 품목: 남은 수량 0(줄은 남는다).
select 1 / case when pg_temp.display_of(2302) = '5000|0|0' then 1 else 0 end as assert_fully_canceled_item_has_zero_active_qty;
-- v1 주문은 정가 스냅숏이 있어도 정가 null·복수구매 할인 0.
select 1 / case when pg_temp.display_of(2303) = 'null|0|2' then 1 else 0 end as assert_v1_order_has_no_regular_price;

-- 4) 랜덤 판매: 같은 주문·굿즈의 배정 행은 합친 한 줄(가장 작은 행 id)로, 남은 수량은 배정 행의 합(4 − 1).
select 1 / case when pg_temp.row_count_for(array[2234]) = 1 then 1 else 0 end as assert_random_rows_merge_into_one_line;
select 1 / case when pg_temp.display_of(2305) = '9000|500|3' then 1 else 0 end as assert_random_line_sums_active_qty;
select 1 / case when pg_temp.display_of(2306) is null and pg_temp.display_of(2307) is null then 1 else 0 end as assert_random_member_rows_are_not_exposed;
-- 배정 행의 정가가 서로 다르면 정가·복수구매 할인을 내지 않는다(남은 수량은 합).
select 1 / case when pg_temp.row_count_for(array[2235]) = 1 and pg_temp.display_of(2308) = 'null|0|2' then 1 else 0 end as assert_random_mixed_prices_are_withheld;

-- 5) 본인 주문 줄만 나온다 — 다른 회원(B)의 주문 id를 섞어 넣어도 0행.
select 1 / case when pg_temp.row_count_for(array[2233]) = 0 and pg_temp.row_count_for(array[2231, 2233]) = 2 then 1 else 0 end as assert_other_members_orders_return_no_rows;
select 1 / case when pg_temp.display_of(2304) is null then 1 else 0 end as assert_other_members_item_is_hidden;

-- 6) 다른 회원(B)에게는 B의 주문만 보인다.
select pg_temp.act_as('00000000-0000-4000-8000-000000002202');
select 1 / case when pg_temp.row_count_for(array[2231, 2232, 2234, 2235]) = 0 and pg_temp.display_of(2304) = '10000|0|1' then 1 else 0 end as assert_other_member_sees_only_own_orders;

-- 7) 입력 상한: 1000개 초과·null은 거절.
select pg_temp.act_as('00000000-0000-4000-8000-000000002201');
do $$ begin
  perform public.my_order_item_display(null);
  raise exception 'null id list must be rejected';
exception when invalid_parameter_value then null;
end $$;
do $$ begin
  perform public.my_order_item_display(array(select extensions.gen_random_uuid() from generate_series(1, 1001)));
  raise exception 'oversized id list must be rejected';
exception when invalid_parameter_value then null;
end $$;

-- 8) service_role은 부를 수 없다.
reset role;
set local role service_role;
do $$ begin
  perform public.my_order_item_display(array['20000000-0000-4000-8000-000000002231']::uuid[]);
  raise exception 'service_role must not call my_order_item_display';
exception when insufficient_privilege then null;
end $$;

reset role;
rollback;
