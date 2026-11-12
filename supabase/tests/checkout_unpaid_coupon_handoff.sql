\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. 결제 대기 주문이 잡은 쿠폰을 새 주문에서 고른다(QA1 S-D2-08, ADR-0030 '보류와 이전 미결제 닫기'),
-- 주문 내역·상세의 다시 결제 진입 출처(QA1 S-D2-15).
-- 견적·장바구니 쿠폰 선택은 다음 새 주문이 닫을 결제 대기 카드 주문의 쿠폰·첫구매 예약을 닫힌 것으로 보고, 주문 생성은 그 주문을
-- 실제로 닫은 뒤 쿠폰을 쓴다. 결제 승인을 확인 중이거나 결과를 알 수 없는 주문의 쿠폰은 지금처럼 막는다.
-- Every amount/address/provider key is synthetic and rolled back.
begin;
create function pg_temp.d8_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
-- 견적 줄 모양(quote_goods_sales_for_address의 lines)을 쿠폰 평가 줄로 바꾼다.
create function pg_temp.d8_lines(p_good text,p_qty integer,p_price integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('good_id',p_good,'subtotal',p_qty::bigint*p_price)) $$;
-- The minute pg_cron sweep only closes orders whose expires_at passed 5 minutes ago.
-- This transaction never ages an order that far, so the sweep cannot race these assertions.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('d8000000-0000-4000-8000-000000000001','authenticated','authenticated','d8-admin@example.test',now(),'{}','{}',now(),now()),
 ('d8000000-0000-4000-8000-000000000002','authenticated','authenticated','d8-buyer@example.test',now(),'{}','{}',now(),now()),
 ('d8000000-0000-4000-8000-000000000003','authenticated','authenticated','d8-other@example.test',now(),'{}','{}',now(),now()),
 ('d8000000-0000-4000-8000-000000000004','authenticated','authenticated','d8-first@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='d8-'||right(id::text,1)||'@example.test',nickname='TEST D8 '||right(id::text,1),birth_date='2000-01-01',
 onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='d8000000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('d8000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000002','d8000000-0000-4000-8000-000000000003',
  'd8000000-0000-4000-8000-000000000004');
