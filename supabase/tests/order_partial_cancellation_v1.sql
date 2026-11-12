\set ON_ERROR_STOP on
-- 재고 부족 부분 취소 — 버전 1 주문의 파생 배분 원장(ADR-0032 보완 2026-11-13, T12c). 한 트랜잭션 안에서 합성 주문을 만들고 끝에 되돌린다.
--  1. 배분: 쿠폰·적립금이 섞인 버전 1 주문의 품목 배분(대상 품목 금액 비례·쿠폰 뒤 금액 비례, 내림 뒤 끝수는 나머지가 큰 품목부터 1원씩)과
--     합계 보존(Σ품목 결제 몫 + Σ배송 건 배송비 = 결제액), 대상 품목 쿠폰.
--  2. 결정성: 같은 주문은 몇 번 계산해도 같은 결과(입력 해시 포함), 미리보기는 얼리지 않는다, 시작이 그 결과를 그대로 얼린다, 얼린 뒤 입력이
--     바뀌어도 원장 값으로 계산한다, 원장은 바뀌지도 지워지지도 않는다.
--  3. 토스 다회 부분 취소(배송 건 닫힘·적립금 몫·출고 파일 남은 몫) 뒤 운영자 전액 취소 remainder — 합 = 결제액. PG 대사.
--  4. 무통장 버전 1: 시작 때 적용·송금 대기, 두 번째도 같은 원장, 취소 확정의 송금액이 남은 잔액 — 합 = 결제액.
--  5. 막힘: 결제액·배송비·쿠폰 기록이 맞지 않는 주문은 partial_cancel_v1_allocation_mismatch / unavailable로 막고 원장을 만들지 않는다.
--     쿠폰 대상 범위(IP·카테고리·하위 분류)는 대상 품목만 나누고, 대상 분류가 보관되면 unavailable로 막는다(5b).
--  6. 부분 취소가 없는 버전 1 주문의 기존 경로(출고 파일·배분 입력·환불 금액·전액 취소)는 이 변경 전과 같다.
--  7. 거래확정 수집·배분 입력은 얼린 원장을 버전 2와 같은 모양으로 싣는다. seam·권한.
begin;
create function pg_temp.pv_id(kind text, n integer) returns uuid language sql immutable as $$select md5('partial-cancel-v1:'||kind||':'||n)::uuid$$;
create function pg_temp.pv_assert(ok boolean, label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'V1 partial cancellation assertion failed: %', label; end if; end $$;
create function pg_temp.pv_error(q text, expected text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if sqlstate = expected or sqlerrm = expected then return; end if; raise; end;
 raise exception 'Expected v1 partial cancellation rejection: %', expected; end $$;
create function pg_temp.pv_auth(actor integer default 1) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub', '', true);
 perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.pv_id('user', actor),
  'session_id', pg_temp.pv_id('session', actor))::text, true);
end $$;
grant execute on function pg_temp.pv_id(text, integer), pg_temp.pv_assert(boolean, text), pg_temp.pv_error(text, text), pg_temp.pv_auth(integer) to authenticated, service_role;

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
 select pg_temp.pv_id('user', n), 'authenticated', 'authenticated', 'partial-cancel-v1-'||n||'@example.test', clock_timestamp(), '{}', '{}' from generate_series(1, 2) n;
insert into auth.sessions(id, user_id, created_at, updated_at, not_after)
 select pg_temp.pv_id('session', n), pg_temp.pv_id('user', n), clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 hour' from generate_series(1, 2) n;
update public.profiles set nickname = 'TEST 버전1부분취소 '||right(id::text, 6),
 role = case when id = pg_temp.pv_id('user', 1) then 'admin'::public.user_role else 'user'::public.user_role end
 where id in (select pg_temp.pv_id('user', n) from generate_series(1, 2) n);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.pv_id('user', 1), 'primary');
insert into public.fulfillment_origins(id, code, name, default_carrier, base_fee, return_address, is_active)
 select pg_temp.pv_id('origin', n), 'partial-cancel-v1-origin-'||n, 'TEST 버전1 출고지 '||n, 'hanjin', 3000, 'TEST 반품 주소', true from generate_series(1, 2) n;
insert into public.ips(id, title, vertical_key) values ('partial-cancel-v1-ip', 'TEST 버전1 부분취소 IP', 'character');
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty, origin_id) values
 ('partial-cancel-v1-a', 'partial-cancel-v1-ip', 'TEST 버전1 품절 상품 A', '문구', 10000, 'ok', 10, pg_temp.pv_id('origin', 1)),
 ('partial-cancel-v1-b', 'partial-cancel-v1-ip', 'TEST 버전1 남는 상품 B', '문구', 10000, 'ok', 10, pg_temp.pv_id('origin', 1)),
 ('partial-cancel-v1-c', 'partial-cancel-v1-ip', 'TEST 버전1 다른 출고지 상품 C', '문구', 5000, 'ok', 10, pg_temp.pv_id('origin', 2));
insert into public.coupons(code, name, discount_type, discount_value, starts_at) values ('PCV1-ALL', 'TEST 버전1 전체 쿠폰', 'fixed', 1000, '2026-01-01');
insert into public.coupons(code, name, discount_type, discount_value, starts_at, goods_scope, target_good_ids)
 values ('PCV1-AB', 'TEST 버전1 A·B 쿠폰', 'fixed', 1500, '2026-01-01', 'selected_goods', array['partial-cancel-v1-a', 'partial-cancel-v1-b']);
create function pg_temp.pv_stock(good text) returns integer language sql as $$
 select stock_qty from public.goods_variants where good_id = good and is_default$$;

-- 주문 n(버전 1): A 2개(10,000원, 당시 정가 12,000원) + B 1개(10,000원)는 출고지 1, C 1개(5,000원)는 출고지 2. 배송비 배송 건마다 3,000원.
-- 결제 = 굿즈 35,000 − 쿠폰 − 적립금 + 배송비 6,000 + total_adjust. 배송 건 스냅숏은 주문 배송비 스냅숏과 같은 모양(totalFee).
create function pg_temp.pv_order(n integer, provider text, coupon_code text default null, coupon bigint default 0, eligible bigint default null,
  credit bigint default 0, total_adjust bigint default 0, snapshot_adjust bigint default 0, terms_override jsonb default null, initial text default 'confirmed')
 returns void language plpgsql as $$
