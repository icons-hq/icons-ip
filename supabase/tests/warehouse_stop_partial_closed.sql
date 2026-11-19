\set ON_ERROR_STOP on
-- 출고지시 뒤 취소(ADR-0046) · 재고 부족 부분 취소가 닫은 배송 건의 '취소 뒤 출고 발견'.
-- 부분 취소가 배송 건을 닫으면 그 배송 건의 품목 줄(order_shipment_items)이 지워진다. 창고가 그래도 내보냈으면
-- 발견은 적용된 부분 취소 원장의 그 배송 건 품목으로 재고를 다시 빼고, 서원 대조 후보는 같은 원장으로 출고지시 때 줄을 되살린다.
-- 고정 픽스처는 order_partial_cancellation.sql의 앞부분(-- END FIXTURE까지)과 같다. 한 트랜잭션 안에서 만들고 끝에 되돌린다.
begin;
-- 합성 운송장번호를 쓴다. 택배사별 번호 형식(한진·우체국)은 tracking_number_integrity.sql이 보므로 이 트랜잭션에서만 끈다.
update public.shipping_carriers set tracking_number_pattern=null,tracking_number_rule=null where tracking_number_pattern is not null;
create function pg_temp.pc_id(kind text, n integer) returns uuid language sql immutable as $$select md5('partial-cancel:'||kind||':'||n)::uuid$$;
create function pg_temp.pc_assert(ok boolean, label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Partial cancellation assertion failed: %', label; end if; end $$;
create function pg_temp.pc_error(q text, expected text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if sqlstate = expected or sqlerrm = expected then return; end if; raise; end;
 raise exception 'Expected partial cancellation rejection: %', expected; end $$;
create function pg_temp.pc_auth(actor integer default 1) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub', '', true);
 perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.pc_id('user', actor),
  'session_id', pg_temp.pc_id('session', actor))::text, true);
end $$;
grant execute on function pg_temp.pc_id(text, integer), pg_temp.pc_assert(boolean, text), pg_temp.pc_error(text, text), pg_temp.pc_auth(integer) to authenticated, service_role;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
 select pg_temp.pc_id('user', n), 'authenticated', 'authenticated', 'partial-cancel-'||n||'@example.test', clock_timestamp(), '{}', '{}' from generate_series(1, 3) n;
insert into auth.sessions(id, user_id, created_at, updated_at, not_after)
 select pg_temp.pc_id('session', n), pg_temp.pc_id('user', n), clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 hour' from generate_series(1, 3) n;
update public.profiles set nickname = 'TEST 부분취소 '||right(id::text, 6),
 role = case when id = pg_temp.pc_id('user', 1) then 'admin'::public.user_role else 'user'::public.user_role end
 where id in (select pg_temp.pc_id('user', n) from generate_series(1, 3) n);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.pc_id('user', 1), 'primary');
insert into public.fulfillment_origins(id, code, name, default_carrier, base_fee, return_address, is_active)
 select pg_temp.pc_id('origin', n), 'partial-cancel-origin-'||n, 'TEST 부분취소 출고지 '||n, 'hanjin', 3000, 'TEST 반품 주소', true from generate_series(1, 2) n;
insert into public.ips(id, title, vertical_key) values ('partial-cancel-ip', 'TEST 부분취소 IP', 'character');
insert into public.goods(id, ip_id, name, price, stock, stock_qty, origin_id) values
 ('partial-cancel-a', 'partial-cancel-ip', 'TEST 품절 상품 A', 10000, 'ok', 10, pg_temp.pc_id('origin', 1)),
 ('partial-cancel-b', 'partial-cancel-ip', 'TEST 남는 상품 B', 10000, 'ok', 10, pg_temp.pc_id('origin', 1)),
 ('partial-cancel-c', 'partial-cancel-ip', 'TEST 다른 출고지 상품 C', 5000, 'ok', 10, pg_temp.pc_id('origin', 2));
