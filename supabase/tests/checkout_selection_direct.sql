\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. 바로구매·장바구니 선택 주문(ADR-0030, 10/14 회의 1014-031~039).
-- Every amount/address/provider key is synthetic and rolled back.
begin;
create function pg_temp.d2_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
create function pg_temp.d2_cart(p_user uuid) returns jsonb language sql as $$
 select coalesce(jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)
  order by good_id,variant_id,input_key),'[]') from public.cart_items where user_id=p_user $$;
create function pg_temp.d2_lines(p_user uuid,p_goods text[]) returns jsonb language sql as $$
 select coalesce(jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)
  order by good_id,variant_id,input_key),'[]') from public.cart_items where user_id=p_user and good_id=any(p_goods) $$;
-- The minute pg_cron sweep only closes orders whose expires_at passed 5 minutes ago.
-- This transaction never ages an order that far, so the sweep cannot race these assertions.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('d2000000-0000-4000-8000-000000000001','authenticated','authenticated','d2-admin@example.test',now(),'{}','{}',now(),now()),
 ('d2000000-0000-4000-8000-000000000002','authenticated','authenticated','d2-buyer@example.test',now(),'{}','{}',now(),now()),
 ('d2000000-0000-4000-8000-000000000003','authenticated','authenticated','d2-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='d2-'||right(id::text,1)||'@example.test',nickname='TEST D2 '||right(id::text,1),birth_date='2000-01-01',
 onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='d2000000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('d2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003');
insert into public.ips(id,title,vertical_key,published_at) values('d2-ip','TEST D2 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('d2000000-0000-4000-8000-000000000010','d2-origin','TEST D2 출고지','hanjin',3000,'TEST 합성 반송지',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,member_purchase_limit_enabled,member_lifetime_qty_limit) values
 ('d2-a','d2-ip','TEST D2 A','문구',10000,'ok',20,'d2000000-0000-4000-8000-000000000010','policy',false,null),
 ('d2-b','d2-ip','TEST D2 B','문구',6000,'ok',20,'d2000000-0000-4000-8000-000000000010','policy',false,null),
 ('d2-c','d2-ip','TEST D2 C 한정','문구',5000,'ok',20,'d2000000-0000-4000-8000-000000000010','policy',true,2),
 ('d2-addon','d2-ip','TEST D2 추가 구성','문구',2000,'ok',20,'d2000000-0000-4000-8000-000000000010','policy',false,null);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,custom_inputs_enabled,custom_inputs_revision,custom_input_fields) values
 ('d2-input','d2-ip','TEST D2 각인','문구',4000,'ok',20,'d2000000-0000-4000-8000-000000000010','policy',true,1,
  '[{"id":"d2000000-0000-4000-8000-000000000061","name":"각인 문구","active":true}]');
insert into private.operator_memberships(profile_id,manager_role) values('d2000000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','d2-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='d2-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='d2-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='d2-ip';
select id as variant_a from public.goods_variants where good_id='d2-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='d2-b' and is_default \gset
select id as variant_c from public.goods_variants where good_id='d2-c' and is_default \gset
select id as variant_addon from public.goods_variants where good_id='d2-addon' and is_default \gset
select id as variant_input from public.goods_variants where good_id='d2-input' and is_default \gset
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_save_store_credit_policy('d2000000-0000-4000-8000-000000000020',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":0,"earnMaxPerOrder":0,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"TEST-ONLY D2 policy"}');
select public.admin_adjust_store_credit('d2000000-0000-4000-8000-000000000021','d2000000-0000-4000-8000-000000000002',30000,now()+interval '1 day','TEST 지급',0);
select public.admin_save_goods_additional('d2-a','{d2-addon}',null);
reset role;
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status) values
 ('D2CART2K','TEST D2 장바구니 2천','fixed',2000,0,now()-interval '1 day','active'),
 ('D2DIRECT1K','TEST D2 바로구매 1천','fixed',1000,0,now()-interval '1 day','active');
select '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset

-- ── 1. 장바구니 선택 삭제·전체 비우기(1014-035·036) ─────────────────────────────────────
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.set_cart_item_quantity('d2-a',:'variant_a',1);
select public.set_cart_item_quantity('d2-b',:'variant_b',2);
select public.set_cart_item_quantity_with_inputs('d2-input',:'variant_input',1,1,'{"d2000000-0000-4000-8000-000000000061":"TEST 각인 하나"}');
select public.set_cart_item_quantity_with_inputs('d2-input',:'variant_input',1,1,'{"d2000000-0000-4000-8000-000000000061":"TEST 각인 둘"}');
-- 선택 삭제: B 와 각인 '하나' 줄만 지운다. 같은 굿즈·옵션의 다른 직접입력값 줄('둘')은 남는다.
select 1/case when public.remove_cart_lines(jsonb_build_array(
  jsonb_build_object('good_id','d2-b','variant_id',:'variant_b','input_revision',0,'input_values','{}'::jsonb),
  jsonb_build_object('good_id','d2-input','variant_id',:'variant_input','input_revision',1,'input_values','{"d2000000-0000-4000-8000-000000000061":"TEST 각인 하나"}'::jsonb),
  -- 이미 없는 줄과 중복 줄은 조용히 건너뛴다(다른 탭이 먼저 지웠을 수 있다).
  jsonb_build_object('good_id','d2-b','variant_id',:'variant_b','input_revision',0,'input_values','{}'::jsonb),
  jsonb_build_object('good_id','d2-c','variant_id',:'variant_c','input_revision',0,'input_values','{}'::jsonb)))=2
 then 1 else 0 end as assert_remove_selected_lines_counts_only_existing;
select 1/case when (select count(*) from public.cart_items where user_id='d2000000-0000-4000-8000-000000000002')=2
 and exists(select 1 from public.cart_items where user_id='d2000000-0000-4000-8000-000000000002' and good_id='d2-a' and qty=1)
 and exists(select 1 from public.cart_items where user_id='d2000000-0000-4000-8000-000000000002' and good_id='d2-input'
  and input_values='{"d2000000-0000-4000-8000-000000000061":"TEST 각인 둘"}')
 then 1 else 0 end as assert_unselected_and_other_input_lines_remain;
-- 전체 비우기는 화면이 본 줄 전체를 넘긴다. 다른 계정의 장바구니는 건드리지 못한다.
reset role;
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select public.set_cart_item_quantity('d2-a',:'variant_a',3);
select 1/case when public.remove_cart_lines(jsonb_build_array(
  jsonb_build_object('good_id','d2-input','variant_id',:'variant_input','input_revision',1,'input_values','{"d2000000-0000-4000-8000-000000000061":"TEST 각인 둘"}'::jsonb)))=0
 then 1 else 0 end as assert_remove_never_touches_other_account;
reset role;
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select 1/case when public.remove_cart_lines((select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'input_revision',input_revision,'input_values',input_values))
  from public.cart_items where user_id='d2000000-0000-4000-8000-000000000002'))=2
 then 1 else 0 end as assert_clear_all_visible_lines;