declare total bigint := 35000 - coupon - credit + 6000 + total_adjust; lot uuid; terms jsonb;
begin
 insert into public.orders(id, user_id, status, total, shipping_fee, discount_total, store_credit_total, address, payment_method, created_at, confirmed_at,
   shipping_fee_breakdown)
 values (pg_temp.pv_id('order', n), pg_temp.pv_id('user', 2), initial::public.order_status, total, 6000, coupon, credit,
   '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
   (case when provider = 'bank_transfer' then 'bank_transfer' else 'card' end)::public.order_payment_method,
   '2031-03-01T03:00:00Z'::timestamptz, case when initial = 'confirmed' then clock_timestamp() - interval '1 hour' end,
   (select jsonb_agg(jsonb_build_object('originId', pg_temp.pv_id('origin', o), 'originName', 'TEST 버전1 출고지 '||o, 'totalFee', 3000) order by o)
     from generate_series(1, 2) o));
 insert into public.order_items(id, order_id, good_id, variant_id, qty, unit_price, regular_unit_price_snapshot, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
 select pg_temp.pv_id('item-'||right(g.id, 1), n), pg_temp.pv_id('order', n), g.id, v.id, case when g.id = 'partial-cancel-v1-a' then 2 else 1 end, g.price,
   case when g.id = 'partial-cancel-v1-a' then 12000 end, g.name, '문구', 'partial-cancel-v1-ip'
 from public.goods g join public.goods_variants v on v.good_id = g.id and v.is_default where g.id like 'partial-cancel-v1-%';
 insert into public.order_shipments(id, order_id, origin_id, origin_name_snapshot, shipping_fee, shipping_fee_snapshot)
 select pg_temp.pv_id('shipment-'||o, n), pg_temp.pv_id('order', n), pg_temp.pv_id('origin', o), 'TEST 버전1 출고지 '||o, 3000,
   jsonb_build_object('originId', pg_temp.pv_id('origin', o), 'originName', 'TEST 버전1 출고지 '||o, 'totalFee', 3000 + case when o = 1 then snapshot_adjust else 0 end)
 from generate_series(1, 2) o;
 insert into public.order_shipment_items(order_id, shipment_id, order_item_id, qty)
 select i.order_id, pg_temp.pv_id('shipment-'||case when i.good_id = 'partial-cancel-v1-c' then 2 else 1 end, n), i.id, i.qty
 from public.order_items i where i.order_id = pg_temp.pv_id('order', n);
 if coupon_code is not null then
  -- 한 사람은 같은 쿠폰을 한 번만 받으므로 주문마다 같은 조건의 쿠폰을 따로 둔다.
  insert into public.coupons(code, name, discount_type, discount_value, starts_at, goods_scope, target_good_ids, target_category_ids, target_ip_ids)
  select c.code||'-'||n, c.name, c.discount_type, c.discount_value, c.starts_at, c.goods_scope, c.target_good_ids, c.target_category_ids, c.target_ip_ids
  from public.coupons c where c.code = coupon_code;
  select jsonb_build_object('revision', c.terms_revision, 'goodsScope', c.goods_scope, 'targetGoodIds', to_jsonb(c.target_good_ids), 'discountType', c.discount_type,
    'discountValue', c.discount_value, 'eligibleSubtotal', coalesce(eligible, 35000)) into terms from public.coupons c where c.code = coupon_code||'-'||n;
  insert into public.user_coupons(id, coupon_code, user_id, issued_source, issued_at, status, used_at, used_order_id)
  values (pg_temp.pv_id('user-coupon', n), coupon_code||'-'||n, pg_temp.pv_id('user', 2), 'admin_grant', clock_timestamp() - interval '1 day', 'used', clock_timestamp(), pg_temp.pv_id('order', n));
  insert into public.coupon_redemptions(user_coupon_id, coupon_code, user_id, order_id, discount_amount, eligible_subtotal, terms_snapshot)
  values (pg_temp.pv_id('user-coupon', n), coupon_code||'-'||n, pg_temp.pv_id('user', 2), pg_temp.pv_id('order', n), coupon, coalesce(eligible, 35000),
    coalesce(terms_override, terms));
 end if;
 if credit > 0 then
  lot := private.issue_store_credit_lot(pg_temp.pv_id('user', 2), credit, clock_timestamp() + interval '90 days', 'admin', null, pg_temp.pv_id('user', 1),
    pg_temp.pv_id('credit-op', n), 'TEST 버전1 적립금');
  update private.store_credit_lots set available_amount = available_amount - credit, spent_amount = spent_amount + credit where id = lot;
  insert into private.store_credit_allocations(order_id, user_id, lot_id, amount, state, original_expires_at, restore_grace_days, consumed_at)
  select pg_temp.pv_id('order', n), pg_temp.pv_id('user', 2), id, credit, 'consumed', expires_at, 30, clock_timestamp() from private.store_credit_lots where id = lot;
 end if;
 insert into public.payments(id, user_id, provider, purpose, ref_id, amount, status, payment_key, idempotency_key, created_at)
 values (pg_temp.pv_id('payment', n), pg_temp.pv_id('user', 2), provider::public.payment_provider, 'order', pg_temp.pv_id('order', n), total, 'paid',
   case when provider = 'bank_transfer' then 'bank_transfer:'||pg_temp.pv_id('order', n) else 'TEST-PCV1-KEY-'||n end, 'partial-cancel-v1-payment-'||n,
   clock_timestamp() - interval '2 hours');
 insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, currency, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values (pg_temp.pv_id('attempt', n), provider::public.payment_provider, pg_temp.pv_id('user', 2), 'order', pg_temp.pv_id('order', n), total, 'KRW', 'approved',
   'partial-cancel-v1-attempt-'||n, 'TEST-PCV1-ORDER-'||n, 'TEST-PCV1-PRODUCT-'||n, pg_temp.pv_id('payment', n), clock_timestamp() + interval '1 hour');
end $$;
create function pg_temp.pv_items(spec text) returns jsonb language sql as $$
 -- 'a:1,c:1@2' → 주문 2의 A 1개·C 1개
 select jsonb_agg(jsonb_build_object('orderItemId', pg_temp.pv_id('item-'||split_part(part, ':', 1), split_part(spec, '@', 2)::integer),
   'qty', split_part(part, ':', 2)::integer))
 from unnest(string_to_array(split_part(spec, '@', 1), ',')) part$$;
create function pg_temp.pv_start(spec text, op integer, expected bigint, account jsonb default null) returns jsonb language sql as $$
 select public.admin_start_order_partial_cancellation(pg_temp.pv_id('order', split_part(spec, '@', 2)::integer), pg_temp.pv_items(spec),
  'TEST 11/13 통화 — 품절 상품만 취소하고 나머지 먼저 받기', null, false, expected, pg_temp.pv_id('operation', op), account)$$;
create function pg_temp.pv_head(op integer) returns private.order_partial_cancellations language sql security definer as $$
 select * from private.order_partial_cancellations where operation_id = pg_temp.pv_id('operation', op)$$;
create function pg_temp.pv_complete(op integer, amount bigint, n integer) returns text language sql security definer as $$
 select public.service_complete_order_partial_cancellation((pg_temp.pv_head(op)).id, amount, 'TEST-PCV1-KEY-'||n, 'TEST-PCV1-TX-'||op, pg_temp.pv_id('user', 1))$$;
create function pg_temp.pv_alloc(n integer) returns jsonb language sql security definer as $$
 select jsonb_object_agg(right(i.good_id, 1), jsonb_build_array(a.subtotal, a.coupon_discount, a.store_credit_discount, a.paid_goods_total))
 from private.order_v1_price_allocations a join public.order_items i on i.id = a.order_item_id where a.order_id = pg_temp.pv_id('order', n)$$;
create function pg_temp.pv_derived(n integer) returns jsonb language sql security definer as $$
 select jsonb_object_agg(right(i.good_id, 1), jsonb_build_array((x->>'subtotal')::bigint, (x->>'couponDiscount')::bigint, (x->>'storeCreditDiscount')::bigint,
   (x->>'paidGoodsTotal')::bigint))
 from jsonb_array_elements(private.order_v1_allocation_derive(pg_temp.pv_id('order', n))->'items') x join public.order_items i on i.id = (x->>'orderItemId')::uuid$$;
create function pg_temp.pv_heads(n integer) returns bigint language sql security definer as $$
 select count(*) from private.order_v1_price_allocation_heads where order_id = pg_temp.pv_id('order', n)$$;
grant execute on function pg_temp.pv_items(text), pg_temp.pv_start(text, integer, bigint, jsonb), pg_temp.pv_stock(text), pg_temp.pv_head(integer),
 pg_temp.pv_heads(integer) to authenticated;

-- 1: 토스, 전체 쿠폰 1,000원 + 적립금 2,000원(결제 38,000원). 2: 1과 같은 모양 — 부분 취소하지 않는다(기존 경로 불변).
-- 3: 토스, A·B 대상 쿠폰 1,500원(대상 품목 합계 30,000원) + 적립금 1,000원(결제 38,500원). 4: 무통장(발주확인 전), 전체 쿠폰 1,000원(결제 40,000원).
-- 5: 결제액을 손으로 500원 줄인 주문. 6: 배송 건 배송비와 배송비 스냅숏이 다른 주문. 7: 쿠폰 대상 품목 합계 기록이 다른 주문.
-- 8: 쿠폰 할인이 있는데 쿠폰 기록이 없는 주문. 9: 버전 1에 없는 복수구매 할인이 있는 주문. 10: 할인 없는 토스 주문(결제 41,000원).
select pg_temp.pv_order(1, 'toss', 'PCV1-ALL', 1000, null, 2000), pg_temp.pv_order(2, 'toss', 'PCV1-ALL', 1000, null, 2000),
 pg_temp.pv_order(3, 'toss', 'PCV1-AB', 1500, 30000, 1000), pg_temp.pv_order(4, 'bank_transfer', 'PCV1-ALL', 1000, initial => 'paid'),
 pg_temp.pv_order(5, 'toss', 'PCV1-ALL', 1000, null, 0, -500), pg_temp.pv_order(6, 'toss', 'PCV1-ALL', 1000, null, 0, 0, -500),
 pg_temp.pv_order(7, 'toss', 'PCV1-ALL', 1000, 30000), pg_temp.pv_order(8, 'toss', null, 0), pg_temp.pv_order(9, 'toss'),
 pg_temp.pv_order(10, 'toss'), pg_temp.pv_order(11, 'toss'), pg_temp.pv_order(12, 'toss'), pg_temp.pv_order(13, 'toss', 'PCV1-ALL', 1500);
update public.orders set discount_total = 1000, total = total - 1000 where id = pg_temp.pv_id('order', 8);
update public.payments set amount = amount - 1000 where id = pg_temp.pv_id('payment', 8);
update public.payment_attempts set amount = amount - 1000 where id = pg_temp.pv_id('attempt', 8);
update public.orders set volume_discount_total = 1000 where id = pg_temp.pv_id('order', 9);
-- 11: 버전 1에 없는 배송비 쿠폰 할인이 기록된 주문(결제액은 그만큼 적다).
update public.orders set shipping_coupon_discount_total = 3000, total = total - 3000 where id = pg_temp.pv_id('order', 11);
update public.payments set amount = amount - 3000 where id = pg_temp.pv_id('payment', 11);
update public.payment_attempts set amount = amount - 3000 where id = pg_temp.pv_id('attempt', 11);
-- 12: 사용 적립금(36,000원)이 상품 금액(35,000원)보다 큰 주문 — 적립금을 상품에 나눌 수 없다.
update public.orders set store_credit_total = 36000, total = total - 36000 where id = pg_temp.pv_id('order', 12);
update public.payments set amount = amount - 36000 where id = pg_temp.pv_id('payment', 12);
update public.payment_attempts set amount = amount - 36000 where id = pg_temp.pv_id('attempt', 12);
-- 13: 주문 쿠폰 할인(1,500원)과 주문 당시 쿠폰 기록(1,000원)이 다른 주문(결제액은 주문 할인과 맞는다).
update public.coupon_redemptions set discount_amount = 1000 where order_id = pg_temp.pv_id('order', 13);
-- 14: IP 쿠폰(C는 다른 IP) 1,500원 + 적립금 1,000원. 15·16: 카테고리 쿠폰(A·B는 대상 분류의 하위 분류 상품) 1,500원 + 적립금 1,000원. 17: 카테고리 대상 기록이 배열이 아닌 주문.
insert into public.ips(id, title, vertical_key) values ('partial-cancel-v1-ip2', 'TEST 버전1 부분취소 다른 IP', 'character');
insert into public.catalog_categories(id, code, name, parent_id, depth) values
 (pg_temp.pv_id('category', 1), 'pcv1-root', 'TEST 버전1 쿠폰 대상 분류', null, 1),
 (pg_temp.pv_id('category', 2), 'pcv1-child', 'TEST 버전1 쿠폰 대상 하위 분류', pg_temp.pv_id('category', 1), 2);
update public.goods set category_id = pg_temp.pv_id('category', 2) where id in ('partial-cancel-v1-a', 'partial-cancel-v1-b');
insert into public.coupons(code, name, discount_type, discount_value, starts_at, goods_scope, target_ip_ids)
 values ('PCV1-IP', 'TEST 버전1 IP 쿠폰', 'fixed', 1500, '2026-01-01', 'selected_ips', array['partial-cancel-v1-ip']);
insert into public.coupons(code, name, discount_type, discount_value, starts_at, goods_scope, target_category_ids)
 values ('PCV1-CAT', 'TEST 버전1 분류 쿠폰', 'fixed', 1500, '2026-01-01', 'selected_categories', array[pg_temp.pv_id('category', 1)]);
select pg_temp.pv_order(14, 'toss', 'PCV1-IP', 1500, 30000, 1000, terms_override => jsonb_build_object('revision', 1, 'goodsScope', 'selected_ips',
  'targetGoodIds', '[]'::jsonb, 'targetIpIds', jsonb_build_array('partial-cancel-v1-ip'), 'discountType', 'fixed', 'discountValue', 1500)),
 pg_temp.pv_order(15, 'toss', 'PCV1-CAT', 1500, 30000, 1000, terms_override => jsonb_build_object('revision', 1, 'goodsScope', 'selected_categories',
  'targetGoodIds', '[]'::jsonb, 'targetCategoryIds', jsonb_build_array(pg_temp.pv_id('category', 1)), 'discountType', 'fixed', 'discountValue', 1500)),
 pg_temp.pv_order(16, 'toss', 'PCV1-CAT', 1500, 30000, 1000, terms_override => jsonb_build_object('revision', 1, 'goodsScope', 'selected_categories',
  'targetGoodIds', '[]'::jsonb, 'targetCategoryIds', jsonb_build_array(pg_temp.pv_id('category', 1)), 'discountType', 'fixed', 'discountValue', 1500)),
 pg_temp.pv_order(17, 'toss', 'PCV1-CAT', 1500, 30000, 1000, terms_override => jsonb_build_object('revision', 1, 'goodsScope', 'selected_categories',
  'targetGoodIds', '[]'::jsonb, 'targetCategoryIds', to_jsonb('not-an-array'::text), 'discountType', 'fixed', 'discountValue', 1500));
update public.order_items set good_ip_id_snapshot = 'partial-cancel-v1-ip2' where id = pg_temp.pv_id('item-c', 14);
update private.return_fee_deduction_settings set partial_cancel_enabled = true, partial_cancel_evidence = 'TEST 버전1 부분 취소 시험',
 partial_cancel_enabled_at = clock_timestamp() where singleton;
-- END FIXTURE

-- 1. 배분 ---------------------------------------------------------------------------------------------------------------
-- 쿠폰 1,000원을 20,000:10,000:5,000으로 나누면 571.4·285.7·142.9 → 내림 571·285·142(998원), 끝수 2원은 나머지가 큰 C·B에 → 571·286·143.
-- 적립금 2,000원을 쿠폰 뒤 19,429:9,714:4,857로 나누면 1,142.9·571.4·285.7 → 1,142·571·285, 끝수 2원은 A·C에 → 1,143·571·286.
select pg_temp.pv_assert(pg_temp.pv_derived(1) = '{"a": [20000, 571, 1143, 18286], "b": [10000, 286, 571, 9143], "c": [5000, 143, 286, 4571]}',
 'v1_coupon_and_credit_largest_remainder');
select pg_temp.pv_assert((select (d->>'ok')::boolean and (d->>'paidGoodsTotal')::bigint = 32000 and (d->>'shippingTotal')::bigint = 6000
   and (d->>'paidGoodsTotal')::bigint + (d->>'shippingTotal')::bigint = (select amount from public.payments where id = pg_temp.pv_id('payment', 1))
   and (d->>'goodsTotal')::bigint - (d->>'couponDiscountTotal')::bigint - (d->>'storeCreditTotal')::bigint = (d->>'paidGoodsTotal')::bigint
   and (select sum((x->>'prepaidShippingFee')::bigint) from jsonb_array_elements(d->'shipments') x) = 6000
   and d->>'ruleVersion' = 'v1-a5-largest-remainder-1'
  from (select private.order_v1_allocation_derive(pg_temp.pv_id('order', 1)) d) s), 'v1_allocation_sum_equals_payment');
-- 대상 품목 쿠폰: A·B만 대상이라 C 몫은 0원(대상 품목 금액 비례). 적립금 1,000원은 쿠폰 뒤 금액 19,000:9,500:5,000 비례
-- (567.2·283.6·149.3 → 567·283·149, 끝수 1원은 B) — 품목 총액 비례(571·286·143)와 다르다.
select pg_temp.pv_assert(pg_temp.pv_derived(3) = '{"a": [20000, 1000, 567, 18433], "b": [10000, 500, 284, 9216], "c": [5000, 0, 149, 4851]}',
 'v1_targeted_coupon_only_on_target_items');
select pg_temp.pv_assert(pg_temp.pv_derived(10) = '{"a": [20000, 0, 0, 20000], "b": [10000, 0, 0, 10000], "c": [5000, 0, 0, 5000]}',
 'v1_no_discount_allocation_is_gross');

-- 2. 결정성 -------------------------------------------------------------------------------------------------------------
select pg_temp.pv_assert(private.order_v1_allocation_derive(pg_temp.pv_id('order', 1)) = private.order_v1_allocation_derive(pg_temp.pv_id('order', 1))
 and private.order_v1_allocation_derive(pg_temp.pv_id('order', 1))->>'inputHash' ~ '^[0-9a-f]{64}$'
 and private.order_v1_allocation_derive(pg_temp.pv_id('order', 1))->>'inputHash' <> private.order_v1_allocation_derive(pg_temp.pv_id('order', 2))->>'inputHash',
 'v1_derive_deterministic');
set local role authenticated;
select pg_temp.pv_auth();
select pg_temp.pv_assert((select context->'blockers' = '[]'::jsonb and (context->>'calculationVersion')::integer = 1
   and context->'v1Allocation' = '{"frozen": false, "issue": null}'::jsonb and (context->>'balance')::bigint = 38000
   and not exists(select 1 from jsonb_array_elements(context->'items') item where item->>'blocker' is not null)
  from (select public.admin_order_partial_cancellation_context(pg_temp.pv_id('order', 1)) context) s), 'v1_context_open');
-- 미리보기: A 1개 = 결제 몫 18,286원의 절반(내림) 9,143원, 쿠폰 몫 285원, 적립금 몫 571원(적립금으로 되돌림).
select pg_temp.pv_assert((select plan @> '{"provider": "toss", "goodsRefundAmount": 9143, "shippingRefundAmount": 0, "refundAmount": 9143,
   "balanceBefore": 38000, "balanceAfter": 28857, "storeCreditRestoreAmount": 571, "closedShipments": []}'
   and plan->'lines'->0 @> '{"qty": 1, "orderedQty": 2, "couponDiscount": 285, "storeCreditDiscount": 571, "goodsRefundAmount": 9143}'
  from (select public.admin_preview_order_partial_cancellation(pg_temp.pv_id('order', 1), pg_temp.pv_items('a:1@1')) plan) s), 'v1_preview_uses_derived_share');
