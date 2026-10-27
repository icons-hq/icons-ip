\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. 결제가 완료될 때까지 장바구니를 유지한다(ADR-0026).
-- Every amount/address/provider key is synthetic and rolled back.
begin;
create function pg_temp.retained_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
-- The minute pg_cron sweep only closes orders whose expires_at passed 5 minutes ago.
-- This transaction never ages an order that far, so the sweep cannot race these assertions.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('cc270000-0000-4000-8000-000000000001','authenticated','authenticated','retained-admin@example.test',now(),'{}','{}',now(),now()),
 ('cc270000-0000-4000-8000-000000000002','authenticated','authenticated','retained-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='retained-'||right(id::text,1)||'@example.test',nickname='TEST 유지 '||right(id::text,1),birth_date='2000-01-01',
 onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='cc270000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('cc270000-0000-4000-8000-000000000001','cc270000-0000-4000-8000-000000000002');
insert into public.ips(id,title,vertical_key,published_at) values('retained-ip','TEST 유지 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('cc270000-0000-4000-8000-000000000010','retained-origin','TEST 유지 출고지','hanjin',3000,'TEST 합성 반송지',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,member_purchase_limit_enabled,member_lifetime_qty_limit) values
 ('retained-a','retained-ip','TEST 유지 A','문구',10000,'ok',20,'cc270000-0000-4000-8000-000000000010','policy',false,null),
 ('retained-c','retained-ip','TEST 유지 C 한정','문구',5000,'ok',20,'cc270000-0000-4000-8000-000000000010','policy',true,2);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,custom_inputs_enabled,custom_inputs_revision,custom_input_fields) values
 ('retained-input','retained-ip','TEST 유지 각인','문구',4000,'ok',20,'cc270000-0000-4000-8000-000000000010','policy',true,1,
  '[{"id":"cc270000-0000-4000-8000-000000000061","name":"각인 문구","active":true}]');
insert into private.operator_memberships(profile_id,manager_role) values('cc270000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','retained-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='retained-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='retained-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='retained-ip';
select id as variant_a from public.goods_variants where good_id='retained-a' and is_default \gset
select id as variant_c from public.goods_variants where good_id='retained-c' and is_default \gset
select id as variant_input from public.goods_variants where good_id='retained-input' and is_default \gset
select set_config('request.jwt.claim.sub','cc270000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_save_store_credit_policy('cc270000-0000-4000-8000-000000000020',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":0,"earnMaxPerOrder":0,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"TEST-ONLY cart retention policy"}');
select public.admin_adjust_store_credit('cc270000-0000-4000-8000-000000000021','cc270000-0000-4000-8000-000000000002',30000,now()+interval '1 day','TEST 지급',0);
reset role;
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status) values
 ('RETAIN2K','TEST 유지 2천','fixed',2000,0,now()-interval '1 day','active'),
 ('RETAIN1K','TEST 유지 1천','fixed',1000,0,now()-interval '1 day','active');
select '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset

-- ── 1. 카드 주문은 장바구니를 남기고, 결제 확정 때 주문한 수량만큼만 뺀다 ─────────────
select set_config('request.jwt.claim.sub','cc270000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.set_cart_item_quantity('retained-a',:'variant_a',2);
select public.apply_cart_coupon_code('RETAIN2K') as coupon_2k \gset
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as cart_1
 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' \gset
reset role;
set local role service_role;
select public.place_order_with_cart_snapshot('cc270000-0000-4000-8000-000000000002',:'address','cc270000-0000-4000-8000-000000000031','card',1000,:'coupon_2k',:'cart_1') as order_1 \gset
select 1/case when public.place_order_with_cart_snapshot('cc270000-0000-4000-8000-000000000002',:'address','cc270000-0000-4000-8000-000000000031','card',1000,:'coupon_2k','[]')=:'order_1'::uuid
 then 1 else 0 end as assert_card_replay_returns_same_order_without_second_hold;
reset role;
select 1/case when (select qty=2 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' and variant_id=:'variant_a')
 and (select user_coupon_id=:'coupon_2k'::uuid from public.cart_coupon_selections where user_id='cc270000-0000-4000-8000-000000000002')
 and (select status='used' and used_order_id=:'order_1'::uuid from public.user_coupons where id=:'coupon_2k')
 and (select state='awaiting_payment' and source='legacy_checkout' and jsonb_array_length(lines)=1 and (lines->0->>'qty')::int=2
  from private.cart_order_holds where order_id=:'order_1')
 and (select count(*)=1 from private.cart_order_holds where user_id='cc270000-0000-4000-8000-000000000002')
 and (select stock_qty=18 from public.goods_variants where id=:'variant_a')
 and (select status='pending' and total=20000 and shipping_fee=3000 and discount_total=2000 and store_credit_total=1000 from public.orders where id=:'order_1')
 and current_setting('icons.cart_order_retention',true) is distinct from 'on'
 then 1 else 0 end as assert_card_order_keeps_cart_and_coupon_selection_with_hold;
-- 주문 뒤 같은 상품 수량을 늘렸다. 결제 확정은 주문한 2개만 뺀다.
set local role authenticated;
select public.set_cart_item_quantity('retained-a',:'variant_a',5);
reset role;
set local role service_role;
select public.prepare_goods_payment_attempt('cc270000-0000-4000-8000-000000000002',:'order_1','toss')->>'id' as attempt_1 \gset
select public.bind_goods_payment_callback_nonce(:'attempt_1',repeat('a',64));
reset role;
select provider_order_id as provider_1 from public.payment_attempts where id=:'attempt_1' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'provider_1',repeat('a',64),'cc270000-0000-4000-8000-000000000041');
select 1/case when public.finalize_goods_payment_attempt(:'attempt_1','cc270000-0000-4000-8000-000000000041','approved',null,'TEST-RETAINED-1')='approved'
 then 1 else 0 end as assert_first_card_order_approved;
reset role;
select 1/case when (select status='paid' from public.orders where id=:'order_1')
 and (select qty=3 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' and variant_id=:'variant_a')
 and not exists(select 1 from public.cart_coupon_selections where user_id='cc270000-0000-4000-8000-000000000002')
 and (select state='consumed' and consumption#>>'{lines,0,outcome}'='decreased' and (consumption#>>'{lines,0,cartQtyBefore}')::int=5
  and (consumption->>'couponSelectionCleared')::boolean from private.cart_order_holds where order_id=:'order_1')
 then 1 else 0 end as assert_payment_consumes_ordered_qty_and_used_coupon_selection;

-- ── 2. 결제 실패 뒤 장바구니·쿠폰 선택이 그대로이고, 돌아오면 이중 점유 없이 풀린다 ─────
set local role authenticated;
select public.set_cart_item_quantity('retained-a',:'variant_a',1);
select public.set_cart_item_quantity('retained-c',:'variant_c',2);
select public.apply_cart_coupon_code('RETAIN1K') as coupon_1k \gset
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as cart_2
 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' \gset
reset role;
set local role service_role;
select public.place_order_with_cart_snapshot('cc270000-0000-4000-8000-000000000002',:'address','cc270000-0000-4000-8000-000000000032','card',500,:'coupon_1k',:'cart_2') as order_2 \gset
select public.prepare_goods_payment_attempt('cc270000-0000-4000-8000-000000000002',:'order_2','toss')->>'id' as attempt_2 \gset
select public.bind_goods_payment_callback_nonce(:'attempt_2',repeat('b',64));
reset role;
select provider_order_id as provider_2 from public.payment_attempts where id=:'attempt_2' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'provider_2',repeat('b',64),'cc270000-0000-4000-8000-000000000042');
select public.finalize_goods_payment_attempt(:'attempt_2','cc270000-0000-4000-8000-000000000042','declined');
reset role;
select 1/case when (select status='pending' from public.orders where id=:'order_2')
 and (select count(*)=2 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002')
 and (select user_coupon_id=:'coupon_1k'::uuid from public.cart_coupon_selections where user_id='cc270000-0000-4000-8000-000000000002')
 and private.member_goods_reserved_qty('cc270000-0000-4000-8000-000000000002','retained-c')=2
 and (select state='awaiting_payment' from private.cart_order_holds where order_id=:'order_2')
 then 1 else 0 end as assert_declined_payment_leaves_cart_and_selection;
-- 고객이 장바구니·주문서로 돌아왔다. 결제가 끝나지 않은 주문을 닫아 자원을 돌려준다.
set local role service_role;
select 1/case when public.release_unpaid_cart_orders('cc270000-0000-4000-8000-000000000002')=1 then 1 else 0 end as assert_return_releases_one_unpaid_order;
select 1/case when public.release_unpaid_cart_orders('cc270000-0000-4000-8000-000000000002')=0 then 1 else 0 end as assert_release_is_idempotent;
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'order_2')
 and (select state='released' and release_reason='superseded' from private.cart_order_holds where order_id=:'order_2')
 and (select status='active' and used_order_id is null from public.user_coupons where id=:'coupon_1k')
 and (select status='released' from public.coupon_redemptions where order_id=:'order_2')
 and private.member_goods_reserved_qty('cc270000-0000-4000-8000-000000000002','retained-c')=0
 and not exists(select 1 from private.store_credit_allocations where order_id=:'order_2' and state='reserved')
 and (select stock_qty=20 from public.goods_variants where id=:'variant_c')
 and (select count(*)=2 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002')
 and (select user_coupon_id=:'coupon_1k'::uuid from public.cart_coupon_selections where user_id='cc270000-0000-4000-8000-000000000002')
 and exists(select 1 from public.audit_log where action='system.order.unpaid_cart_order_closed' and target='order:'||:'order_2'
  and diff->>'trigger'='returned_to_cart')
 then 1 else 0 end as assert_release_returns_stock_coupon_credit_and_limit;

-- ── 3. 같은 장바구니로 두 번째 주문 → 첫 주문 닫힘, 늦은 콜백은 승인 없이 거절 ──────────
set local role service_role;
select public.place_order_with_cart_snapshot('cc270000-0000-4000-8000-000000000002',:'address','cc270000-0000-4000-8000-000000000033','card',500,:'coupon_1k',:'cart_2') as order_3 \gset
select public.prepare_goods_payment_attempt('cc270000-0000-4000-8000-000000000002',:'order_3','toss')->>'id' as attempt_3 \gset
select public.bind_goods_payment_callback_nonce(:'attempt_3',repeat('c',64));
select public.place_order_with_cart_snapshot('cc270000-0000-4000-8000-000000000002',:'address','cc270000-0000-4000-8000-000000000034','card',500,:'coupon_1k',:'cart_2') as order_4 \gset
reset role;
select provider_order_id as provider_3 from public.payment_attempts where id=:'attempt_3' \gset
select 1/case when (select status='canceled' from public.orders where id=:'order_3')
 and (select state='canceled' and claim_token is null from public.payment_attempts where id=:'attempt_3')
 and (select state='released' and release_reason='superseded' from private.cart_order_holds where order_id=:'order_3')
 and (select state='awaiting_payment' from private.cart_order_holds where order_id=:'order_4')
 and (select status='used' and used_order_id=:'order_4'::uuid from public.user_coupons where id=:'coupon_1k')
 and (select count(*)=1 from public.coupon_redemptions where user_coupon_id=:'coupon_1k' and status='applied')
 and (select count(*)=1 from private.store_credit_allocations where user_id='cc270000-0000-4000-8000-000000000002' and state='reserved')
 and private.member_goods_reserved_qty('cc270000-0000-4000-8000-000000000002','retained-c')=2
 and (select stock_qty=18 from public.goods_variants where id=:'variant_c')
 and (select discount_total=1000 and store_credit_total=500 from public.orders where id=:'order_4')
 and exists(select 1 from public.audit_log where action='system.order.unpaid_cart_order_closed' and target='order:'||:'order_3'
  and diff->>'trigger'='new_cart_order' and (diff->>'attemptCanceled')::boolean)
 then 1 else 0 end as assert_second_order_supersedes_first_without_double_hold;
set local role service_role;
select 1/case when public.claim_goods_payment_attempt('toss',:'provider_3',repeat('c',64),'cc270000-0000-4000-8000-000000000043')
 @> '{"claim_status":"terminal","outcome":"canceled"}' then 1 else 0 end as assert_late_callback_is_terminal_without_approval;
reset role;
select 1/case when (select state='canceled' and claim_token is null from public.payment_attempts where id=:'attempt_3')
 and not exists(select 1 from public.payments where ref_id=:'order_3')
 then 1 else 0 end as assert_late_callback_never_claims_superseded_attempt;

-- ── 4. 승인 확인 중인 이전 주문이 있으면 새 주문을 막는다 ────────────────────────────
set local role service_role;
select public.prepare_goods_payment_attempt('cc270000-0000-4000-8000-000000000002',:'order_4','toss')->>'id' as attempt_4 \gset
select public.bind_goods_payment_callback_nonce(:'attempt_4',repeat('d',64));
reset role;
select provider_order_id as provider_4 from public.payment_attempts where id=:'attempt_4' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'provider_4',repeat('d',64),'cc270000-0000-4000-8000-000000000044');
select pg_temp.retained_expect_error(format('select public.place_order_with_cart_snapshot(%L,%L,%L,%L,500,%L,%L)',
 'cc270000-0000-4000-8000-000000000002',:'address','cc270000-0000-4000-8000-000000000035','card',:'coupon_1k',:'cart_2'),'checkout_payment_in_progress');
select 1/case when public.release_unpaid_cart_orders('cc270000-0000-4000-8000-000000000002')=0 then 1 else 0 end as assert_return_never_closes_confirming_order;
select 1/case when public.finalize_goods_payment_attempt(:'attempt_4','cc270000-0000-4000-8000-000000000044','approved',null,'TEST-RETAINED-4')='approved'
 then 1 else 0 end as assert_confirming_order_approved;
reset role;
select 1/case when (select status='paid' from public.orders where id=:'order_4')
 and not exists(select 1 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002')
 and not exists(select 1 from public.cart_coupon_selections where user_id='cc270000-0000-4000-8000-000000000002')
 and (select state='consumed' and (select bool_and(line->>'outcome'='removed') from jsonb_array_elements(consumption->'lines') line)
  from private.cart_order_holds where order_id=:'order_4')
 and not exists(select 1 from public.orders where user_id='cc270000-0000-4000-8000-000000000002' and checkout_key='cc270000-0000-4000-8000-000000000035')
 then 1 else 0 end as assert_blocked_checkout_created_nothing_and_payment_emptied;

-- ── 5. 무통장 입금은 접수 = 주문 완료라 접수 시 장바구니에서 뺀다 ───────────────────
set local role authenticated;
select public.set_cart_item_quantity('retained-a',:'variant_a',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as cart_5
 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' \gset
reset role;
set local role service_role;
select public.place_order_with_cart_snapshot('cc270000-0000-4000-8000-000000000002',:'address','cc270000-0000-4000-8000-000000000036','bank_transfer',0,null,:'cart_5') as order_5 \gset
reset role;
select 1/case when (select status='pending' and payment_method='bank_transfer' from public.orders where id=:'order_5')
 and not exists(select 1 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002')
 and not exists(select 1 from private.cart_order_holds where order_id=:'order_5')
 and exists(select 1 from public.payment_attempts where ref_id=:'order_5' and provider='bank_transfer' and state='prepared')
 then 1 else 0 end as assert_bank_transfer_consumes_cart_on_intake;

-- ── 6. 보류가 없는 주문(신뢰 경로 직접 호출·선물·정기배송 회차)의 결제는 장바구니를 건드리지 않는다 ──
set local role authenticated;
select public.set_cart_item_quantity('retained-a',:'variant_a',1);
reset role;
set local role service_role;
select public.place_order_with_store_credits('cc270000-0000-4000-8000-000000000002',:'address','cc270000-0000-4000-8000-000000000037','card',0) as order_6 \gset
reset role;
select 1/case when not exists(select 1 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002')
 and not exists(select 1 from private.cart_order_holds where order_id=:'order_6')
 then 1 else 0 end as assert_trusted_direct_path_keeps_creation_consumption;
set local role authenticated;
select public.set_cart_item_quantity('retained-a',:'variant_a',4);
reset role;
set local role service_role;
select public.prepare_goods_payment_attempt('cc270000-0000-4000-8000-000000000002',:'order_6','toss')->>'id' as attempt_6 \gset
select public.bind_goods_payment_callback_nonce(:'attempt_6',repeat('e',64));
reset role;
select provider_order_id as provider_6 from public.payment_attempts where id=:'attempt_6' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'provider_6',repeat('e',64),'cc270000-0000-4000-8000-000000000046');
select public.finalize_goods_payment_attempt(:'attempt_6','cc270000-0000-4000-8000-000000000046','approved',null,'TEST-RETAINED-6');
reset role;
select 1/case when (select status='paid' from public.orders where id=:'order_6')
 and (select qty=4 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' and variant_id=:'variant_a')
 then 1 else 0 end as assert_payment_without_hold_never_touches_cart;

-- ── 7. 결과를 자동으로 확정할 수 없는 이전 주문은 닫지 않고 보류만 떼어 낸다 ───────────
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as cart_7
 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' \gset
set local role service_role;
select public.place_order_with_cart_snapshot('cc270000-0000-4000-8000-000000000002',:'address','cc270000-0000-4000-8000-000000000038','card',0,null,:'cart_7') as order_7 \gset
select public.prepare_goods_payment_attempt('cc270000-0000-4000-8000-000000000002',:'order_7','toss')->>'id' as attempt_7 \gset
select public.bind_goods_payment_callback_nonce(:'attempt_7',repeat('f',64));
reset role;
select provider_order_id as provider_7 from public.payment_attempts where id=:'attempt_7' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'provider_7',repeat('f',64),'cc270000-0000-4000-8000-000000000047');
select public.finalize_goods_payment_attempt(:'attempt_7','cc270000-0000-4000-8000-000000000047','unknown');
select 1/case when public.release_unpaid_cart_orders('cc270000-0000-4000-8000-000000000002')=0 then 1 else 0 end as assert_return_keeps_unknown_payment_order;
select public.place_order_with_cart_snapshot('cc270000-0000-4000-8000-000000000002',:'address','cc270000-0000-4000-8000-000000000039','card',0,null,:'cart_7') as order_8 \gset
reset role;
select 1/case when (select status='pending' from public.orders where id=:'order_7')
 and (select state='unknown' from public.payment_attempts where id=:'attempt_7')
 and (select state='released' and release_reason='detached' from private.cart_order_holds where order_id=:'order_7')
 and (select state='awaiting_payment' from private.cart_order_holds where order_id=:'order_8')
 and exists(select 1 from public.audit_log where action='system.order.cart_hold_detached' and target='order:'||:'order_7')
 and (select qty=4 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' and variant_id=:'variant_a')
 then 1 else 0 end as assert_unresolved_order_detached_not_closed;

-- ── 7b. 결제 중 접수된 고객 취소 요청은 닫을 때 sweep처럼 결제 없이 종결하고 알린다 ─────────
set local role service_role;
select public.prepare_goods_payment_attempt('cc270000-0000-4000-8000-000000000002',:'order_8','toss')->>'id' as attempt_8 \gset
select public.request_order_cancellation(:'order_8','cc270000-0000-4000-8000-000000000002','TEST 결제 중 취소','change_of_mind') as request_8_result \gset
reset role;
select id as request_8 from public.order_cancellation_requests where order_id=:'order_8' \gset
select 1/case when (select status='requested' from public.order_cancellation_requests where id=:'request_8')
 and (select status='pending' from public.orders where id=:'order_8')
 then 1 else 0 end as assert_cancel_requested_while_attempt_prepared;
set local role service_role;
select 1/case when public.release_unpaid_cart_orders('cc270000-0000-4000-8000-000000000002')=1 then 1 else 0 end as assert_return_closes_requested_unpaid_order;
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'order_8')
 and (select status='completed' from public.order_cancellation_requests where id=:'request_8')
 and (select state='canceled' from public.payment_attempts where id=:'attempt_8')
 and (select state='released' and release_reason='superseded' from private.cart_order_holds where order_id=:'order_8')
 and exists(select 1 from public.audit_log where action='system.order.unpaid_cart_order_closed' and target='order:'||:'order_8'
  and diff->>'requestId'=:'request_8')
 and (select qty=4 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' and variant_id=:'variant_a')
 then 1 else 0 end as assert_requested_cancellation_completed_without_payment;

-- ── 7c. 장바구니 정리가 실패해도 결제 확정은 되돌리지 않는다 ─────────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub','cc270000-0000-4000-8000-000000000002',true);
select public.set_cart_item_quantity('retained-a',:'variant_a',0);
select public.set_cart_item_quantity_with_inputs('retained-input',:'variant_input',2,1,'{"cc270000-0000-4000-8000-000000000061":"TEST 각인"}');
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as cart_input
 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' \gset
reset role;
set local role service_role;
select public.place_order_with_cart_snapshot('cc270000-0000-4000-8000-000000000002',:'address','cc270000-0000-4000-8000-000000000040','card',0,null,:'cart_input') as order_input \gset
select public.prepare_goods_payment_attempt('cc270000-0000-4000-8000-000000000002',:'order_input','toss')->>'id' as attempt_input \gset
select public.bind_goods_payment_callback_nonce(:'attempt_input',repeat('8',64));
reset role;
set local role authenticated;
select public.set_cart_item_quantity_with_inputs('retained-input',:'variant_input',3,1,'{"cc270000-0000-4000-8000-000000000061":"TEST 각인"}');
reset role;
-- 장바구니 쓰기가 어떤 이유로든 실패하는 상황을 테스트 전용 트리거로 만든다(트랜잭션과 함께 사라진다).
create function public.test_retained_cart_write_failure() returns trigger language plpgsql as $$begin
 raise exception 'TEST cart write failure';
end $$;
create trigger test_retained_cart_write_failure before update on public.cart_items
 for each row when (old.good_id='retained-input') execute function public.test_retained_cart_write_failure();
select provider_order_id as provider_input from public.payment_attempts where id=:'attempt_input' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'provider_input',repeat('8',64),'cc270000-0000-4000-8000-000000000048');
select 1/case when public.finalize_goods_payment_attempt(:'attempt_input','cc270000-0000-4000-8000-000000000048','approved',null,'TEST-RETAINED-INPUT')='approved'
 then 1 else 0 end as assert_payment_approved_despite_cart_write_failure;
reset role;
select 1/case when (select status='paid' from public.orders where id=:'order_input')
 and (select qty=3 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' and variant_id=:'variant_input')
 and (select state='consumed' and consumption#>>'{lines,0,outcome}'='kept' from private.cart_order_holds where order_id=:'order_input')
 then 1 else 0 end as assert_unchangeable_cart_line_is_kept_and_recorded;
drop trigger test_retained_cart_write_failure on public.cart_items;
drop function public.test_retained_cart_write_failure();
-- 다음 절은 빈 장바구니에서 시작한다.
set local role authenticated;
select public.set_cart_item_quantity_with_inputs('retained-input',:'variant_input',0,1,'{"cc270000-0000-4000-8000-000000000061":"TEST 각인"}');
reset role;

-- ── 8. 거래 런타임 장바구니 어댑터도 같은 규칙을 따른다 ───────────────────────────────
update private.goods_transaction_runtime set enabled=true where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub','cc270000-0000-4000-8000-000000000002',true);
select public.set_cart_item_quantity('retained-a',:'variant_a',0);
select public.set_cart_item_quantity('retained-a',:'variant_a',2);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as cart_9
 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' \gset
reset role;
set local role service_role;
select public.quote_cart_goods_transaction('cc270000-0000-4000-8000-000000000002',:'cart_9',:'address','{}',null,0) as quote_9 \gset
select public.place_cart_goods_transaction('cc270000-0000-4000-8000-000000000002',:'cart_9',:'address',(:'quote_9'::jsonb->>'quoteId')::uuid,
 'cc270000-0000-4000-8000-000000000051','card') as order_9 \gset
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'order_8')
 and (select status='pending' and calculation_version=2 from public.orders where id=:'order_9')
 and (select state='awaiting_payment' and source='cart_transaction' and (lines->0->>'qty')::int=2 from private.cart_order_holds where order_id=:'order_9')
 and (select qty=2 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' and variant_id=:'variant_a')
 then 1 else 0 end as assert_transaction_card_order_keeps_cart;
set local role service_role;
select public.quote_cart_goods_transaction('cc270000-0000-4000-8000-000000000002',:'cart_9',:'address','{}',null,0) as quote_10 \gset
select public.place_cart_goods_transaction('cc270000-0000-4000-8000-000000000002',:'cart_9',:'address',(:'quote_10'::jsonb->>'quoteId')::uuid,
 'cc270000-0000-4000-8000-000000000052','card') as order_10 \gset
select 1/case when public.place_cart_goods_transaction('cc270000-0000-4000-8000-000000000002',:'cart_9',:'address',(:'quote_10'::jsonb->>'quoteId')::uuid,
 'cc270000-0000-4000-8000-000000000052','card')=:'order_10'::uuid then 1 else 0 end as assert_transaction_replay_keeps_single_order;
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'order_9')
 and (select state='released' and release_reason='superseded' from private.cart_order_holds where order_id=:'order_9')
 and (select state='awaiting_payment' from private.cart_order_holds where order_id=:'order_10')
 and (select count(*)=1 from public.orders where user_id='cc270000-0000-4000-8000-000000000002' and status='pending' and payment_method='card'
  and id<>:'order_7'::uuid)
 then 1 else 0 end as assert_transaction_second_order_supersedes_first;
set local role authenticated;
select public.set_cart_item_quantity('retained-a',:'variant_a',3);
reset role;
set local role service_role;
select public.prepare_goods_payment_attempt('cc270000-0000-4000-8000-000000000002',:'order_10','toss')->>'id' as attempt_10 \gset
select public.bind_goods_payment_callback_nonce(:'attempt_10',repeat('9',64));
reset role;
select provider_order_id as provider_10 from public.payment_attempts where id=:'attempt_10' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'provider_10',repeat('9',64),'cc270000-0000-4000-8000-000000000053');
select public.finalize_goods_payment_attempt(:'attempt_10','cc270000-0000-4000-8000-000000000053','approved',null,'TEST-RETAINED-10');
reset role;
select 1/case when (select status='paid' from public.orders where id=:'order_10')
 and (select qty=1 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' and variant_id=:'variant_a')
 and (select state='consumed' and consumption#>>'{lines,0,outcome}'='decreased' from private.cart_order_holds where order_id=:'order_10')
 then 1 else 0 end as assert_transaction_payment_consumes_ordered_qty;
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as cart_11
 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002' \gset
set local role service_role;
select public.quote_cart_goods_transaction('cc270000-0000-4000-8000-000000000002',:'cart_11',:'address','{}',null,0) as quote_11 \gset
select public.place_cart_goods_transaction('cc270000-0000-4000-8000-000000000002',:'cart_11',:'address',(:'quote_11'::jsonb->>'quoteId')::uuid,
 'cc270000-0000-4000-8000-000000000054','bank_transfer') as order_11 \gset
reset role;
select 1/case when (select status='pending' and payment_method='bank_transfer' from public.orders where id=:'order_11')
 and not exists(select 1 from public.cart_items where user_id='cc270000-0000-4000-8000-000000000002')
 and not exists(select 1 from private.cart_order_holds where order_id=:'order_11')
 then 1 else 0 end as assert_transaction_bank_transfer_consumes_on_intake;

-- ── 9. 권한: 새 공개 함수는 서버 신뢰 경계만, 보류 원장은 어느 롤에도 직접 노출하지 않는다 ──
select 1/case when has_function_privilege('service_role','public.release_unpaid_cart_orders(uuid)','execute')
 and not has_function_privilege('authenticated','public.release_unpaid_cart_orders(uuid)','execute')
 and has_function_privilege('service_role','public.service_get_order_cart_retention(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.service_get_order_cart_retention(uuid,uuid)','execute')
 and public.service_get_order_cart_retention('cc270000-0000-4000-8000-000000000002',:'order_3')='{"state":"released","releaseReason":"superseded"}'::jsonb
 and public.service_get_order_cart_retention('cc270000-0000-4000-8000-000000000001',:'order_3') is null
 and public.service_get_order_cart_retention('cc270000-0000-4000-8000-000000000002',:'order_5') is null
 and not has_function_privilege('anon','public.release_unpaid_cart_orders(uuid)','execute')
 and not has_function_privilege('service_role','private.supersede_unpaid_cart_orders(uuid,boolean)','execute')
 and not has_function_privilege('service_role','private.close_unpaid_cart_order(uuid,text,text)','execute')
 and not has_function_privilege('service_role','private.record_cart_order_hold(uuid,uuid,text)','execute')
 and not has_table_privilege('service_role','private.cart_order_holds','select')
 and not has_table_privilege('authenticated','private.cart_order_holds','select')
 and has_function_privilege('service_role','public.place_order_with_cart_snapshot(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid,jsonb)','execute')
 and not has_function_privilege('authenticated','public.place_order_with_cart_snapshot(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid,jsonb)','execute')
 then 1 else 0 end as assert_cart_retention_acl;
rollback;