create function pg_temp.pc_stock(good text) returns integer language sql as $$
 select stock_qty from public.goods_variants where good_id = good and is_default$$;

-- 주문 n: A 2개(10,000원·쿠폰 1,000원) + B 1개(10,000원)는 출고지 1, C 1개(5,000원)는 출고지 2. 배송비 배송 건마다 3,000원.
-- 결제 40,000원 = 굿즈 결제 몫 34,000원 + 배송비 6,000원. n=8은 A에 적립금 2,000원(결제 38,000원).
-- provider: 1·2·5·6·8 토스, 3 무통장, 4 나이스페이, 7 토스(버전 1 주문 — 배분 원장 없음). 9 이후는 리뷰 보완 시험(9절)용이고
-- a_coupon(A 쿠폰)·b_coupon(B 쿠폰)·ship_fee(배송 건마다 배송비)·initial(시작 상태)로 금액·상태를 바꾼다.
create function pg_temp.pc_order(n integer, provider text, version integer default 2, a_coupon bigint default 1000, b_coupon bigint default 0,
  ship_fee bigint default 3000, initial text default 'confirmed') returns void language plpgsql as $$
declare credit bigint := case when n = 8 then 2000 else 0 end;
  total bigint := (20000 - a_coupon - credit) + (10000 - b_coupon) + 5000 + 2 * ship_fee;
begin
 insert into public.orders(id, user_id, status, total, shipping_fee, discount_total, store_credit_total, calculation_version, address,
   payment_method, created_at, confirmed_at)
 values (pg_temp.pc_id('order', n), pg_temp.pc_id('user', 2), initial::public.order_status, total, 2 * ship_fee, a_coupon + b_coupon, credit, 1,
   '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
   (case when provider = 'bank_transfer' then 'bank_transfer' else 'card' end)::public.order_payment_method,
   case when n = 2 then '2031-04-01T03:00:00Z'::timestamptz else '2031-03-01T03:00:00Z'::timestamptz end,
   case when initial = 'confirmed' then clock_timestamp() - interval '1 hour' end);
 insert into public.order_items(id, order_id, good_id, variant_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot)
 select pg_temp.pc_id('item-'||g.id, n), pg_temp.pc_id('order', n), g.id, v.id, case when g.id = 'partial-cancel-a' then 2 else 1 end, g.price,
   g.name, 'partial-cancel-ip'
 from public.goods g join public.goods_variants v on v.good_id = g.id and v.is_default where g.id like 'partial-cancel-%';
 if version = 2 then
  -- 버전 2 주문은 거래 계약 묶음이 있어야 품목을 넣을 수 있다. 합성 주문은 품목을 넣은 뒤 버전을 올린다(배분 원장만 쓴다).
  update public.orders set calculation_version = 2 where id = pg_temp.pc_id('order', n);
  insert into private.order_price_allocations(order_item_id, order_id, calculation_version, subtotal, volume_discount, net_subtotal, coupon_discount, store_credit_discount, paid_goods_total)
  values (pg_temp.pc_id('item-partial-cancel-a', n), pg_temp.pc_id('order', n), 2, 20000, 0, 20000, a_coupon, credit, 20000 - a_coupon - credit),
   (pg_temp.pc_id('item-partial-cancel-b', n), pg_temp.pc_id('order', n), 2, 10000, 0, 10000, b_coupon, 0, 10000 - b_coupon),
   (pg_temp.pc_id('item-partial-cancel-c', n), pg_temp.pc_id('order', n), 2, 5000, 0, 5000, 0, 0, 5000);
 end if;
 insert into public.order_shipments(id, order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot)
 select pg_temp.pc_id('shipment-'||o, n), pg_temp.pc_id('order', n), pg_temp.pc_id('origin', o), 'TEST 부분취소 출고지 '||o, ship_fee, '{}' from generate_series(1, 2) o;
 insert into public.order_shipment_items(order_id, shipment_id, order_item_id, qty)
 select i.order_id, pg_temp.pc_id('shipment-'||case when i.good_id = 'partial-cancel-c' then 2 else 1 end, n), i.id, i.qty
 from public.order_items i where i.order_id = pg_temp.pc_id('order', n);
 insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 values (pg_temp.pc_id('payment', n), pg_temp.pc_id('user', 2), provider::public.payment_provider, 'order', pg_temp.pc_id('order', n), total, 'paid',
   case when provider = 'bank_transfer' then 'bank_transfer:'||pg_temp.pc_id('order', n) else 'TEST-PC-KEY-'||n end, 'partial-cancel-payment-'||n, clock_timestamp() - interval '2 hours');
 insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values (pg_temp.pc_id('attempt', n), provider::public.payment_provider, pg_temp.pc_id('user', 2), 'order', pg_temp.pc_id('order', n), total, 'KRW', 'approved',
   'partial-cancel-attempt-'||n, 'TEST-PC-ORDER-'||n, 'TEST-PC-PRODUCT-'||n, pg_temp.pc_id('payment', n), clock_timestamp() + interval '1 hour');