select pg_temp.pv_assert(pg_temp.pv_heads(1) = 0, 'v1_preview_does_not_freeze');
reset role;
select private.order_v1_allocation_derive(pg_temp.pv_id('order', 1)) as derived_before \gset
set local role authenticated;
select pg_temp.pv_auth();
select pg_temp.pv_assert((pg_temp.pv_start('a:1@1', 1, 9143))->>'state' = 'processing', 'v1_first_partial_started');
reset role;
-- 시작이 미리보기와 같은 계산을 그대로 얼렸다: 머리·품목 줄·배송 건이 계산 결과와 1원 단위까지 같고, 입력 해시도 같다.
select pg_temp.pv_assert(pg_temp.pv_heads(1) = 1 and pg_temp.pv_alloc(1) = pg_temp.pv_derived(1)
 and (select input_hash = :'derived_before'::jsonb->>'inputHash' and input_snapshot = :'derived_before'::jsonb->'input'
   and payment_amount = 38000 and paid_goods_total = 32000 and shipping_total = 6000 and coupon_discount_total = 1000 and store_credit_total = 2000
   and frozen_by = pg_temp.pv_id('user', 1) and frozen_operation_id = pg_temp.pv_id('operation', 1)
  from private.order_v1_price_allocation_heads where order_id = pg_temp.pv_id('order', 1))
 and (select jsonb_object_agg(shipment_id, prepaid_shipping_fee) from private.order_v1_shipment_allocations where order_id = pg_temp.pv_id('order', 1))
   = jsonb_build_object(pg_temp.pv_id('shipment-1', 1), 3000, pg_temp.pv_id('shipment-2', 1), 3000)
 and exists(select 1 from public.audit_log where action = 'admin.order.v1_allocation_frozen' and target = 'order:'||pg_temp.pv_id('order', 1)
   and diff->>'inputHash' = :'derived_before'::jsonb->>'inputHash' and (diff->>'paidGoodsTotal')::bigint = 32000)
 and (select line.coupon_discount = 285 and line.store_credit_discount = 571 and line.goods_refund_amount = 9143
  from private.order_partial_cancellation_items line where line.partial_cancellation_id = (pg_temp.pv_head(1)).id), 'v1_start_freezes_same_allocation');