insert into public.ips(id,title,vertical_key,published_at) values('d8-ip','TEST D8 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('d8000000-0000-4000-8000-000000000010','d8-origin','TEST D8 출고지','hanjin',3000,'TEST 합성 반송지',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type) values
 ('d8-a','d8-ip','TEST D8 A','문구',12000,'ok',20,'d8000000-0000-4000-8000-000000000010','policy'),
 ('d8-b','d8-ip','TEST D8 B','문구',15000,'ok',20,'d8000000-0000-4000-8000-000000000010','policy');
insert into private.operator_memberships(profile_id,manager_role) values('d8000000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','d8-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='d8-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='d8-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='d8-ip';
select id as variant_a from public.goods_variants where good_id='d8-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='d8-b' and is_default \gset
select set_config('request.jwt.claim.sub','d8000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_save_store_credit_policy('d8000000-0000-4000-8000-000000000020',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":0,"earnMaxPerOrder":0,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"TEST-ONLY D8 policy"}');
reset role;
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status,recipient_segment) values
 ('D8FIRST3K','TEST D8 첫구매 3천','fixed',3000,10000,now()-interval '1 day','active','first_purchase'),
 ('D8PLAIN2K','TEST D8 2천','fixed',2000,0,now()-interval '1 day','active','all');
insert into public.user_coupons(coupon_code,user_id,issued_source,usable_from)
 values('D8FIRST3K','d8000000-0000-4000-8000-000000000002','admin_grant',now()-interval '1 minute') returning id as first_coupon \gset
insert into public.user_coupons(coupon_code,user_id,issued_source,usable_from)
 values('D8PLAIN2K','d8000000-0000-4000-8000-000000000003','admin_grant',now()-interval '1 minute') returning id as plain_coupon \gset
insert into public.user_coupons(coupon_code,user_id,issued_source,usable_from)
 values('D8FIRST3K','d8000000-0000-4000-8000-000000000004','admin_grant',now()-interval '1 minute') returning id as fresh_first_coupon \gset
select '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset
select '{"postalCode":"12345","address1":"TEST 합성 주소"}' as destination \gset

-- ── 1. 장바구니에서 B만 골라 첫구매 쿠폰으로 카드 주문(결제창만 연 결제 대기) — QA1 S-D2-08 A의 이전 주문 ─────────────────
select set_config('request.jwt.claim.sub','d8000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.set_cart_item_quantity('d8-a',:'variant_a',1);
select public.set_cart_item_quantity('d8-b',:'variant_b',1);
select public.apply_cart_coupon(:'first_coupon');
reset role;
set local role service_role;
select public.service_create_checkout_selection_draft('d8000000-0000-4000-8000-000000000002',jsonb_build_array(
  jsonb_build_object('good_id','d8-b','variant_id',:'variant_b','qty',1,'input_revision',0,'input_values','{}'::jsonb))) as old_draft \gset
select public.place_order_with_cart_selection('d8000000-0000-4000-8000-000000000002',:'old_draft',:'address',
 'd8000000-0000-4000-8000-000000000101','card',0,:'first_coupon') as old_order \gset
select public.prepare_goods_payment_attempt('d8000000-0000-4000-8000-000000000002',:'old_order','toss')->>'id' as old_attempt \gset
reset role;
select 1/case when (select status='used' and used_order_id=:'old_order'::uuid from public.user_coupons where id=:'first_coupon')
 and (select discount_total=3000 from public.orders where id=:'old_order')
 and exists(select 1 from private.coupon_first_purchase_claims where user_id='d8000000-0000-4000-8000-000000000002' and state='reserved' and order_id=:'old_order')
 and private.unpaid_order_replaceable(:'old_order','d8000000-0000-4000-8000-000000000002')
 and not private.unpaid_order_replaceable(:'old_order','d8000000-0000-4000-8000-000000000003')
 and not private.unpaid_order_replaceable(null,'d8000000-0000-4000-8000-000000000002')
 then 1 else 0 end as assert_pending_card_order_holds_first_coupon_and_is_replaceable;

-- 결제 대기 주문이 잡은 본인 쿠폰과 그 주문. 다른 계정에는 보이지 않는다.
set local role authenticated;
select public.get_my_unpaid_order_coupons() as unpaid_coupons \gset
reset role;
select 1/case when jsonb_array_length(:'unpaid_coupons'::jsonb)=1
 and (:'unpaid_coupons'::jsonb->0->>'userCouponId')=:'first_coupon' and (:'unpaid_coupons'::jsonb->0->>'orderId')=:'old_order'
 and (:'unpaid_coupons'::jsonb->0->>'paymentMethod')='card' and (:'unpaid_coupons'::jsonb->0->>'replaceable')::boolean
 and (:'unpaid_coupons'::jsonb->0->>'orderNumber') is not null
 then 1 else 0 end as assert_unpaid_order_coupons_lists_holder_order;
select set_config('request.jwt.claim.sub','d8000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select 1/case when public.get_my_unpaid_order_coupons()='[]'::jsonb then 1 else 0 end as assert_unpaid_order_coupons_own_only;
reset role;
select set_config('request.jwt.claim.sub','',true);
select 1/case when public.get_my_unpaid_order_coupons()='[]'::jsonb then 1 else 0 end as assert_unpaid_order_coupons_need_login;

-- ── 2. 견적·선택은 그 쿠폰을 받아들이고 아무 주문도 닫지 않는다 ────────────────────────────────────────
select set_config('request.jwt.claim.sub','d8000000-0000-4000-8000-000000000002',true);
set local role authenticated;
-- 바로구매 주문서(A 1개): 첫구매 쿠폰 할인 3,000, 사유 없음.
select public.quote_goods_sales_for_address_with_coupon(jsonb_build_array(jsonb_build_object('goodId','d8-a','variantId',:'variant_a','qty',1)),
 :'destination',:'first_coupon') as direct_quote \gset
-- 장바구니(A 1개 선택): 장바구니 쿠폰 선택이 그대로 그 쿠폰이다.
select public.quote_goods_sales_for_address(jsonb_build_array(jsonb_build_object('goodId','d8-a','variantId',:'variant_a','qty',1)),:'destination') as cart_quote \gset
-- 장바구니 쿠폰 선택도 받는다(다시 고르기). 적립금 견적도 같은 쿠폰 할인을 뺀다.
select public.apply_cart_coupon(:'first_coupon');
select public.get_my_store_credit_checkout_for_direct(0,:'destination',jsonb_build_array(jsonb_build_object('goodId','d8-a','variantId',:'variant_a','qty',1)),
 :'first_coupon') as direct_credit \gset
reset role;
select 1/case when (:'direct_quote'::jsonb->'coupon'->>'discount')::int=3000 and (:'direct_quote'::jsonb->'coupon'->>'reason') is null
 and (:'direct_quote'::jsonb->'coupon'->>'userCouponId')=:'first_coupon'
 and (:'cart_quote'::jsonb->'coupon'->>'discount')::int=3000 and (:'cart_quote'::jsonb->'coupon'->>'reason') is null
 and (:'direct_credit'::jsonb->>'reason') is null
 then 1 else 0 end as assert_quotes_accept_coupon_held_by_replaceable_order;
-- 주문 생성 쪽 평가(5인자)는 그대로 엄격하다 — supersede가 그 주문을 실제로 닫은 뒤에만 쿠폰을 쓴다.
select 1/case when (select o_reason='coupon_already_used' from private.evaluate_coupon_target_lines_at(:'first_coupon','d8000000-0000-4000-8000-000000000002',
  pg_temp.d8_lines('d8-a',1,12000),null,now()))
 and (select o_reason is null and o_discount=3000 from private.evaluate_coupon_target_lines_at(:'first_coupon','d8000000-0000-4000-8000-000000000002',
  pg_temp.d8_lines('d8-a',1,12000),null,now(),true))
 and (select o_reason='coupon_already_used' from private.evaluate_coupon_target_lines_at(:'first_coupon','d8000000-0000-4000-8000-000000000002',
  pg_temp.d8_lines('d8-a',1,12000),null,now(),null))
 and (select o_reason='coupon_not_owned' from private.evaluate_coupon_target_lines_at(:'first_coupon','d8000000-0000-4000-8000-000000000003',
  pg_temp.d8_lines('d8-a',1,12000),null,now(),true))
 then 1 else 0 end as assert_order_side_evaluation_stays_strict;
select 1/case when (select status='pending' from public.orders where id=:'old_order')
 and (select state='prepared' from public.payment_attempts where id=:'old_attempt')
 and (select state='awaiting_payment' from private.cart_order_holds where order_id=:'old_order')
 and (select status='used' and used_order_id=:'old_order'::uuid from public.user_coupons where id=:'first_coupon')
 then 1 else 0 end as assert_quote_and_selection_close_nothing;

-- ── 3. 바로구매 무통장 접수: 이전 결제 대기 주문을 닫고 쿠폰을 새 주문에 쓴다(한 트랜잭션) ──────────────────────
set local role service_role;
select public.service_create_checkout_direct_draft('d8000000-0000-4000-8000-000000000002','d8-a',
 jsonb_build_array(jsonb_build_object('good_id','d8-a','variant_id',:'variant_a','qty',1))) as new_draft \gset
select public.place_direct_order('d8000000-0000-4000-8000-000000000002',:'new_draft',:'address','d8000000-0000-4000-8000-000000000102',
 'bank_transfer',0,:'first_coupon') as new_order \gset
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'old_order')
 and (select state='canceled' from public.payment_attempts where id=:'old_attempt')
 and (select status='used' and used_order_id=:'new_order'::uuid from public.user_coupons where id=:'first_coupon')
 and (select total=12000+3000-3000 and discount_total=3000 from public.orders where id=:'new_order')
 and (select count(*)=1 from public.coupon_redemptions where user_coupon_id=:'first_coupon' and status='applied')
 and exists(select 1 from public.coupon_redemptions where user_coupon_id=:'first_coupon' and status='applied' and order_id=:'new_order')
 and exists(select 1 from private.coupon_first_purchase_claims where user_id='d8000000-0000-4000-8000-000000000002' and state='reserved' and order_id=:'new_order')
 and not exists(select 1 from private.coupon_first_purchase_claims where user_id='d8000000-0000-4000-8000-000000000002' and state='reserved' and order_id=:'old_order')
 -- 바로구매 접수는 장바구니를 바꾸지 않는다. 같은 쿠폰의 장바구니 선택만 풀린다(이미 쓴 쿠폰).
 and (select count(*)=2 from public.cart_items where user_id='d8000000-0000-4000-8000-000000000002')
 and not exists(select 1 from public.cart_coupon_selections where user_id='d8000000-0000-4000-8000-000000000002')
 -- 이전 주문이 잡았던 B 재고가 돌아왔다.
 and (select stock_qty=20 from public.goods_variants where id=:'variant_b')
 then 1 else 0 end as assert_new_order_closes_holder_and_uses_coupon;
-- 입금 대기 주문이 잡은 쿠폰은 쿠폰함에 남지만 새 주문이 닫을 수 없다.
set local role authenticated;
select public.get_my_unpaid_order_coupons() as bank_coupons \gset
reset role;
select 1/case when jsonb_array_length(:'bank_coupons'::jsonb)=1 and (:'bank_coupons'::jsonb->0->>'orderId')=:'new_order'
 and (:'bank_coupons'::jsonb->0->>'paymentMethod')='bank_transfer' and not (:'bank_coupons'::jsonb->0->>'replaceable')::boolean
 then 1 else 0 end as assert_bank_transfer_holder_is_not_replaceable;

-- ── 4. 결제 승인을 확인 중인 주문이 잡은 쿠폰은 지금처럼 막는다 ────────────────────────────────────────
set local role service_role;
select public.service_create_checkout_direct_draft('d8000000-0000-4000-8000-000000000003','d8-b',
 jsonb_build_array(jsonb_build_object('good_id','d8-b','variant_id',:'variant_b','qty',1))) as plain_draft \gset
select public.place_direct_order('d8000000-0000-4000-8000-000000000003',:'plain_draft',:'address','d8000000-0000-4000-8000-000000000103',
 'card',0,:'plain_coupon') as plain_order \gset
select public.prepare_goods_payment_attempt('d8000000-0000-4000-8000-000000000003',:'plain_order','toss')->>'id' as plain_attempt \gset
select public.bind_goods_payment_callback_nonce(:'plain_attempt',repeat('d',64));
reset role;
select provider_order_id as plain_provider from public.payment_attempts where id=:'plain_attempt' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'plain_provider',repeat('d',64),'d8000000-0000-4000-8000-000000000144');
reset role;
select set_config('request.jwt.claim.sub','d8000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select public.get_my_unpaid_order_coupons() as confirming_coupons \gset
select public.quote_goods_sales_for_address_with_coupon(jsonb_build_array(jsonb_build_object('goodId','d8-a','variantId',:'variant_a','qty',1)),
 :'destination',:'plain_coupon') as confirming_quote \gset
select pg_temp.d8_expect_error(format('select public.apply_cart_coupon(%L)',:'plain_coupon'),'coupon_already_used');
reset role;
select 1/case when exists(select 1 from jsonb_array_elements(:'confirming_coupons'::jsonb) row
   where row->>'userCouponId'=:'plain_coupon' and row->>'orderId'=:'plain_order' and not (row->>'replaceable')::boolean)
 and (:'confirming_quote'::jsonb->'coupon'->>'reason')='coupon_already_used' and (:'confirming_quote'::jsonb->'coupon'->>'discount')::int=0
 then 1 else 0 end as assert_confirming_holder_keeps_coupon_blocked;
set local role service_role;
select public.service_create_checkout_direct_draft('d8000000-0000-4000-8000-000000000003','d8-a',
 jsonb_build_array(jsonb_build_object('good_id','d8-a','variant_id',:'variant_a','qty',1))) as blocked_draft \gset
select pg_temp.d8_expect_error(format('select public.place_direct_order(%L,%L,%L,%L,%L,0,%L)','d8000000-0000-4000-8000-000000000003',:'blocked_draft',:'address',
 'd8000000-0000-4000-8000-000000000104','bank_transfer',:'plain_coupon'),'checkout_payment_in_progress');
reset role;
-- 승인 확인 리스가 지나 결과를 알 수 없는 주문은 새 주문이 떼어 내지만(detach) 쿠폰은 그 주문에 남는다 — 새 주문은 그 쿠폰을
-- 쓰지 못하고 거절되며, 거절된 트랜잭션은 떼어 내기까지 되돌린다. 같은 쿠폰이 두 주문에 '사용'되지 않는다.
update public.payment_attempts set claim_expires_at=clock_timestamp()-interval '1 minute' where id=:'plain_attempt';
set local role service_role;
select pg_temp.d8_expect_error(format('select public.place_direct_order(%L,%L,%L,%L,%L,0,%L)','d8000000-0000-4000-8000-000000000003',:'blocked_draft',:'address',
 'd8000000-0000-4000-8000-000000000105','bank_transfer',:'plain_coupon'),'coupon_already_used');
reset role;
select 1/case when (select status='pending' from public.orders where id=:'plain_order')
 and (select state='awaiting_payment' from private.cart_order_holds where order_id=:'plain_order')
 and (select status='used' and used_order_id=:'plain_order'::uuid from public.user_coupons where id=:'plain_coupon')
 and (select count(*)=1 from public.coupon_redemptions where user_coupon_id=:'plain_coupon' and status='applied')
 and not exists(select 1 from public.orders where checkout_key in('d8000000-0000-4000-8000-000000000104','d8000000-0000-4000-8000-000000000105'))
 then 1 else 0 end as assert_unresolved_holder_keeps_coupon_and_new_order_rejected;
set local role service_role;
select public.finalize_goods_payment_attempt(:'plain_attempt','d8000000-0000-4000-8000-000000000144','declined');
reset role;

-- ── 5. 첫구매 예약: 결제 대기 카드 주문은 다음 새 주문이 닫으니 첫구매 쿠폰을 막지 않고, 입금 대기는 지금처럼 막는다 ─────────
set local role service_role;
select public.service_create_checkout_direct_draft('d8000000-0000-4000-8000-000000000004','d8-b',
 jsonb_build_array(jsonb_build_object('good_id','d8-b','variant_id',:'variant_b','qty',1))) as fresh_card_draft \gset
select public.place_direct_order('d8000000-0000-4000-8000-000000000004',:'fresh_card_draft',:'address','d8000000-0000-4000-8000-000000000106',
 'card',0,null) as fresh_card_order \gset
reset role;
select set_config('request.jwt.claim.sub','d8000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select public.quote_goods_sales_for_address_with_coupon(jsonb_build_array(jsonb_build_object('goodId','d8-a','variantId',:'variant_a','qty',1)),
 :'destination',:'fresh_first_coupon') as fresh_card_quote \gset
-- 쿠폰 칸·쿠폰함의 받는 회원 판정(계산 열)도 같은 기준이라 첫구매 쿠폰을 '사용 조건 미충족'으로 숨기지 않는다.
select coalesce(public.coupon_recipient_state(c),'none') as fresh_card_recipient from public.coupons as c where c.code='D8FIRST3K' \gset
reset role;
select 1/case when (:'fresh_card_quote'::jsonb->'coupon'->>'reason') is null and (:'fresh_card_quote'::jsonb->'coupon'->>'discount')::int=3000
 and :'fresh_card_recipient'='none'
 and (select o_reason='coupon_first_purchase_pending' from private.evaluate_coupon_target_lines_at(:'fresh_first_coupon','d8000000-0000-4000-8000-000000000004',
  pg_temp.d8_lines('d8-a',1,12000),null,now()))
 then 1 else 0 end as assert_first_purchase_not_blocked_by_replaceable_card_order;
set local role service_role;
select public.service_create_checkout_direct_draft('d8000000-0000-4000-8000-000000000004','d8-b',
 jsonb_build_array(jsonb_build_object('good_id','d8-b','variant_id',:'variant_b','qty',1))) as fresh_bank_draft \gset
select public.place_direct_order('d8000000-0000-4000-8000-000000000004',:'fresh_bank_draft',:'address','d8000000-0000-4000-8000-000000000107',
 'bank_transfer',0,null) as fresh_bank_order \gset
reset role;
set local role authenticated;
select public.quote_goods_sales_for_address_with_coupon(jsonb_build_array(jsonb_build_object('goodId','d8-a','variantId',:'variant_a','qty',1)),
 :'destination',:'fresh_first_coupon') as fresh_bank_quote \gset
select public.coupon_recipient_state(c) as fresh_bank_recipient from public.coupons as c where c.code='D8FIRST3K' \gset
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'fresh_card_order')
 and (:'fresh_bank_quote'::jsonb->'coupon'->>'reason')='coupon_first_purchase_pending'
 and :'fresh_bank_recipient'='coupon_first_purchase_pending'
 then 1 else 0 end as assert_bank_pending_still_blocks_first_purchase;

-- ── 6. 주문 내역·주문 상세의 다시 결제 진입 출처(QA1 S-D2-15, service_list_order_retry_sources) ─────────────────────────
set local role service_role;
select public.service_list_order_retry_sources('d8000000-0000-4000-8000-000000000002',array[:'old_order',:'new_order']::uuid[]) as sources_buyer \gset
select public.service_list_order_retry_sources('d8000000-0000-4000-8000-000000000003',array[:'plain_order']::uuid[]) as sources_declined \gset
select public.service_list_order_retry_sources('d8000000-0000-4000-8000-000000000004',array[:'fresh_card_order',:'fresh_bank_order']::uuid[]) as sources_fresh \gset
select public.service_list_order_retry_sources('d8000000-0000-4000-8000-000000000002',array[:'plain_order']::uuid[]) as sources_other \gset
reset role;
select 1/case when :'sources_buyer'::jsonb=jsonb_build_array(jsonb_build_object('orderId',:'old_order','source','cart','awaitingPayment',false,
   'baseGoodId',null,'retryOrderId',null))
 -- 승인 거절로 결제 대기인 바로구매 주문: 다시 결제 진입(결제 화면)으로 잇는다.
 and :'sources_declined'::jsonb=jsonb_build_array(jsonb_build_object('orderId',:'plain_order','source','direct','awaitingPayment',true,
   'baseGoodId','d8-b','retryOrderId',null))
 -- 새 주문이 닫은 바로구매 카드 주문만 — 무통장 입금 대기 주문은 보류가 없어 진입이 없다.
 and :'sources_fresh'::jsonb=jsonb_build_array(jsonb_build_object('orderId',:'fresh_card_order','source','direct','awaitingPayment',false,
   'baseGoodId','d8-b','retryOrderId',null))
 and :'sources_other'::jsonb='[]'::jsonb
 and public.service_list_order_retry_sources(null,array[:'old_order']::uuid[])='[]'::jsonb
 then 1 else 0 end as assert_order_retry_sources_own_unpaid_or_closed_only;

-- ── 7. 권한 ─────────────────────────────────────────────────────────────────────────
select 1/case when has_function_privilege('authenticated','public.get_my_unpaid_order_coupons()','execute')
 and not has_function_privilege('anon','public.get_my_unpaid_order_coupons()','execute')
 and not has_function_privilege('service_role','public.get_my_unpaid_order_coupons()','execute')
 and not has_function_privilege('authenticated','private.unpaid_order_replaceable(uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.unpaid_order_replaceable(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.evaluate_coupon_target_lines_at(uuid,uuid,jsonb,uuid,timestamptz,boolean)','execute')
 and not has_function_privilege('service_role','private.evaluate_coupon_target_lines_at(uuid,uuid,jsonb,uuid,timestamptz,boolean)','execute')
 and has_function_privilege('service_role','public.service_list_order_retry_sources(uuid,uuid[])','execute')
 and not has_function_privilege('authenticated','public.service_list_order_retry_sources(uuid,uuid[])','execute')
 and not has_function_privilege('anon','public.service_list_order_retry_sources(uuid,uuid[])','execute')
 then 1 else 0 end as assert_unpaid_coupon_handoff_acl;
rollback;
