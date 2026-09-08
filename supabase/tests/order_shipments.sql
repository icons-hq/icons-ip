\set ON_ERROR_STOP on

-- D-3 — 라인 수량 카운터 · 부분 출고 (설계서 v2 §1-3)

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000009f1', 'authenticated', 'authenticated', 'ship-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000009f2', 'authenticated', 'authenticated', 'ship-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000009f1', 'ship-buyer@example.test', 'ship_buyer', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-0000000009f2', 'ship-staff@example.test', 'ship_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff')
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, role = excluded.role;

insert into public.verticals (key, label, color) values ('ship-test', '출고 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('ship-ip', '출고 테스트 IP', 'ship-test') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('ship-g1', 'ship-ip', '출고 테스트 굿즈 A', '문구', 5000, 'ok', 40),
  ('ship-g2', 'ship-ip', '출고 테스트 굿즈 B', '키링', 7000, 'ok', 40)
on conflict (id) do nothing;

insert into public.cart_items (user_id, good_id, qty) values
  ('00000000-0000-4000-8000-0000000009f1', 'ship-g1', 3),
  ('00000000-0000-4000-8000-0000000009f1', 'ship-g2', 2);
select public.place_order(
  '00000000-0000-4000-8000-0000000009f1'::uuid,
  '{"recipientName":"박출고","phone":"01055556666","postalCode":"06236","address1":"서울특별시 강남구 테헤란로 2","address2":"5층"}'::jsonb,
  '00000000-0000-4000-8000-0000000009f5'::uuid
) as ship_order \gset
select set_config('ship.order', :'ship_order', true);

update public.orders set status = 'paid' where id = current_setting('ship.order')::uuid;
update public.orders set status = 'confirmed', confirmed_at = now() where id = current_setting('ship.order')::uuid;

select id as item_a from public.order_items where order_id = current_setting('ship.order')::uuid and good_id = 'ship-g1' \gset
select id as item_b from public.order_items where order_id = current_setting('ship.order')::uuid and good_id = 'ship-g2' \gset
select set_config('ship.item_a', :'item_a', true), set_config('ship.item_b', :'item_b', true);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009f2', true);

-- ---------------------------------------------------------------------------
-- A. 담을 수 있는 수량 — 주문한 것보다 많이 내보낼 수 없다
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.admin_create_shipment(
    current_setting('ship.order')::uuid,
    jsonb_build_array(jsonb_build_object('order_item_id', current_setting('ship.item_a'), 'qty', 4)),
    'hanjin', 'CJOVER0001'
  );
  raise exception 'shipping more than ordered must fail';
exception when others then
  if sqlerrm <> 'qty_exceeds_available' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- B. 부분 출고 — 3개 중 1개만 먼저 보낸다
-- ---------------------------------------------------------------------------
select public.admin_create_shipment(
  current_setting('ship.order')::uuid,
  jsonb_build_array(jsonb_build_object('order_item_id', current_setting('ship.item_a'), 'qty', 1)),
  'hanjin', 'CJSHIP0001'
) as shipment_1 \gset
select set_config('ship.s1', :'shipment_1', true);

-- 준비 중에는 재고가 움직이지 않는다. 종이 위의 출고는 아직 출고가 아니다.
select 1 / case when (
  (select qty_shipped from public.order_items where id = current_setting('ship.item_a')::uuid) = 0
  and (select fulfillment_state from public.order_fulfillment_view where order_id = current_setting('ship.order')::uuid) = 'ready'
) then 1 else 0 end as assert_ready_shipment_moves_nothing;

select public.admin_ship_shipment(current_setting('ship.s1')::uuid) as state_1 \gset
select 1 / case when :'state_1' = 'partially_shipped'
  and (select qty_shipped from public.order_items where id = current_setting('ship.item_a')::uuid) = 1
  and (select qty_shipped from public.order_items where id = current_setting('ship.item_b')::uuid) = 0
  and (select status from public.orders where id = current_setting('ship.order')::uuid) = 'shipping'
  then 1 else 0 end as assert_partial_shipment_counts_only_what_left;

-- 재고는 나간 수량만큼만 빠진다.
select 1 / case when (
  select stock.on_hand_qty from public.variant_stocks as stock
  join public.order_items as item on item.variant_id = stock.variant_id and item.location_id = stock.location_id
  where item.id = current_setting('ship.item_a')::uuid
) = 39 then 1 else 0 end as assert_stock_leaves_with_the_shipment;

-- 남은 수량만 다음 출고에 담을 수 있다.
do $$
begin
  perform public.admin_create_shipment(
    current_setting('ship.order')::uuid,
    jsonb_build_array(jsonb_build_object('order_item_id', current_setting('ship.item_a'), 'qty', 3)),
    'hanjin', 'CJSHIP000X'
  );
  raise exception 'remaining qty must be respected';
exception when others then
  if sqlerrm <> 'qty_exceeds_available' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- C. 나머지를 보내면 전량 출고가 된다
-- ---------------------------------------------------------------------------
select public.admin_create_shipment(
  current_setting('ship.order')::uuid,
  jsonb_build_array(
    jsonb_build_object('order_item_id', current_setting('ship.item_a'), 'qty', 2),
    jsonb_build_object('order_item_id', current_setting('ship.item_b'), 'qty', 2)
  ),
  'hanjin', 'CJSHIP0002'
) as shipment_2 \gset
select set_config('ship.s2', :'shipment_2', true);
select public.admin_ship_shipment(current_setting('ship.s2')::uuid) as state_2 \gset
select 1 / case when :'state_2' = 'shipped'
  and (select qty_shipped from public.order_items where id = current_setting('ship.item_a')::uuid) = 3
  and (select qty_shipped from public.order_items where id = current_setting('ship.item_b')::uuid) = 2
  then 1 else 0 end as assert_all_shipped_when_nothing_remains;

-- 출고번호는 주문번호 뒤에 순번이 붙는다.
select 1 / case when (
  select array_agg(shipment_no order by shipment_no) from public.shipments
  where order_id = current_setting('ship.order')::uuid
) = array[
  (select order_no || '-S01' from public.orders where id = current_setting('ship.order')::uuid),
  (select order_no || '-S02' from public.orders where id = current_setting('ship.order')::uuid)
] then 1 else 0 end as assert_shipment_no_follows_order_no;

-- ---------------------------------------------------------------------------
-- D. 도착 — 하나만 도착하면 부분 도착, 전부 도착해야 헤더가 배송완료
-- ---------------------------------------------------------------------------
select public.admin_deliver_shipment(current_setting('ship.s1')::uuid) as state_3 \gset
select 1 / case when :'state_3' = 'partially_delivered'
  and (select status from public.orders where id = current_setting('ship.order')::uuid) = 'shipping'
  and (select delivered_at from public.orders where id = current_setting('ship.order')::uuid) is null
  then 1 else 0 end as assert_partial_delivery_does_not_finish_the_order;

select public.admin_deliver_shipment(current_setting('ship.s2')::uuid) as state_4 \gset
select 1 / case when :'state_4' = 'delivered'
  and (select status from public.orders where id = current_setting('ship.order')::uuid) = 'delivered'
  and (select delivered_at from public.orders where id = current_setting('ship.order')::uuid) is not null
  then 1 else 0 end as assert_full_delivery_finishes_the_order;

-- 이미 보낸 출고는 다시 보낼 수 없다.
do $$
begin
  perform public.admin_ship_shipment(current_setting('ship.s1')::uuid);
  raise exception 'shipped shipment must not ship again';
exception when others then
  if sqlerrm <> 'shipment_not_ready' then raise; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- E. 카운터 불변식 — 나간 것보다 많이 도착할 수 없다
-- ---------------------------------------------------------------------------
do $$
begin
  update public.order_items set qty_delivered = qty_shipped + 1 where id = current_setting('ship.item_a')::uuid;
  raise exception 'delivered must not exceed shipped';
exception when check_violation then null;
end $$;

do $$
begin
  update public.order_items set qty_canceled = qty where id = current_setting('ship.item_a')::uuid;
  raise exception 'canceled must not swallow shipped qty';
exception when check_violation then null;
end $$;

-- ---------------------------------------------------------------------------
-- F. 기존 경로 — 헤더를 미는 버튼도 출고 원장을 지난다
-- ---------------------------------------------------------------------------
insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-0000000009f1', 'ship-g1', 2);
select public.place_order(
  '00000000-0000-4000-8000-0000000009f1'::uuid,
  '{"recipientName":"박출고","phone":"01055556666","postalCode":"06236","address1":"서울특별시 강남구 테헤란로 2","address2":"5층"}'::jsonb,
  '00000000-0000-4000-8000-0000000009f6'::uuid
) as legacy_order \gset
select set_config('ship.legacy', :'legacy_order', true);
update public.orders set status = 'paid' where id = current_setting('ship.legacy')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009f2', true);
select public.admin_update_order_status(current_setting('ship.legacy')::uuid, 'confirmed', null, null);
select public.admin_update_order_status(current_setting('ship.legacy')::uuid, 'shipping', 'hanjin', 'CJLEGACY01');
select 1 / case when (
  (select count(*) from public.shipments where order_id = current_setting('ship.legacy')::uuid) = 1
  and (select status from public.shipments where order_id = current_setting('ship.legacy')::uuid) = 'shipped'
  and (select qty_shipped from public.order_items where order_id = current_setting('ship.legacy')::uuid) = 2
  and (select fulfillment_state from public.order_fulfillment_view where order_id = current_setting('ship.legacy')::uuid) = 'shipped'
) then 1 else 0 end as assert_header_transition_creates_a_shipment;

select public.admin_update_order_status(current_setting('ship.legacy')::uuid, 'delivered', null, null);
select 1 / case when (
  (select status from public.shipments where order_id = current_setting('ship.legacy')::uuid) = 'delivered'
  and (select qty_delivered from public.order_items where order_id = current_setting('ship.legacy')::uuid) = 2
) then 1 else 0 end as assert_header_delivery_closes_the_shipment;
reset role;

-- ---------------------------------------------------------------------------
-- G. 권한 — 구매자는 자기 출고만 본다
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_ship_shipment(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_ship_shipment(uuid,text,text)', 'execute')
  and not has_table_privilege('authenticated', 'public.shipments', 'insert')
  and not has_table_privilege('anon', 'public.shipments', 'select')
) then 1 else 0 end as assert_shipment_acl;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000009f1', true);
select count(*) as own_shipments from public.shipments \gset
select 1 / case when :'own_shipments'::integer = 3 then 1 else 0 end as assert_buyer_sees_own_shipments;
reset role;

-- ---------------------------------------------------------------------------
-- 발송 방법 (현업 슬라이스 3) — 송장은 택배일 때만 필요하다
-- ---------------------------------------------------------------------------
select 1 / case when (
  select method = 'parcel' from public.shipments limit 1
) then 1 else 0 end as assert_shipment_method_defaults_to_parcel;

do $$
declare
  v_order uuid;
  v_item uuid;
  v_ship uuid;
begin
  select ord.id into v_order from public.orders as ord order by ord.created_at desc limit 1;
  select item.id into v_item from public.order_items as item
  where item.order_id = v_order and item.qty - item.qty_canceled - item.qty_shipped > 0
  limit 1;
  if v_item is null then return; end if;

  -- 방문수령은 송장 없이 만들고 내보낼 수 있다. 옛 제약은 이런 출고를 아예 막았다.
  v_ship := public.admin_create_shipment(
    v_order,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('order_item_id', v_item, 'qty', 1)),
    null, null, 'pickup'
  );
  perform public.admin_ship_shipment(v_ship, null, null);

  if (select status from public.shipments where id = v_ship) <> 'shipped' then
    raise exception 'pickup shipment should ship without a tracking number';
  end if;
end;
$$;

rollback;