-- 원장은 바뀌지도 지워지지도 않는다.
select pg_temp.pv_error(format('update private.order_v1_price_allocations set coupon_discount = 0 where order_id = %L', pg_temp.pv_id('order', 1)), 'v1_allocation_immutable');
select pg_temp.pv_error(format('delete from private.order_v1_price_allocations where order_id = %L', pg_temp.pv_id('order', 1)), 'v1_allocation_immutable');
select pg_temp.pv_error(format('update private.order_v1_price_allocation_heads set input_hash = repeat(%L, 64) where order_id = %L', '0', pg_temp.pv_id('order', 1)), 'v1_allocation_immutable');
select pg_temp.pv_error(format('delete from private.order_v1_shipment_allocations where order_id = %L', pg_temp.pv_id('order', 1)), 'v1_allocation_immutable');
select pg_temp.pv_error(format('insert into private.order_v1_price_allocation_heads select * from private.order_v1_price_allocation_heads where order_id = %L', pg_temp.pv_id('order', 1)), '23505');
-- 원장을 직접 넣어도 합계 제약이 결제액과 맞지 않는 머리를 거절한다.
select pg_temp.pv_error(format($q$insert into private.order_v1_price_allocation_heads(order_id, payment_id, source_calculation_version, rule_version, input_hash,
  input_snapshot, payment_amount, goods_total, volume_discount_total, coupon_discount_total, store_credit_total, paid_goods_total, shipping_total, frozen_by, frozen_operation_id)
  values (%L, %L, 1, 'v1-a5-largest-remainder-1', repeat('a', 64), '{}', 37500, 35000, 0, 1000, 0, 34000, 6000, %L, %L)$q$,
  pg_temp.pv_id('order', 5), pg_temp.pv_id('payment', 5), pg_temp.pv_id('user', 1), pg_temp.pv_id('operation', 99)), '23514');