reset role;
select 1/case when not exists(select 1 from public.cart_items where user_id='d2000000-0000-4000-8000-000000000002')
 and (select qty=3 from public.cart_items where user_id='d2000000-0000-4000-8000-000000000003' and good_id='d2-a')
 then 1 else 0 end as assert_clear_all_keeps_other_account_cart;
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.d2_expect_error($$select public.remove_cart_lines('[]')$$,'invalid cart lines');
select pg_temp.d2_expect_error($$select public.remove_cart_lines('[{"good_id":"d2-a","variant_id":"not-a-uuid","input_revision":0,"input_values":{}}]')$$,'invalid cart lines');
select pg_temp.d2_expect_error($$select public.remove_cart_lines('[{"good_id":"d2-a","variant_id":"00000000-0000-4000-8000-000000000000","input_revision":0,"input_values":{},"qty":1}]')$$,'invalid cart lines');
reset role;
select 1/case when has_function_privilege('authenticated','public.remove_cart_lines(jsonb)','execute')
 and not has_function_privilege('anon','public.remove_cart_lines(jsonb)','execute')
 and not has_function_privilege('service_role','public.remove_cart_lines(jsonb)','execute')
 then 1 else 0 end as assert_remove_cart_lines_acl;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.d2_expect_error($$select public.remove_cart_lines('[{"good_id":"d2-a","variant_id":"00000000-0000-4000-8000-000000000000","input_revision":0,"input_values":{}}]')$$,'auth required');
update public.profiles set suspended_at=now(),suspension_reason='TEST 정지' where id='d2000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.d2_expect_error(format('select public.remove_cart_lines(%L)',jsonb_build_array(
  jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','input_revision',0,'input_values','{}'::jsonb)))::text,'account_suspended');
reset role;
update public.profiles set suspended_at=null,suspension_reason=null where id='d2000000-0000-4000-8000-000000000003';

