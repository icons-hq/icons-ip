\set ON_ERROR_STOP on

-- D-1b — 주문 경로의 재고 효과: 예약 · 출고 차감 · 예약 해제 · 반품 재입고 (설계서 v2 §1-1)

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000891', 'authenticated', 'authenticated', 'reserve-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000892', 'authenticated', 'authenticated', 'reserve-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-000000000891', 'reserve-buyer@example.test', 'reserve_buyer', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000000892', 'reserve-staff@example.test', 'reserve_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff')
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.verticals (key, label, color) values ('order-res-test', '예약 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('order-res-ip', '예약 테스트 IP', 'order-res-test') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('order-res-g1', 'order-res-ip', '예약 테스트 굿즈', '문구', 60000, 'ok', 10),
  ('order-res-g2', 'order-res-ip', '옵션 예정 굿즈', '키링', 5000, 'ok', 4)
on conflict (id) do nothing;

select id as v_g1 from public.good_variants where good_id = 'order-res-g1' \gset
select set_config('res.v_g1', :'v_g1', true);

-- ---------------------------------------------------------------------------
-- A. 주문 생성 = 예약. 보유는 그대로, 가용·캐시만 줄어든다.
-- ---------------------------------------------------------------------------
insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-000000000891', 'order-res-g1', 3);
select public.place_order(
  '00000000-0000-4000-8000-000000000891'::uuid,
  '{"recipientName":"홍길동","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1","address2":"101동"}'::jsonb,
  '00000000-0000-4000-8000-00000000e001'::uuid
) as order_1 \gset
select set_config('res.order_1', :'order_1', true);

reset role;
select 1 / case when (
  (select on_hand_qty = 10 and reserved_qty = 3 from public.variant_stocks where variant_id = :'v_g1' and location_id = 'gimpo')
  and (select stock_qty = 7 and stock = 'ok' from public.goods where id = 'order-res-g1')
  and (select count(*) from public.stock_movements where reason_code = 'order_reserve' and ref_id = :'order_1') = 1
  and (select variant_id = :'v_g1'::uuid and location_id = 'gimpo' and variant_code_snapshot = 'order-res-g1-01'
       from public.order_items where order_id = :'order_1')
) then 1 else 0 end as assert_order_reserves_without_touching_on_hand;

-- ---------------------------------------------------------------------------
-- B. 가용을 넘는 주문은 기존 문구 그대로 막힌다(앱이 'out of stock' 을 읽는다).
-- ---------------------------------------------------------------------------
insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-000000000891', 'order-res-g1', 8);
do $$
begin
  perform public.place_order(
    '00000000-0000-4000-8000-000000000891'::uuid,
    '{"recipientName":"홍길동","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1","address2":"101동"}'::jsonb,
    '00000000-0000-4000-8000-00000000e002'::uuid
  );
  raise exception 'ordering beyond availability must fail';
exception when check_violation then
  if sqlerrm not like 'out of stock%' then raise; end if;
end $$;
delete from public.cart_items where user_id = '00000000-0000-4000-8000-000000000891';

-- ---------------------------------------------------------------------------
-- C. 배송중 처리 = 보유 차감 + 예약 해제. 가용·캐시는 그대로.
-- ---------------------------------------------------------------------------
reset role;
update public.orders set status = 'paid' where id = :'order_1';
update public.orders set status = 'confirmed', confirmed_at = now() where id = :'order_1';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000892', true);
select public.admin_update_order_status(:'order_1'::uuid, 'shipping'::public.order_status, 'hanjin', '123456789012');

reset role;
select 1 / case when (
  (select on_hand_qty = 7 and reserved_qty = 0 from public.variant_stocks where variant_id = :'v_g1' and location_id = 'gimpo')
  and (select stock_qty = 7 from public.goods where id = 'order-res-g1')
  and (select count(*) from public.stock_movements where reason_code = 'order_ship' and ref_id = :'order_1') = 1
) then 1 else 0 end as assert_shipping_consumes_reservation;

-- ---------------------------------------------------------------------------
-- D. 출고 후 취소 = 반품 재입고(보유 증가). 출고 전 취소 = 예약 해제.
-- ---------------------------------------------------------------------------
-- 출고 뒤 취소는 staff 승인이 남긴 durable claim 과 PG 취소 증적이 선행한다(기존 계약).
insert into public.payments (id, user_id, purpose, ref_id, amount, status, payment_key, idempotency_key, raw)
values ('50000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-000000000891', 'order', :'order_1'::uuid,
        180000, 'canceled', 'order-res-key-1', 'order-res-key-1', '{}');
insert into public.order_cancellation_claims (order_id, requested_by, previous_status)
values (:'order_1'::uuid, '00000000-0000-4000-8000-000000000891', 'shipping');
select public.finalize_order_cancellation_with_provider_evidence(:'order_1'::uuid, '테스트 취소', array[]::text[]);
select 1 / case when (
  (select on_hand_qty = 10 and reserved_qty = 0 from public.variant_stocks where variant_id = :'v_g1' and location_id = 'gimpo')
  and (select stock_qty = 10 from public.goods where id = 'order-res-g1')
  and (select count(*) from public.stock_movements where reason_code = 'return_restock' and ref_id = :'order_1') = 1
  and (select status from public.orders where id = :'order_1') = 'canceled'
) then 1 else 0 end as assert_post_shipping_cancel_restocks;

insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-000000000891', 'order-res-g1', 2);
select public.place_order(
  '00000000-0000-4000-8000-000000000891'::uuid,
  '{"recipientName":"홍길동","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1","address2":"101동"}'::jsonb,
  '00000000-0000-4000-8000-00000000e003'::uuid
) as order_2 \gset
select set_config('res.order_2', :'order_2', true);
reset role;
select 1 / case when (select reserved_qty = 2 and on_hand_qty = 10 from public.variant_stocks where variant_id = :'v_g1' and location_id = 'gimpo')
  then 1 else 0 end as assert_second_order_reserved;

select public.finalize_order_cancellation_with_provider_evidence(:'order_2'::uuid, '출고 전 취소', array[]::text[]);
select 1 / case when (
  (select on_hand_qty = 10 and reserved_qty = 0 from public.variant_stocks where variant_id = :'v_g1' and location_id = 'gimpo')
  and (select stock_qty = 10 from public.goods where id = 'order-res-g1')
  and (select count(*) from public.stock_movements where reason_code = 'order_release' and ref_id = :'order_2') = 1
  and (select count(*) from public.stock_movements where reason_code = 'return_restock' and ref_id = :'order_2') = 0
) then 1 else 0 end as assert_pre_shipping_cancel_releases_reservation;

-- ---------------------------------------------------------------------------
-- E. 판매 중지·보관 상품은 수량이 남아도 주문되지 않는다.
-- ---------------------------------------------------------------------------
update public.goods set stock = 'soldout' where id = 'order-res-g1';
insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-000000000891', 'order-res-g1', 1);
do $$
begin
  perform public.place_order(
    '00000000-0000-4000-8000-000000000891'::uuid,
    '{"recipientName":"홍길동","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1","address2":"101동"}'::jsonb,
    '00000000-0000-4000-8000-00000000e004'::uuid
  );
  raise exception 'manually stopped good must not be ordered';
exception when check_violation then
  if sqlerrm not like 'out of stock%' then raise; end if;
end $$;
reset role;
update public.goods set stock = 'ok' where id = 'order-res-g1';
delete from public.cart_items where user_id = '00000000-0000-4000-8000-000000000891';

-- ---------------------------------------------------------------------------
-- F. 품목이 여러 개인 상품은 어느 품목인지 골라야 주문된다.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000892', true);
select (public.admin_upsert_option_master(null, '사이즈', 'select', 1, false, '[{"value":"S"},{"value":"M"}]'::jsonb)) as size \gset
select (:'size'::jsonb ->> 'id') as size_id \gset
select (select v.id from public.option_values v where v.option_id = :'size_id'::uuid and v.value = 'S') as s_id,
       (select v.id from public.option_values v where v.option_id = :'size_id'::uuid and v.value = 'M') as m_id \gset
select public.admin_upsert_variants(
  'order-res-g2', '00000000-0000-4000-8000-00000000f001',
  format('[{"option_id":"%s","position":1}]', :'size_id')::jsonb,
  format('[{"values":{"%1$s":"%2$s"},"initial_stocks":[{"location_id":"gimpo","on_hand_qty":5}]},'
         '{"values":{"%1$s":"%3$s"},"initial_stocks":[{"location_id":"gimpo","on_hand_qty":6}]}]',
         :'size_id', :'s_id', :'m_id')::jsonb
) as g2_variants \gset

select id as v_g2_s from public.good_variants where good_id = 'order-res-g2' and archived_at is null order by code limit 1 \gset
select set_config('res.v_g2_s', :'v_g2_s', true);

reset role;
insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-000000000891', 'order-res-g2', 1);
do $$
begin
  perform public.place_order(
    '00000000-0000-4000-8000-000000000891'::uuid,
    '{"recipientName":"홍길동","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1","address2":"101동"}'::jsonb,
    '00000000-0000-4000-8000-00000000e005'::uuid
  );
  raise exception 'multi-variant good without a chosen variant must fail';
exception when check_violation then
  if sqlerrm not like 'variant required%' then raise; end if;
end $$;

-- 품목을 고르면 그 품목의 재고에서 예약된다.
update public.cart_items set variant_id = current_setting('res.v_g2_s')::uuid
where user_id = '00000000-0000-4000-8000-000000000891' and good_id = 'order-res-g2';
select public.place_order(
  '00000000-0000-4000-8000-000000000891'::uuid,
  '{"recipientName":"홍길동","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1","address2":"101동"}'::jsonb,
  '00000000-0000-4000-8000-00000000e006'::uuid
) as order_3 \gset

reset role;
select 1 / case when (
  (select reserved_qty = 1 from public.variant_stocks where variant_id = :'v_g2_s' and location_id = 'gimpo')
  and (select stock_qty = 10 from public.goods where id = 'order-res-g2')
  and (select variant_id = :'v_g2_s'::uuid and option_summary_snapshot = '사이즈: S'
       from public.order_items where order_id = :'order_3')
) then 1 else 0 end as assert_chosen_variant_is_reserved;

-- ---------------------------------------------------------------------------
-- G. 같은 전이를 두 번 실행하면 조용히 두 배가 되는 대신 시끄럽게 실패한다.
-- ---------------------------------------------------------------------------
-- 같은 전이를 두 번 밟지 못하게 막는 것은 주문 상태 기계다 — 취소된 주문의 재취소는 재고를 건드리지 않는다.
select public.finalize_order_cancellation_with_provider_evidence(:'order_2'::uuid, '재취소 시도', array[]::text[]);
select 1 / case when (
  (select on_hand_qty = 10 and reserved_qty = 0 from public.variant_stocks where variant_id = :'v_g1' and location_id = 'gimpo')
  and (select count(*) from public.stock_movements where reason_code = 'order_release' and ref_id = :'order_2') = 1
) then 1 else 0 end as assert_repeat_cancel_is_a_no_op;

-- 예약이 없는 주문 항목(이관 전 데이터)도 가용 변화량은 옛 모델과 같다 — 해제는 남는 만큼을 보유로 되돌린다.
insert into public.orders (id, user_id, status, total, address, created_at)
values ('40000000-0000-4000-8000-00000000e009', '00000000-0000-4000-8000-000000000891', 'paid', 1000,
        '{"recipientName":"이관","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1"}'::jsonb, now());
insert into public.order_items (order_id, good_id, qty, unit_price, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
values ('40000000-0000-4000-8000-00000000e009', 'order-res-g1', 2, 60000, '예약 테스트 굿즈', '문구', 'order-res-ip');
select 1 / case when (
  select on_hand_qty = 10 and reserved_qty = 0 from public.variant_stocks where variant_id = :'v_g1' and location_id = 'gimpo'
) then 1 else 0 end as assert_legacy_item_has_no_reservation;
select private.release_order_reservation('40000000-0000-4000-8000-00000000e009'::uuid);
select 1 / case when (
  (select on_hand_qty = 12 and reserved_qty = 0 from public.variant_stocks where variant_id = :'v_g1' and location_id = 'gimpo')
  and (select stock_qty = 12 from public.goods where id = 'order-res-g1')
  and (select note like '예약 없는 수량 2개%' from public.stock_movements
       where reason_code = 'order_release' and ref_id = '40000000-0000-4000-8000-00000000e009')
) then 1 else 0 end as assert_release_without_reservation_restores_availability;

-- ---------------------------------------------------------------------------
-- H. 캐시 불변식은 모든 상품에서 유지된다.
-- ---------------------------------------------------------------------------
select 1 / case when (
  select count(*) = 0
  from public.goods as good
  join private.good_stock_totals(good.id, good.stock_override) as totals on true
  where good.stock_qty is distinct from totals.stock_qty or good.stock is distinct from totals.stock
) then 1 else 0 end as assert_cache_invariant_holds_after_order_flows;

rollback;