-- 3. 토스 다회 부분 취소 → 운영자 전액 취소 remainder ---------------------------------------------------------------------
select pg_temp.pv_assert(pg_temp.pv_complete(1, 9143, 1) = 'completed', 'v1_first_partial_completed');
select pg_temp.pv_assert(pg_temp.pv_stock('partial-cancel-v1-a') = 11
 and (select amount = 1429 and state = 'consumed' from private.store_credit_allocations where order_id = pg_temp.pv_id('order', 1))
 and (select coalesce(sum(issued_amount), 0) = 571 from private.store_credit_lots where source_order_id = pg_temp.pv_id('order', 1) and source_kind = 'restoration'),
 'v1_first_partial_applied_with_credit_share');
-- 얼린 뒤 입력이 바뀌어도(출고지 2 배송 건 배송비·스냅숏을 손으로 2,500원으로 바꿈) 같은 주문의 계산은 얼린 원장(3,000원)을 쓴다
-- — 다시 계산하면 배송비 합이 주문 배송비와 달라 막혔을 주문이다.
update public.order_shipments set shipping_fee = 2500, shipping_fee_snapshot = shipping_fee_snapshot || '{"totalFee": 2500}' where id = pg_temp.pv_id('shipment-2', 1);
select pg_temp.pv_assert(private.order_v1_allocation_derive(pg_temp.pv_id('order', 1))->>'issue' = 'shipping_snapshot_mismatch'
 and private.order_v1_allocation_blockers(pg_temp.pv_id('order', 1)) = array[]::text[]
 and private.order_shipment_prepaid_fee(pg_temp.pv_id('shipment-2', 1)) = 3000, 'v1_frozen_ledger_ignores_later_input_change');