-- ── 2. 장바구니 선택 주문(1014-031·032): 체크한 줄만 주문, 나머지는 결제 뒤에도 남는다 ────────────
update public.goods set order_quantity_limit_enabled=true,min_order_qty=1,max_order_qty=2 where id='d2-input';
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.set_cart_item_quantity('d2-a',:'variant_a',1);
select public.set_cart_item_quantity('d2-b',:'variant_b',2);
select public.set_cart_item_quantity('d2-c',:'variant_c',1);
select public.set_cart_item_quantity_with_inputs('d2-input',:'variant_input',2,1,'{"d2000000-0000-4000-8000-000000000061":"TEST 선택 각인"}');
select public.set_cart_item_quantity_with_inputs('d2-input',:'variant_input',1,1,'{"d2000000-0000-4000-8000-000000000061":"TEST 남길 각인"}');
select public.apply_cart_coupon_code('D2CART2K') as cart_coupon \gset
-- 고른 품목 기준 적립금 사용 한도: A(10,000) + B(12,000) + 각인 2개(8,000) = 30,000 − 쿠폰 2,000.
select (public.get_my_store_credit_checkout_for_items(0,'{"postalCode":"12345","address1":"TEST 합성 주소"}'::jsonb,jsonb_build_array(
  jsonb_build_object('goodId','d2-a','variantId',:'variant_a','qty',1),
  jsonb_build_object('goodId','d2-b','variantId',:'variant_b','qty',2),
  jsonb_build_object('goodId','d2-input','variantId',:'variant_input','qty',2)))->>'maxUse')::bigint as selected_credit_max \gset