end $$;
select pg_temp.pc_order(1, 'toss'), pg_temp.pc_order(2, 'toss'), pg_temp.pc_order(3, 'bank_transfer'), pg_temp.pc_order(4, 'nicepay'),
 pg_temp.pc_order(5, 'toss'), pg_temp.pc_order(6, 'toss'), pg_temp.pc_order(7, 'toss', 1), pg_temp.pc_order(8, 'toss');
-- 9: A 전액 할인(결제 몫 0원), 10: B 전액 할인·배송비 0원(A·C를 빼면 남는 잔액 0원), 17·18·24: 발주확인 전(paid), 20: 무통장, 나머지 토스.
select pg_temp.pc_order(9, 'toss', 2, 20000), pg_temp.pc_order(10, 'toss', 2, 1000, 10000, 0), pg_temp.pc_order(20, 'bank_transfer');
select pg_temp.pc_order(n, 'toss', 2, 1000, 0, 3000, 'paid') from unnest(array[17, 18, 24]) n;
select pg_temp.pc_order(n, 'toss') from unnest(array[11, 12, 13, 14, 15, 16, 19, 21, 22, 23]) n;
create function pg_temp.pc_items(spec text) returns jsonb language sql as $$
 -- 'a:1,c:1@2' → 주문 2의 A 1개·C 1개
 select jsonb_agg(jsonb_build_object('orderItemId', pg_temp.pc_id('item-partial-cancel-'||split_part(part, ':', 1), split_part(spec, '@', 2)::integer),
   'qty', split_part(part, ':', 2)::integer))
 from unnest(string_to_array(split_part(spec, '@', 1), ',')) part$$;
create function pg_temp.pc_start(spec text, op integer, expected bigint, decision text default 'TEST 11/12 통화 — 품절 상품만 취소하고 나머지 먼저 받기',
  warehouse boolean default false, account jsonb default null) returns jsonb language sql as $$
 select public.admin_start_order_partial_cancellation(pg_temp.pc_id('order', split_part(spec, '@', 2)::integer), pg_temp.pc_items(spec), decision, null,
  warehouse, expected, pg_temp.pc_id('operation', op), account)$$;
create function pg_temp.pc_head(op integer) returns private.order_partial_cancellations language sql security definer as $$
 select * from private.order_partial_cancellations where operation_id = pg_temp.pc_id('operation', op)$$;
grant execute on function pg_temp.pc_items(text), pg_temp.pc_start(text, integer, bigint, text, boolean, jsonb), pg_temp.pc_stock(text), pg_temp.pc_head(integer) to authenticated;
-- END FIXTURE
update private.return_fee_deduction_settings set partial_cancel_enabled = true, partial_cancel_evidence = 'TEST 취소 뒤 출고 발견',
 partial_cancel_enabled_at = clock_timestamp() where singleton;