set local role authenticated;
select pg_temp.pv_auth();
-- 출고 파일: A는 남은 1개의 몫(18,286 − 9,143), 할인액 = (정가 12,000 − 10,000) × 1 + 쿠폰·적립금 몫 1,714 − 취소분 856. B는 그대로.
select pg_temp.pv_assert((select jsonb_object_agg(line->>'goodName', jsonb_build_array((line->>'qty')::integer, (line#>>'{smartstore,itemTotal}')::bigint,
   (line#>>'{smartstore,itemDiscount}')::bigint))
  from jsonb_array_elements(public.admin_smartstore_shipment_export(array[pg_temp.pv_id('shipment-1', 1)])#>'{shipments,0,lines}') line)
 = '{"TEST 버전1 품절 상품 A": [1, 9143, 2858], "TEST 버전1 남는 상품 B": [1, 9143, null]}'::jsonb, 'v1_export_uses_remaining_share');
select pg_temp.pv_assert((select jsonb_object_agg(line->>'goodName', (line->>'itemTotal')::bigint)
  from jsonb_array_elements(public.admin_delivery_list_export_lines(array[pg_temp.pv_id('shipment-1', 1)])) line)
 = '{"TEST 버전1 품절 상품 A": 9143, "TEST 버전1 남는 상품 B": 9143}'::jsonb, 'v1_delivery_list_uses_remaining_share');
-- 두 번째: A 나머지 + C → 출고지 2 배송 건이 비어 닫히고 배송비 3,000원(얼린 원장 값)을 함께 환불. 원장은 그대로 하나.
select pg_temp.pv_assert((select plan @> '{"goodsRefundAmount": 13714, "shippingRefundAmount": 3000, "refundAmount": 16714, "balanceBefore": 28857,
   "balanceAfter": 12143, "storeCreditRestoreAmount": 858}' and plan->'closedShipments'->0->>'shippingFeeRefund' = '3000'
  from (select public.admin_preview_order_partial_cancellation(pg_temp.pv_id('order', 1), pg_temp.pv_items('a:1,c:1@1')) plan) s), 'v1_second_partial_from_frozen');
select pg_temp.pv_start('a:1,c:1@1', 2, 16714);
reset role;
select pg_temp.pv_assert(pg_temp.pv_complete(2, 16714, 1) = 'completed', 'v1_second_partial_completed');
select pg_temp.pv_assert(pg_temp.pv_heads(1) = 1
 and (select status = 'canceled' from public.order_shipments where id = pg_temp.pv_id('shipment-2', 1))
 and private.payment_partial_refunded_amount(pg_temp.pv_id('payment', 1)) = 25857
 and (select amount = 571 from private.store_credit_allocations where order_id = pg_temp.pv_id('order', 1)), 'v1_second_partial_applied');
set local role authenticated;
select pg_temp.pv_auth();
select public.admin_start_order_cancellation(pg_temp.pv_id('order', 1), 'out_of_stock', null, false) as v1_remainder_request \gset
reset role;
-- 남은 잔액 12,143원 = B 결제 몫 9,143 + 출고지 1 배송비 3,000. 부분 취소 9,143 + 16,714 + 남은 잔액 12,143 = 결제액 38,000.
select pg_temp.pv_assert((select amount = 12143 and status = 'requested' from public.refunds where payment_id = pg_temp.pv_id('payment', 1))
 and 9143 + 16714 + 12143 = (select amount from public.payments where id = pg_temp.pv_id('payment', 1)), 'v1_remainder_intent_sums_to_payment');
select public.complete_order_cancellation_request(:'v1_remainder_request', array['TEST-PCV1-KEY-1'], pg_temp.pv_id('user', 1));
select pg_temp.pv_assert((select amount = 12143 and status = 'done' from public.refunds where payment_id = pg_temp.pv_id('payment', 1))
 and (select status = 'canceled' from public.orders where id = pg_temp.pv_id('order', 1))
 and (select sum(refund_amount) from private.order_partial_cancellations where order_id = pg_temp.pv_id('order', 1) and applied_at is not null)
   + (select amount from public.refunds where payment_id = pg_temp.pv_id('payment', 1)) = 38000
 and (select coalesce(sum(issued_amount), 0) = 2000 from private.store_credit_lots where source_order_id = pg_temp.pv_id('order', 1) and source_kind = 'restoration')
 and pg_temp.pv_stock('partial-cancel-v1-a') = 12 and pg_temp.pv_stock('partial-cancel-v1-b') = 11 and pg_temp.pv_stock('partial-cancel-v1-c') = 11,
 'v1_remainder_cancel_completes_payment');
create function pg_temp.pv_settlement(tx text, amount text) returns jsonb language sql as $$
 select private.pg_settlement_match(jsonb_build_object('orderId', 'TEST-PCV1-ORDER-1', 'paymentKey', 'TEST-PCV1-KEY-1', 'currency', 'KRW', 'amount', '38000',
  'transactionKey', tx, 'cancel', jsonb_build_object('cancelAmount', amount, 'canceledAt', '2031-03-02T00:00:00+09:00', 'transactionKey', tx)))$$;
select pg_temp.pv_assert(pg_temp.pv_settlement('TEST-PCV1-TX-1', '9143') @> '{"state": "matched"}'
 and pg_temp.pv_settlement('TEST-PCV1-TX-2', '16714') @> '{"state": "matched"}'
 and pg_temp.pv_settlement('TEST-PCV1-TX-2', '16000') @> '{"state": "mismatch", "reason": "refund_amount_mismatch"}', 'v1_partial_settlement_matches');

-- 대상 품목 쿠폰 주문(3): C(쿠폰 대상 아님)를 빼면 C 결제 몫 4,851원(적립금 몫 149원은 적립금으로) + 출고지 2 배송비 3,000원.
set local role authenticated;
select pg_temp.pv_auth();
select pg_temp.pv_start('c:1@3', 3, 7851);
reset role;
select pg_temp.pv_assert(pg_temp.pv_complete(3, 7851, 3) = 'completed', 'v1_targeted_partial_completed');
select pg_temp.pv_assert(pg_temp.pv_alloc(3) = '{"a": [20000, 1000, 567, 18433], "b": [10000, 500, 284, 9216], "c": [5000, 0, 149, 4851]}'
 and (select store_credit_restore_amount = 149 from private.order_partial_cancellations where id = (pg_temp.pv_head(3)).id)
 and private.claim_refund_settled_amount(pg_temp.pv_id('payment', 3)) = 30649, 'v1_targeted_coupon_partial');

-- 4. 무통장 버전 1 --------------------------------------------------------------------------------------------------------
-- 쿠폰 1,000원 → A 19,429 · B 9,714 · C 4,857(결제 40,000원). A 1개 → 9,714원, B 1개 → 9,714원(두 번째도 같은 원장).
set local role authenticated;
select pg_temp.pv_auth();
select pg_temp.pv_assert((pg_temp.pv_start('a:1@4', 4, 9714, '{"bankName":"TEST 합성은행","accountNumber":"000000001234","accountHolder":"TEST 구매자"}'))->>'state'
 = 'awaiting_transfer', 'v1_bank_first_awaiting_transfer');
select pg_temp.pv_assert((pg_temp.pv_start('b:1@4', 5, 9714, '{"bankName":"TEST 합성은행","accountNumber":"000000001234","accountHolder":"TEST 구매자"}'))->>'state'
 = 'awaiting_transfer', 'v1_bank_second_awaiting_transfer');
reset role;
select pg_temp.pv_assert(pg_temp.pv_heads(4) = 1 and pg_temp.pv_alloc(4) = '{"a": [20000, 571, 0, 19429], "b": [10000, 286, 0, 9714], "c": [5000, 143, 0, 4857]}'
 and private.payment_partial_refunded_amount(pg_temp.pv_id('payment', 4)) = 19428
 and private.claim_refund_settled_amount(pg_temp.pv_id('payment', 4)) = 20572 and private.claim_refund_active_deduction(pg_temp.pv_id('payment', 4)) = 19428
 and pg_temp.pv_stock('partial-cancel-v1-a') = 13 and pg_temp.pv_stock('partial-cancel-v1-b') = 12, 'v1_bank_partials_share_one_ledger');
insert into public.order_cancellation_requests(id, order_id, requested_by, reason, claim_type, stage, collection_policy, requested_at)
 values (pg_temp.pv_id('claim', 4), pg_temp.pv_id('order', 4), pg_temp.pv_id('user', 2), 'TEST 버전1 무통장 전액 취소', 'cancel', 'processing', 'origin', clock_timestamp() - interval '40 minutes');
insert into public.order_cancellation_claims(order_id, requested_by, previous_status) values (pg_temp.pv_id('order', 4), pg_temp.pv_id('user', 2), 'paid');
insert into public.refunds(payment_id, amount, status, cancellation_request_id) values (pg_temp.pv_id('payment', 4), 20572, 'requested', pg_temp.pv_id('claim', 4));
insert into private.claim_refund_accounts(claim_id, bank_name, account_number, account_holder, masked_account, masked_holder)
 values (pg_temp.pv_id('claim', 4), 'TEST 합성은행', '000000001234', 'TEST 합성구매자', 'TEST 합성은행 ********1234', 'T*********');
select claim_revision as bank_rev from public.order_cancellation_requests where id = pg_temp.pv_id('claim', 4) \gset
set local role authenticated;
select pg_temp.pv_auth();
select pg_temp.pv_assert(public.admin_record_bank_transfer_refund(pg_temp.pv_id('order', 4), pg_temp.pv_id('claim', 4), pg_temp.pv_id('operation', 41), 'confirm_cancellation',
  :bank_rev, 40000, clock_timestamp(), 'TEST 증빙', 'TEST-ONLY 합성 무통장 취소 확정. 실제 송금 없음.', true, pg_temp.pv_id('user', 1), pg_temp.pv_id('session', 1))
 @> '{"state": "recorded"}', 'v1_bank_remainder_confirmed');
reset role;
-- 송금 대기 원장(남은 잔액) + 부분 취소 송금 대기 두 건 = 결제액 40,000원.
select pg_temp.pv_assert((select amount = 20572 and state = 'awaiting_transfer' from private.bank_transfer_claim_refunds where order_id = pg_temp.pv_id('order', 4))
 and (select amount from private.bank_transfer_claim_refunds where order_id = pg_temp.pv_id('order', 4))
   + (select sum(refund_amount) from private.order_partial_cancellations where order_id = pg_temp.pv_id('order', 4)) = 40000, 'v1_bank_remainder_sums_to_payment');

-- 5. 막힘: 배분을 확정할 수 없는 주문은 이유와 함께 막고 원장을 만들지 않는다 ------------------------------------------------
set local role authenticated;
select pg_temp.pv_auth();
select pg_temp.pv_assert((select jsonb_object_agg(n, jsonb_build_array(c->'blockers', c#>'{v1Allocation,issue}'))
  from unnest(array[5, 6, 7, 8, 9, 11, 12, 13]) n cross join lateral (select public.admin_order_partial_cancellation_context(pg_temp.pv_id('order', n)) c) s)
 = '{"5": [["partial_cancel_v1_allocation_mismatch"], "amount_mismatch"], "6": [["partial_cancel_v1_allocation_mismatch"], "shipping_snapshot_mismatch"],
     "7": [["partial_cancel_v1_allocation_unavailable"], "coupon_target_mismatch"], "8": [["partial_cancel_v1_allocation_unavailable"], "coupon_unrecorded"],
     "9": [["partial_cancel_v1_allocation_unavailable"], "unsupported_discount"], "11": [["partial_cancel_v1_allocation_unavailable"], "unsupported_discount"],
     "12": [["partial_cancel_v1_allocation_mismatch"], "credit_mismatch"], "13": [["partial_cancel_v1_allocation_mismatch"], "coupon_amount_mismatch"]}'::jsonb,
 'v1_unallocatable_orders_blocked_with_reason');
select pg_temp.pv_assert((select bool_and(item->>'blocker' = 'allocation_missing') from jsonb_array_elements(public.admin_order_partial_cancellation_context(pg_temp.pv_id('order', 5))->'items') item),
 'v1_unallocatable_items_marked');
select pg_temp.pv_error($$select public.admin_preview_order_partial_cancellation(pg_temp.pv_id('order', 5), pg_temp.pv_items('a:1@5'))$$, 'partial_cancel_v1_allocation_mismatch');
select pg_temp.pv_error($$select pg_temp.pv_start('a:1@5', 50, 9000)$$, 'partial_cancel_v1_allocation_mismatch');
select pg_temp.pv_error($$select pg_temp.pv_start('a:1@6', 60, 9000)$$, 'partial_cancel_v1_allocation_mismatch');
select pg_temp.pv_error($$select pg_temp.pv_start('a:1@8', 80, 9000)$$, 'partial_cancel_v1_allocation_unavailable');
reset role;
select pg_temp.pv_assert((select count(*) from private.order_v1_price_allocation_heads where order_id in (select pg_temp.pv_id('order', n) from unnest(array[5, 6, 7, 8, 9, 11, 12, 13]) n)) = 0
 and not exists(select 1 from private.order_partial_cancellations where order_id in (select pg_temp.pv_id('order', n) from unnest(array[5, 6, 7, 8, 9, 11, 12, 13]) n)),
 'v1_blocked_orders_have_no_ledger');
select pg_temp.pv_error(format('select private.freeze_order_v1_allocation(%L, %L, %L)', pg_temp.pv_id('order', 5), pg_temp.pv_id('user', 1), pg_temp.pv_id('operation', 51)),
 'partial_cancel_v1_allocation_mismatch');
-- 원장이 없는 버전 1 주문의 배송 건은 seam이 배분을 확정할 수 없으면 거절한다(0원으로 환불하지 않는다).
select pg_temp.pv_error(format('select private.order_shipment_prepaid_fee(%L)', pg_temp.pv_id('shipment-1', 5)), 'partial_cancel_v1_allocation_unavailable');

-- 5b. 쿠폰 대상 범위: IP·카테고리(하위 분류 상품 포함) 쿠폰은 대상 품목 금액 비례로 나눈다(주문 3과 같은 모양). 대상 분류를 보관하면 대상을 다시 가릴 수 없어
--     배분을 확정할 수 없음(unavailable)으로 막는다. 대상 기록이 깨진 쿠폰은 기록 없음(unavailable)이다.
select pg_temp.pv_assert(pg_temp.pv_derived(14) = '{"a": [20000, 1000, 567, 18433], "b": [10000, 500, 284, 9216], "c": [5000, 0, 149, 4851]}'
 and private.order_v1_allocation_derive(pg_temp.pv_id('order', 14))->>'ruleVersion' = 'v1-a5-largest-remainder-1', 'v1_ip_coupon_targets_ip_items');
select pg_temp.pv_assert(pg_temp.pv_derived(15) = '{"a": [20000, 1000, 567, 18433], "b": [10000, 500, 284, 9216], "c": [5000, 0, 149, 4851]}',
 'v1_category_coupon_includes_descendant_goods');
update public.catalog_categories set archived_at = clock_timestamp() where id = pg_temp.pv_id('category', 1);
select pg_temp.pv_assert(private.order_v1_allocation_derive(pg_temp.pv_id('order', 16))->>'issue' = 'coupon_target_mismatch'
 and private.order_v1_allocation_blockers(pg_temp.pv_id('order', 16)) = array['partial_cancel_v1_allocation_unavailable']
 and private.order_v1_allocation_derive(pg_temp.pv_id('order', 17))->>'issue' = 'coupon_unrecorded'
 and private.order_v1_allocation_blockers(pg_temp.pv_id('order', 17)) = array['partial_cancel_v1_allocation_unavailable'], 'v1_archived_target_category_blocks_unavailable');
set local role authenticated;
select pg_temp.pv_auth();
select pg_temp.pv_error($$select pg_temp.pv_start('a:1@16', 160, 9000)$$, 'partial_cancel_v1_allocation_unavailable');
reset role;
select pg_temp.pv_assert(pg_temp.pv_heads(16) = 0 and pg_temp.pv_heads(17) = 0, 'v1_archived_category_order_has_no_ledger');

-- 6. 부분 취소가 없는 버전 1 주문(2·10)의 기존 경로는 그대로다 --------------------------------------------------------------
set local role authenticated;
select pg_temp.pv_auth();
-- 문맥·미리보기를 열어도 원장은 생기지 않는다.
select public.admin_order_partial_cancellation_context(pg_temp.pv_id('order', 2));
select public.admin_preview_order_partial_cancellation(pg_temp.pv_id('order', 2), pg_temp.pv_items('a:1@2'));
select pg_temp.pv_assert(pg_temp.pv_heads(2) = 0, 'v1_untouched_order_has_no_ledger');
-- 출고 파일: 할인 주문은 품목 금액 빈칸(앱이 공통 배분으로 채운다), 할인 없는 주문은 단가 × 주문 수량 — 이 변경 전과 같다.
select pg_temp.pv_assert((select jsonb_agg((line#>'{smartstore,itemTotal}') order by line->>'goodName')
  from jsonb_array_elements(public.admin_smartstore_shipment_export(array[pg_temp.pv_id('shipment-1', 2)])#>'{shipments,0,lines}') line) = '[null, null]'::jsonb
 and (select jsonb_agg(jsonb_build_array((line#>>'{smartstore,itemTotal}')::bigint, (line#>>'{smartstore,itemDiscount}')::bigint) order by line->>'goodName')
  from jsonb_array_elements(public.admin_smartstore_shipment_export(array[pg_temp.pv_id('shipment-1', 10)])#>'{shipments,0,lines}') line) = '[[10000, null], [20000, 4000]]'::jsonb
 and (select jsonb_agg((line->'itemTotal') order by line->>'goodName', (line->>'itemTotal')::bigint nulls first)
  from jsonb_array_elements(public.admin_delivery_list_export_lines(array[pg_temp.pv_id('shipment-1', 2), pg_temp.pv_id('shipment-1', 10)])) line)
   = '[null, 10000, null, 20000]'::jsonb,
 'v1_untouched_exports_unchanged');
-- 배분 입력: 원장이 없으면 품목 배분은 비어 있다(앱이 주문 당시 기록으로 계산). 원장이 있는 주문 1은 얼린 값을 싣는다.
select pg_temp.pv_assert((select bool_and(item->'allocation' = 'null'::jsonb) from jsonb_array_elements(public.admin_order_item_allocation_inputs(array[pg_temp.pv_id('order', 2)])#>'{0,items}') item)
 and (select jsonb_object_agg(item->>'goodId', item->'allocation') from jsonb_array_elements(public.admin_order_item_allocation_inputs(array[pg_temp.pv_id('order', 1)])#>'{0,items}') item)
   = '{"partial-cancel-v1-a": {"volumeDiscount": 0, "couponDiscount": 571, "storeCreditDiscount": 1143, "paidGoodsTotal": 18286},
       "partial-cancel-v1-b": {"volumeDiscount": 0, "couponDiscount": 286, "storeCreditDiscount": 571, "paidGoodsTotal": 9143},
       "partial-cancel-v1-c": {"volumeDiscount": 0, "couponDiscount": 143, "storeCreditDiscount": 286, "paidGoodsTotal": 4571}}'::jsonb,
 'v1_allocation_inputs_only_frozen');
reset role;
-- 환불 금액: 결제액 전액(부분 취소가 없으면 남은 잔액 = 결제액).
select pg_temp.pv_assert(private.claim_refund_settled_amount(pg_temp.pv_id('payment', 2)) = 38000 and private.claim_refund_active_deduction(pg_temp.pv_id('payment', 2)) = 0
 and private.payment_partial_refunded_amount(pg_temp.pv_id('payment', 2)) = 0, 'v1_untouched_refund_amounts_unchanged');
set local role authenticated;
select pg_temp.pv_auth();
select public.admin_start_order_cancellation(pg_temp.pv_id('order', 2), 'out_of_stock', null, false) as v1_full_request \gset
reset role;
select public.complete_order_cancellation_request(:'v1_full_request', array['TEST-PCV1-KEY-2'], pg_temp.pv_id('user', 1));
select pg_temp.pv_assert((select amount = 38000 and status = 'done' from public.refunds where payment_id = pg_temp.pv_id('payment', 2))
 and (select coalesce(sum(issued_amount), 0) = 2000 from private.store_credit_lots where source_order_id = pg_temp.pv_id('order', 2) and source_kind = 'restoration')
 and pg_temp.pv_heads(2) = 0, 'v1_untouched_full_cancel_unchanged');

-- 7. 거래확정 수집: 부분 취소가 있는 버전 1 주문은 얼린 배분과 취소분을 버전 2와 같은 모양으로 싣는다. seam·권한 -------------------
create function pg_temp.pv_ship(n integer) returns void language sql as $$
 update public.order_shipments s set status = 'shipping', shipped_at = clock_timestamp(), carrier = 'hanjin',
   tracking_number = 'TESTPCV1'||lpad((abs(hashtext(s.id::text)) % 1000000)::text, 6, '0')
 where s.order_id = pg_temp.pv_id('order', n) and s.status = 'ready';
 update public.order_shipments s set status = 'delivered', delivered_at = clock_timestamp() where s.order_id = pg_temp.pv_id('order', n) and s.status = 'shipping';$$;
select pg_temp.pv_ship(3);
update public.orders set status = 'done', done_at = clock_timestamp() where id = pg_temp.pv_id('order', 3);
select pg_temp.pv_assert((select o @> '{"calculationVersion": 1, "partialRefundedAmount": 7851}'
   and (select item @> '{"allocation": {"subtotal": 5000, "couponDiscount": 0, "storeCreditDiscount": 149, "paidGoodsTotal": 4851}, "canceledQty": 1, "activeQty": 0,
     "partialCanceledPaidAmount": 4851, "partialCanceledStoreCreditDiscount": 149}'
     from jsonb_array_elements(o->'items') item where item->>'goodId' = 'partial-cancel-v1-c')
   and (select item @> '{"allocation": {"subtotal": 20000, "couponDiscount": 1000, "storeCreditDiscount": 567, "paidGoodsTotal": 18433}}' and not (item ? 'canceledQty')
     from jsonb_array_elements(o->'items') item where item->>'goodId' = 'partial-cancel-v1-a')
  from jsonb_array_elements(private.collect_settled_export_for_search('2031-03-01', '2031-03-01', '', 'ordered', 'all')->'orders') o
  where o->>'id' = pg_temp.pv_id('order', 3)::text), 'v1_settled_export_carries_frozen_allocation');
-- seam: 버전 2 원장·얼린 버전 1 원장·아직 얼리지 않은 버전 1 계산이 같은 모양이다.
select pg_temp.pv_assert((private.order_item_price_allocation(pg_temp.pv_id('item-b', 4))).paid_goods_total = 9714
 and (private.order_item_price_allocation(pg_temp.pv_id('item-b', 10))).paid_goods_total = 10000
 and (private.order_item_price_allocation(pg_temp.pv_id('item-b', 10))).calculation_version = 1
 and private.order_item_price_allocation(pg_temp.pv_id('item-b', 5)) is null
 and private.order_shipment_prepaid_fee(pg_temp.pv_id('shipment-1', 10)) = 3000, 'v1_seam_shapes');
select pg_temp.pv_assert(not has_function_privilege('authenticated', 'private.order_v1_allocation_derive(uuid)', 'execute')
 and not has_function_privilege('authenticated', 'private.freeze_order_v1_allocation(uuid,uuid,uuid)', 'execute')
 and not has_function_privilege('service_role', 'private.freeze_order_v1_allocation(uuid,uuid,uuid)', 'execute')
 and not has_function_privilege('authenticated', 'private.order_item_price_allocation(uuid)', 'execute')
 and not has_function_privilege('anon', 'private.order_shipment_prepaid_fee(uuid)', 'execute')
 and not has_table_privilege('authenticated', 'private.order_v1_price_allocations', 'select')
 and not has_table_privilege('service_role', 'private.order_price_allocation_ledger', 'select'), 'v1_ledger_sealed');

rollback;