reset role;
select 1/case when :selected_credit_max=28000 then 1 else 0 end as assert_store_credit_limit_uses_selected_items_and_cart_coupon;
-- 선택 초안: A·B·'선택 각인' 줄. 화면이 본 줄과 지금 장바구니가 같아야 한다.
select jsonb_agg(value) as selection_lines from jsonb_array_elements(pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002')) value
 where value->>'good_id' in ('d2-a','d2-b') or value->'input_values'->>'d2000000-0000-4000-8000-000000000061'='TEST 선택 각인' \gset
set local role service_role;
select public.service_create_checkout_selection_draft('d2000000-0000-4000-8000-000000000002',:'selection_lines') as selection_draft \gset
select pg_temp.d2_expect_error(format('select public.service_create_checkout_selection_draft(%L,%L)','d2000000-0000-4000-8000-000000000002',
  jsonb_build_array(jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',5,'input_revision',0,'input_values','{}'::jsonb))),'cart_snapshot_changed');
-- 다른 계정의 장바구니 줄로는 초안을 만들 수 없다(그 계정 장바구니와 맞지 않는다).
select pg_temp.d2_expect_error(format('select public.service_create_checkout_selection_draft(%L,%L)','d2000000-0000-4000-8000-000000000003',:'selection_lines'),'cart_snapshot_changed');
select public.service_get_checkout_draft('d2000000-0000-4000-8000-000000000002',:'selection_draft') as selection_draft_view \gset
reset role;
select 1/case when (:'selection_draft_view'::jsonb->>'source')='selection' and not (:'selection_draft_view'::jsonb->>'stale')::boolean
 and jsonb_array_length(:'selection_draft_view'::jsonb->'lines')=3
 and (select count(*) from jsonb_array_elements(:'selection_draft_view'::jsonb->'lines') line where line->'customInputs'->'fields'->0->>'value'='TEST 선택 각인')=1
 and public.service_get_checkout_draft('d2000000-0000-4000-8000-000000000003',:'selection_draft') is null
 then 1 else 0 end as assert_selection_draft_is_owned_and_carries_custom_inputs_privately;
-- 다른 탭에서 고른 줄(B)의 수량을 바꾸면 초안이 낡았다고 알리고, 주문은 PT409로 아무것도 만들지 않는다.
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.set_cart_item_quantity('d2-b',:'variant_b',3);
reset role;
set local role service_role;
select 1/case when (public.service_get_checkout_draft('d2000000-0000-4000-8000-000000000002',:'selection_draft')->>'stale')::boolean
 then 1 else 0 end as assert_changed_selected_line_marks_draft_stale;
select pg_temp.d2_expect_error(format('select public.place_order_with_cart_selection(%L,%L,%L,%L,%L,0,%L)',
  'd2000000-0000-4000-8000-000000000002',:'selection_draft',:'address','d2000000-0000-4000-8000-000000000101','card',:'cart_coupon'),'cart_snapshot_changed');
reset role;
select 1/case when not exists(select 1 from public.orders where user_id='d2000000-0000-4000-8000-000000000002')
 and (select status='active' from public.user_coupons where id=:'cart_coupon')
 then 1 else 0 end as assert_stale_selection_creates_nothing;
-- 수량을 되돌리면(같은 줄 같은 수량) 같은 초안으로 주문된다. 미선택 줄(C·'남길 각인')은 건드리지 않는다.
set local role authenticated;
select public.set_cart_item_quantity('d2-b',:'variant_b',2);
reset role;
set local role service_role;
select public.place_order_with_cart_selection('d2000000-0000-4000-8000-000000000002',:'selection_draft',:'address',
 'd2000000-0000-4000-8000-000000000102','card',1000,:'cart_coupon') as selection_order \gset
-- 같은 키 재요청은 초안·장바구니를 다시 보지 않고 원래 주문을 돌려준다.
select 1/case when public.place_order_with_cart_selection('d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-0000000000ff',:'address',
 'd2000000-0000-4000-8000-000000000102','card',1000,:'cart_coupon')=:'selection_order'::uuid then 1 else 0 end as assert_selection_replay_returns_same_order;
reset role;
select 1/case when (select count(*) from public.order_items where order_id=:'selection_order')=3
 and (select sum(qty) from public.order_items where order_id=:'selection_order')=5
 and not exists(select 1 from public.order_items where order_id=:'selection_order' and good_id='d2-c')
 and (select total=30000+3000-2000-1000 and shipping_fee=3000 and discount_total=2000 and store_credit_total=1000 from public.orders where id=:'selection_order')
 and (select eligible_subtotal=30000 from public.coupon_redemptions where order_id=:'selection_order')
 and (select state='awaiting_payment' and source='legacy_checkout' and jsonb_array_length(lines)=3
  and not exists(select 1 from jsonb_array_elements(lines) line where line->>'goodId'='d2-c') from private.cart_order_holds where order_id=:'selection_order')
 and (select count(*)=5 from public.cart_items where user_id='d2000000-0000-4000-8000-000000000002')
 and (select stock_qty=19 from public.goods_variants where id=:'variant_a')
 and (select stock_qty=20 from public.goods_variants where id=:'variant_c')
 and coalesce(current_setting('icons.checkout_draft',true),'')=''
 and coalesce(current_setting('icons.cart_order_retention',true),'')=''
 then 1 else 0 end as assert_selection_orders_only_checked_lines_and_holds_them;
-- 결제 확정: 고른 줄만 장바구니에서 빠지고 C·'남길 각인'은 남는다. 쿠폰 선택은 쓴 쿠폰이라 지운다.
set local role service_role;
select public.prepare_goods_payment_attempt('d2000000-0000-4000-8000-000000000002',:'selection_order','toss')->>'id' as selection_attempt \gset
select public.bind_goods_payment_callback_nonce(:'selection_attempt',repeat('a',64));
reset role;
select provider_order_id as selection_provider from public.payment_attempts where id=:'selection_attempt' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'selection_provider',repeat('a',64),'d2000000-0000-4000-8000-000000000141');
select public.finalize_goods_payment_attempt(:'selection_attempt','d2000000-0000-4000-8000-000000000141','approved',null,'TEST-D2-SELECTION');
reset role;
select 1/case when (select status='paid' from public.orders where id=:'selection_order')
 and (select count(*)=2 from public.cart_items where user_id='d2000000-0000-4000-8000-000000000002')
 and exists(select 1 from public.cart_items where user_id='d2000000-0000-4000-8000-000000000002' and good_id='d2-c' and qty=1)
 and exists(select 1 from public.cart_items where user_id='d2000000-0000-4000-8000-000000000002' and good_id='d2-input'
  and input_values->>'d2000000-0000-4000-8000-000000000061'='TEST 남길 각인')
 and not exists(select 1 from public.cart_coupon_selections where user_id='d2000000-0000-4000-8000-000000000002')
 and (select state='consumed' and (select bool_and(line->>'outcome'='removed') from jsonb_array_elements(consumption->'lines') line)
  from private.cart_order_holds where order_id=:'selection_order')
 then 1 else 0 end as assert_payment_removes_only_selected_lines;
-- 주문당 수량 한도는 고른 줄의 합이다: 각인 굿즈 한도 2개 — '남길 각인'(1) + 새 줄(2) 중 1줄만 고르면 통과한다.
set local role authenticated;
select public.set_cart_item_quantity_with_inputs('d2-input',:'variant_input',2,1,'{"d2000000-0000-4000-8000-000000000061":"TEST 두 번째 각인"}');
reset role;
select pg_temp.d2_lines('d2000000-0000-4000-8000-000000000002',array['d2-input']) as both_input_lines \gset
select jsonb_agg(value) as one_input_line from jsonb_array_elements(:'both_input_lines'::jsonb) value
 where value->'input_values'->>'d2000000-0000-4000-8000-000000000061'='TEST 두 번째 각인' \gset
set local role service_role;
select public.service_create_checkout_selection_draft('d2000000-0000-4000-8000-000000000002',:'both_input_lines') as over_limit_draft \gset
select pg_temp.d2_expect_error(format('select public.place_order_with_cart_selection(%L,%L,%L,%L,%L,0,null)',
  'd2000000-0000-4000-8000-000000000002',:'over_limit_draft',:'address','d2000000-0000-4000-8000-000000000103','bank_transfer'),'order_quantity_above_maximum');
-- 무통장은 접수 = 주문 완료다. 고른 줄만 접수 때 빠지고 보류는 없다.
select public.service_create_checkout_selection_draft('d2000000-0000-4000-8000-000000000002',:'one_input_line') as bank_draft \gset
select public.place_order_with_cart_selection('d2000000-0000-4000-8000-000000000002',:'bank_draft',:'address',
 'd2000000-0000-4000-8000-000000000104','bank_transfer',0,null) as bank_selection_order \gset
reset role;
select 1/case when (select status='pending' and payment_method='bank_transfer' from public.orders where id=:'bank_selection_order')
 and (select sum(qty)=2 from public.order_items where order_id=:'bank_selection_order')
 and not exists(select 1 from private.cart_order_holds where order_id=:'bank_selection_order')
 and not exists(select 1 from public.cart_items where user_id='d2000000-0000-4000-8000-000000000002'
  and input_values->>'d2000000-0000-4000-8000-000000000061'='TEST 두 번째 각인')
 and (select count(*)=2 from public.cart_items where user_id='d2000000-0000-4000-8000-000000000002')
 then 1 else 0 end as assert_bank_transfer_selection_consumes_only_selected_lines;
-- 초안은 만료되면 쓸 수 없고 읽히지도 않는다. 만료 정리 함수는 서버 신뢰 경계만 부른다.
update private.checkout_drafts set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 minute' where id=:'over_limit_draft';
set local role service_role;
select pg_temp.d2_expect_error(format('select public.place_order_with_cart_selection(%L,%L,%L,%L,%L,0,null)',
  'd2000000-0000-4000-8000-000000000002',:'over_limit_draft',:'address','d2000000-0000-4000-8000-000000000105','bank_transfer'),'checkout_draft_expired');
select 1/case when public.service_get_checkout_draft('d2000000-0000-4000-8000-000000000002',:'over_limit_draft') is null
 and public.purge_expired_checkout_drafts(10)>=1 then 1 else 0 end as assert_expired_draft_unusable_and_purged;
reset role;
select 1/case when not exists(select 1 from private.checkout_drafts where id=:'over_limit_draft') then 1 else 0 end as assert_expired_draft_row_deleted;
-- 옛 진입점(장바구니 전체 스냅샷)은 그대로다: 초안 설정 없이 부르면 장바구니 전체가 주문된다.
select pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002') as whole_cart \gset
set local role service_role;
select public.place_order_with_cart_snapshot('d2000000-0000-4000-8000-000000000002',:'address','d2000000-0000-4000-8000-000000000106','card',0,null,:'whole_cart') as whole_order \gset
reset role;
select 1/case when (select count(*) from public.order_items where order_id=:'whole_order')=2
 and (select jsonb_array_length(lines)=2 from private.cart_order_holds where order_id=:'whole_order')
 then 1 else 0 end as assert_whole_cart_snapshot_contract_unchanged;
select 1/case when has_function_privilege('service_role','public.place_order_with_cart_selection(uuid,uuid,jsonb,uuid,public.order_payment_method,bigint,uuid)','execute')
 and not has_function_privilege('authenticated','public.place_order_with_cart_selection(uuid,uuid,jsonb,uuid,public.order_payment_method,bigint,uuid)','execute')
 and has_function_privilege('service_role','public.service_create_checkout_selection_draft(uuid,jsonb)','execute')
 and not has_function_privilege('authenticated','public.service_create_checkout_selection_draft(uuid,jsonb)','execute')
 and has_function_privilege('service_role','public.service_get_checkout_draft(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.service_get_checkout_draft(uuid,uuid)','execute')
 and not has_function_privilege('anon','public.get_my_store_credit_checkout_for_items(bigint,jsonb,jsonb)','execute')
 and has_function_privilege('authenticated','public.get_my_store_credit_checkout_for_items(bigint,jsonb,jsonb)','execute')
 and not has_function_privilege('authenticated','public.purge_expired_checkout_drafts(integer)','execute')
 and not has_function_privilege('service_role','private.checkout_source_lines(uuid,boolean)','execute')
 and not has_function_privilege('service_role','private.record_checkout_order_hold(uuid,uuid,text,jsonb)','execute')
 and not has_table_privilege('service_role','private.checkout_drafts','select')
 and not has_table_privilege('authenticated','private.checkout_drafts','select')
 then 1 else 0 end as assert_selection_acl;

-- ── 2b. 결제 없이 끝난 선택 주문의 '다시 결제하기'는 그 주문의 줄만 다시 고른다 ──────────────────────
-- 지금 장바구니: C(1), '남길 각인'(1). 앞 절의 카드 주문(whole_order)은 아직 결제 대기다.
select jsonb_agg(value) as c_only from jsonb_array_elements(pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002')) value where value->>'good_id'='d2-c' \gset
set local role service_role;
select public.service_create_checkout_selection_draft('d2000000-0000-4000-8000-000000000002',:'c_only') as c_draft \gset
select public.place_order_with_cart_selection('d2000000-0000-4000-8000-000000000002',:'c_draft',:'address',
 'd2000000-0000-4000-8000-000000000107','card',0,null) as c_order \gset
select public.prepare_goods_payment_attempt('d2000000-0000-4000-8000-000000000002',:'c_order','toss')->>'id' as c_attempt \gset
select public.bind_goods_payment_callback_nonce(:'c_attempt',repeat('c',64));
reset role;
select provider_order_id as c_provider from public.payment_attempts where id=:'c_attempt' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'c_provider',repeat('c',64),'d2000000-0000-4000-8000-000000000142');
select public.finalize_goods_payment_attempt(:'c_attempt','d2000000-0000-4000-8000-000000000142','declined');
reset role;
-- 결제가 거절된 뒤 C 수량을 늘렸다. 다시 결제 초안은 C 한 줄(지금 수량)만이고 '남길 각인'은 끼지 않는다.
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.set_cart_item_quantity('d2-c',:'variant_c',2);
reset role;
set local role service_role;
select public.service_create_checkout_retry_draft('d2000000-0000-4000-8000-000000000002',:'c_order') as retry_draft \gset
select public.service_get_checkout_draft('d2000000-0000-4000-8000-000000000002',:'retry_draft') as retry_view \gset
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'whole_order')
 and (:'retry_view'::jsonb->>'source')='selection' and jsonb_array_length(:'retry_view'::jsonb->'lines')=1
 and (:'retry_view'::jsonb->'lines'->0->>'goodId')='d2-c' and (:'retry_view'::jsonb->'lines'->0->>'qty')::int=2
 then 1 else 0 end as assert_retry_draft_keeps_original_selection_with_current_qty;
-- 장바구니에서 그 줄이 사라졌거나, 장바구니 주문이 아니거나(무통장·다른 계정) 다시 결제 초안은 없다.
set local role service_role;
select 1/case when public.service_create_checkout_retry_draft('d2000000-0000-4000-8000-000000000002',:'bank_selection_order') is null
 and public.service_create_checkout_retry_draft('d2000000-0000-4000-8000-000000000003',:'c_order') is null
 then 1 else 0 end as assert_retry_draft_only_for_own_cart_orders;
reset role;
set local role authenticated;
select public.set_cart_item_quantity('d2-c',:'variant_c',0);
reset role;
set local role service_role;
select 1/case when public.service_create_checkout_retry_draft('d2000000-0000-4000-8000-000000000002',:'c_order') is null
 then 1 else 0 end as assert_retry_draft_absent_when_lines_left_cart;
reset role;
select 1/case when has_function_privilege('service_role','public.service_create_checkout_retry_draft(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.service_create_checkout_retry_draft(uuid,uuid)','execute')
 then 1 else 0 end as assert_retry_draft_acl;

rollback;