-- 주문 11의 출고지 2 배송 건(C 1개만 담김)을 출고지시했다.
update public.order_shipments set exported_at = now() - interval '30 minutes', exported_by = pg_temp.pc_id('user', 1) where id = pg_temp.pc_id('shipment-2', 11);
set local role authenticated;
select pg_temp.pc_auth();
select public.admin_record_warehouse_stop_reply(array[pg_temp.pc_id('shipment-2', 11)], 'stopped', 'phone', clock_timestamp(), 'TEST 창고 출고 중단', pg_temp.pc_id('wr', 1));
select (public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', 11), pg_temp.pc_items('c:1@11'))->>'refundAmount')::bigint as amt \gset
select pg_temp.pc_start('c:1@11', 901, :amt) as started \gset
reset role;
select public.service_complete_order_partial_cancellation((pg_temp.pc_head(901)).id, :amt, 'TEST-PC-KEY-11', 'TEST-PC-TX-901', pg_temp.pc_id('user', 1));
select 1/case when (select status = 'canceled' and exported_at is not null from public.order_shipments where id = pg_temp.pc_id('shipment-2', 11))
 and not exists(select 1 from public.order_shipment_items where shipment_id = pg_temp.pc_id('shipment-2', 11))
 and pg_temp.pc_stock('partial-cancel-c') = 11
 then 1 else 0 end as assert_partial_cancel_closed_the_exported_shipment;

-- 서원 대조 후보: 닫힌 배송 건도 출고지시 때 품목·수량으로 보인다(주소 전화 01000000000).
set local role authenticated;
select pg_temp.pc_auth();
select public.admin_origin_tracking_candidates(pg_temp.pc_id('origin', 2), '{}', array['01000000000']) as candidates \gset
-- 창고가 그래도 내보냈다: 운송장 회신 반입 → 발견, 부분 취소가 되돌린 C 1개를 다시 뺀다.
select public.admin_import_shipment_tracking(pg_temp.pc_id('shipment-2', 11)::text, 'hanjin', 'TESTPC00009011') as discovery \gset
reset role;
select 1/case when exists(select 1 from jsonb_array_elements(:'candidates'::jsonb->'shipments') c
   where c->>'id' = pg_temp.pc_id('shipment-2', 11)::text and c->>'status' = 'canceled'
     and jsonb_array_length(c->'lines') = 1 and c->'lines'->0->>'goodName' = 'TEST 다른 출고지 상품 C' and (c->'lines'->0->>'qty')::int = 1)
 then 1 else 0 end as assert_closed_shipment_candidate_keeps_exported_lines;
select 1/case when (:'discovery'::jsonb->>'canceledAfterExport')::boolean
 and (select restored_qty = 1 and withdrawn_qty = 1 and shortfall_qty = 0 and state = 'open'
   from private.canceled_shipment_dispatches where shipment_id = pg_temp.pc_id('shipment-2', 11))
 and (select count(*) = 1 and bool_and(x.order_item_id = pg_temp.pc_id('item-partial-cancel-c', 11) and x.restored_qty = 1)
   from private.canceled_shipment_dispatch_stock x join private.canceled_shipment_dispatches d on d.id = x.dispatch_id
   where d.shipment_id = pg_temp.pc_id('shipment-2', 11))
 and pg_temp.pc_stock('partial-cancel-c') = 10
 then 1 else 0 end as assert_closed_shipment_discovery_withdraws_stock;

-- ---------------------------------------------------------------------------
-- PR #693 리뷰: 출고지시 뒤의 모든 부분 취소를 센다(배송 건을 닫은 것만이 아니다). 출고지시 전 부분 취소는 파일에 없었다.
-- ---------------------------------------------------------------------------
create function pg_temp.wsp_partial(spec text, op integer, reply_op integer) returns void language plpgsql as $$
declare amount bigint; n integer := split_part(spec, '@', 2)::integer;
begin
  perform pg_temp.pc_auth();
  execute 'set local role authenticated';
  if exists(select 1 from public.order_shipments where order_id = pg_temp.pc_id('order', n) and status = 'ready' and exported_at is not null) then
    perform public.admin_record_warehouse_stop_reply(array(select id from public.order_shipments where order_id = pg_temp.pc_id('order', n)
      and status = 'ready' and exported_at is not null), 'stopped', 'phone', clock_timestamp(), 'TEST 창고 출고 중단', pg_temp.pc_id('wr', reply_op));
  end if;
  amount := (public.admin_preview_order_partial_cancellation(pg_temp.pc_id('order', n), pg_temp.pc_items(spec))->>'refundAmount')::bigint;
  perform pg_temp.pc_start(spec, op, amount);
  execute 'reset role';
  perform public.service_complete_order_partial_cancellation((pg_temp.pc_head(op)).id, amount, 'TEST-PC-KEY-' || n, 'TEST-PC-TX-' || op, pg_temp.pc_id('user', 1));
end $$;
create function pg_temp.wsp_full_cancel(n integer, reply_op integer) returns void language plpgsql as $$
declare request uuid;
begin
  perform pg_temp.pc_auth();
  execute 'set local role authenticated';
  perform public.admin_record_warehouse_stop_reply(array(select id from public.order_shipments where order_id = pg_temp.pc_id('order', n)
    and status = 'ready' and exported_at is not null), 'stopped', 'phone', clock_timestamp(), 'TEST 창고 출고 중단', pg_temp.pc_id('wr', reply_op));
  request := public.admin_start_order_cancellation(pg_temp.pc_id('order', n), 'out_of_stock', null, false);
  execute 'reset role';
  perform public.complete_order_cancellation_request(request, array['TEST-PC-KEY-' || n], pg_temp.pc_id('user', 1));
end $$;
create function pg_temp.wsp_discover(n integer, tracking text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform pg_temp.pc_auth();
  execute 'set local role authenticated';
  result := public.admin_import_shipment_tracking(pg_temp.pc_id('shipment-1', n)::text, 'hanjin', tracking);
  execute 'reset role';
  return result;
end $$;
create function pg_temp.wsp_lines(n integer) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform pg_temp.pc_auth();
  execute 'set local role authenticated';
  select c->'lines' into result from jsonb_array_elements(public.admin_origin_tracking_candidates(pg_temp.pc_id('origin', 1), '{}', array['01000000000'])->'shipments') c
  where c->>'id' = pg_temp.pc_id('shipment-1', n)::text;
  execute 'reset role';
  return (select jsonb_object_agg(line->>'goodName', (line->>'qty')::integer) from jsonb_array_elements(result) line);
end $$;
create function pg_temp.wsp_restored(n integer) returns jsonb language sql as $$
 select jsonb_object_agg(i.good_id, x.restored_qty) from private.canceled_shipment_dispatch_stock x
  join private.canceled_shipment_dispatches d on d.id = x.dispatch_id join public.order_items i on i.id = x.order_item_id
 where d.shipment_id = pg_temp.pc_id('shipment-1', n)$$;

-- 주문 12: 출고지시(A 2·B 1) → A 2개 부분 취소 → B 1개 부분 취소(배송 건 닫힘) → 창고가 A+B를 내보냄. A·B 모두 다시 뺀다.
update public.order_shipments set exported_at = now() - interval '30 minutes', exported_by = pg_temp.pc_id('user', 1) where id = pg_temp.pc_id('shipment-1', 12);
select pg_temp.wsp_partial('a:2@12', 1201, 1201), pg_temp.wsp_partial('b:1@12', 1202, 1202);
select pg_temp.pc_stock('partial-cancel-a') as a_before_12, pg_temp.pc_stock('partial-cancel-b') as b_before_12 \gset
select pg_temp.wsp_lines(12) as lines_12 \gset
select pg_temp.wsp_discover(12, 'TESTPC00009012') as discovery_12 \gset
select 1/case when (select status = 'canceled' from public.order_shipments where id = pg_temp.pc_id('shipment-1', 12))
 and (:'discovery_12'::jsonb->>'canceledAfterExport')::boolean
 and pg_temp.wsp_restored(12) = '{"partial-cancel-a": 2, "partial-cancel-b": 1}'::jsonb
 and pg_temp.pc_stock('partial-cancel-a') = :a_before_12 - 2 and pg_temp.pc_stock('partial-cancel-b') = :b_before_12 - 1
 and :'lines_12'::jsonb = '{"TEST 남는 상품 B": 1, "TEST 품절 상품 A": 2}'::jsonb
 then 1 else 0 end as assert_every_partial_after_export_is_withdrawn;

-- 주문 13: 출고지시(A 2·B 1) → A 1개 부분 취소 → 전액 취소(남은 A 1·B 1 복원, 품목 줄은 남는다). 대조 후보는 출고지시 때 A 2·B 1이고
-- 발견은 A 2·B 1을 다시 뺀다.
update public.order_shipments set exported_at = now() - interval '30 minutes', exported_by = pg_temp.pc_id('user', 1) where id = pg_temp.pc_id('shipment-1', 13);
select pg_temp.wsp_partial('a:1@13', 1301, 1301);
select pg_temp.wsp_full_cancel(13, 1302);
select pg_temp.pc_stock('partial-cancel-a') as a_before_13, pg_temp.pc_stock('partial-cancel-b') as b_before_13 \gset
select pg_temp.wsp_lines(13) as lines_13 \gset
select pg_temp.wsp_discover(13, 'TESTPC00009013') as discovery_13 \gset
select 1/case when (select status = 'canceled' from public.orders where id = pg_temp.pc_id('order', 13))
 and exists(select 1 from public.order_shipment_items where shipment_id = pg_temp.pc_id('shipment-1', 13))
 and :'lines_13'::jsonb = '{"TEST 남는 상품 B": 1, "TEST 품절 상품 A": 2}'::jsonb
 and pg_temp.wsp_restored(13) = '{"partial-cancel-a": 2, "partial-cancel-b": 1}'::jsonb
 and pg_temp.pc_stock('partial-cancel-a') = :a_before_13 - 2 and pg_temp.pc_stock('partial-cancel-b') = :b_before_13 - 1
 then 1 else 0 end as assert_partial_then_full_cancel_reconstructs_export;

-- 주문 14: A 1개 부분 취소(출고지시 전) → 출고지시(A 1·B 1) → 전액 취소. 출고지시 전 부분 취소는 파일에 없었으므로 A 1·B 1만 본다.
select pg_temp.wsp_partial('a:1@14', 1401, 1401);
update public.order_shipments set exported_at = clock_timestamp(), exported_by = pg_temp.pc_id('user', 1) where id = pg_temp.pc_id('shipment-1', 14);
select pg_temp.wsp_full_cancel(14, 1402);
select pg_temp.pc_stock('partial-cancel-a') as a_before_14 \gset
select pg_temp.wsp_lines(14) as lines_14 \gset
select pg_temp.wsp_discover(14, 'TESTPC00009014') as discovery_14 \gset
select 1/case when :'lines_14'::jsonb = '{"TEST 남는 상품 B": 1, "TEST 품절 상품 A": 1}'::jsonb
 and pg_temp.wsp_restored(14) = '{"partial-cancel-a": 1, "partial-cancel-b": 1}'::jsonb
 and pg_temp.pc_stock('partial-cancel-a') = :a_before_14 - 1
 then 1 else 0 end as assert_partial_before_export_is_not_counted;

rollback;
