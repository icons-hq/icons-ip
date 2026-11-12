\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. 바로구매·장바구니 선택 주문(ADR-0030, 10/14 회의 1014-031~039).
-- Every amount/address/provider key is synthetic and rolled back.
begin;
create function pg_temp.d2_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
-- 거절 메시지와 detail(같은 주문서 재제출이면 원 주문 id)을 함께 돌려준다.
create function pg_temp.d2_error_detail(statement text) returns text language plpgsql as $$
declare v_detail text;begin
 begin execute statement;exception when others then get stacked diagnostics v_detail=pg_exception_detail;return sqlerrm||'|'||coalesce(v_detail,'');end;
 raise exception 'Expected an error: %',statement;
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
-- 초안은 만료되면 쓸 수 없다. 본인 초안이면 출처만 읽히고(줄 없음, closed = expired) 다른 계정에는 없다.
-- 만료 정리 함수(서버 신뢰 경계만 부른다)는 줄(직접입력값)을 지워 흔적만 남기고, 흔적도 보관 기간 뒤 지운다.
update private.checkout_drafts set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 minute' where id=:'over_limit_draft';
set local role service_role;
select pg_temp.d2_expect_error(format('select public.place_order_with_cart_selection(%L,%L,%L,%L,%L,0,null)',
  'd2000000-0000-4000-8000-000000000002',:'over_limit_draft',:'address','d2000000-0000-4000-8000-000000000105','bank_transfer'),'checkout_draft_expired');
select public.service_get_checkout_draft('d2000000-0000-4000-8000-000000000002',:'over_limit_draft') as expired_view \gset
select 1/case when :'expired_view'::jsonb->>'closed'='expired' and :'expired_view'::jsonb->>'source'='selection'
 and jsonb_array_length(:'expired_view'::jsonb->'lines')=0 and not (:'expired_view'::jsonb->>'stale')::boolean
 and public.service_get_checkout_draft('d2000000-0000-4000-8000-000000000003',:'over_limit_draft') is null
 and public.purge_expired_checkout_drafts(10)>=1 then 1 else 0 end as assert_expired_draft_closed_and_purged;
reset role;
select 1/case when (select lines='[]'::jsonb and scrubbed_at is not null from private.checkout_drafts where id=:'over_limit_draft')
 then 1 else 0 end as assert_expired_draft_lines_scrubbed;
update private.checkout_drafts set created_at=clock_timestamp()-interval '9 days',expires_at=clock_timestamp()-interval '8 days' where id=:'over_limit_draft';
set local role service_role;
select 1/case when public.purge_expired_checkout_drafts(10)>=1 then 1 else 0 end as assert_trace_purge_counts;
reset role;
select 1/case when not exists(select 1 from private.checkout_drafts where id=:'over_limit_draft') then 1 else 0 end as assert_expired_trace_deleted_after_retention;
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

-- ── 3. 바로구매(1014-033·034·037·038): 그 상품만 주문하고 장바구니는 읽지도 바꾸지도 않는다 ──────────
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status) values
 ('D2CART3K','TEST D2 장바구니 3천','fixed',3000,0,now()-interval '1 day','active'),
 ('D2SHIP','TEST D2 배송비','fixed',3000,0,now()-interval '1 day','active');
update public.coupons set benefit_kind='shipping' where code='D2SHIP';
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
-- 바로구매 쿠폰과 배송비 쿠폰은 보유만 하고, 장바구니에는 3천 쿠폰을 골라 둔다.
select public.apply_cart_coupon_code('D2DIRECT1K') as direct_coupon \gset
select public.clear_cart_coupon();
select public.apply_cart_coupon_code('D2CART3K') as cart3_coupon \gset
-- 장바구니: A 1개(바로구매할 상품과 같다), B 2개.
select public.set_cart_item_quantity('d2-a',:'variant_a',1);
select public.set_cart_item_quantity('d2-b',:'variant_b',2);
-- 주문서에서 고른 쿠폰으로 견적한다. 장바구니 쿠폰 선택(3천)은 쓰지 않는다.
select public.quote_goods_sales_for_address_with_coupon(jsonb_build_array(jsonb_build_object('goodId','d2-a','variantId',:'variant_a','qty',1)),
 null,:'direct_coupon') as direct_quote \gset
reset role;
select 1/case when (:'direct_quote'::jsonb->'coupon'->>'userCouponId')=:'direct_coupon' and (:'direct_quote'::jsonb->'coupon'->>'discount')::int=1000
 and (:'direct_quote'::jsonb->>'subtotal')::int=10000 then 1 else 0 end as assert_direct_quote_uses_checkout_coupon_not_cart_selection;
select pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002') as cart_before_direct \gset
-- 바로구매 초안: A 1개 + 연결된 추가 구성 1개. 직접입력값은 서버 초안에만 둔다.
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-a',jsonb_build_array(
  jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',1),
  jsonb_build_object('good_id','d2-addon','variant_id',:'variant_addon','qty',1))) as direct_draft \gset
select public.service_get_checkout_draft('d2000000-0000-4000-8000-000000000002',:'direct_draft') as direct_view \gset
-- 연결되지 않은 굿즈·본품 없는 선택·중복 줄·다른 굿즈의 옵션은 초안이 되지 않는다.
select pg_temp.d2_expect_error(format('select public.service_create_checkout_direct_draft(%L,%L,%L)','d2000000-0000-4000-8000-000000000002','d2-a',
  jsonb_build_array(jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',1),jsonb_build_object('good_id','d2-b','variant_id',:'variant_b','qty',1))),'additional_good_unavailable');
select pg_temp.d2_expect_error(format('select public.service_create_checkout_direct_draft(%L,%L,%L)','d2000000-0000-4000-8000-000000000002','d2-a',
  jsonb_build_array(jsonb_build_object('good_id','d2-addon','variant_id',:'variant_addon','qty',1))),'invalid_checkout_direct');
select pg_temp.d2_expect_error(format('select public.service_create_checkout_direct_draft(%L,%L,%L)','d2000000-0000-4000-8000-000000000002','d2-a',
  jsonb_build_array(jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',1),jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',2))),'invalid_checkout_direct');
select pg_temp.d2_expect_error(format('select public.service_create_checkout_direct_draft(%L,%L,%L)','d2000000-0000-4000-8000-000000000002','d2-a',
  jsonb_build_array(jsonb_build_object('good_id','d2-a','variant_id',:'variant_b','qty',1))),'catalog_item_unavailable');
select pg_temp.d2_expect_error(format('select public.service_create_checkout_direct_draft(%L,%L,%L)','d2000000-0000-4000-8000-000000000002','d2-input',
  jsonb_build_array(jsonb_build_object('good_id','d2-input','variant_id',:'variant_input','qty',1,'input_revision',1,'input_values','{}'::jsonb))),'goods_custom_inputs');
-- 배송비 쿠폰은 legacy 주문서가 받지 않는다.
reset role;
insert into public.user_coupons(coupon_code,user_id,issued_source,usable_from)
 values('D2SHIP','d2000000-0000-4000-8000-000000000002','admin_grant',now()-interval '1 minute') returning id as ship_coupon \gset
set local role service_role;
select pg_temp.d2_expect_error(format('select public.place_direct_order(%L,%L,%L,%L,%L,0,%L)','d2000000-0000-4000-8000-000000000002',:'direct_draft',:'address',
  'd2000000-0000-4000-8000-000000000201','card',:'ship_coupon'),'coupon_checkout_required');
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'direct_draft',:'address','d2000000-0000-4000-8000-000000000202','card',500,:'direct_coupon') as direct_order \gset
select 1/case when public.place_direct_order('d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-0000000000ff',:'address',
  'd2000000-0000-4000-8000-000000000202','card',500,:'direct_coupon')=:'direct_order'::uuid then 1 else 0 end as assert_direct_replay_returns_same_order;
select public.service_get_order_cart_retention('d2000000-0000-4000-8000-000000000002',:'direct_order') as direct_retention \gset
reset role;
select 1/case when (:'direct_view'::jsonb->>'source')='direct' and (:'direct_view'::jsonb->>'baseGoodId')='d2-a' and jsonb_array_length(:'direct_view'::jsonb->'lines')=2
 and (select count(*) from public.order_items where order_id=:'direct_order')=2
 and (select sum(qty) from public.order_items where order_id=:'direct_order' and good_id='d2-a')=1
 and not exists(select 1 from public.order_items where order_id=:'direct_order' and good_id='d2-b')
 and (select discount_total=1000 and store_credit_total=500 from public.orders where id=:'direct_order')
 and (select status='used' and used_order_id=:'direct_order'::uuid from public.user_coupons where id=:'direct_coupon')
 and pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002')=:'cart_before_direct'::jsonb
 and (select user_coupon_id=:'cart3_coupon'::uuid from public.cart_coupon_selections where user_id='d2000000-0000-4000-8000-000000000002')
 and (select state='awaiting_payment' and source='direct_checkout' and base_good_id='d2-a' and jsonb_array_length(lines)=2
  from private.cart_order_holds where order_id=:'direct_order')
 and :'direct_retention'::jsonb='{"state":"awaiting_payment","releaseReason":null,"source":"direct","baseGoodId":"d2-a"}'::jsonb
 then 1 else 0 end as assert_direct_orders_only_that_good_with_its_qty_and_keeps_cart_and_cart_coupon;
-- 장바구니 화면 복귀는 바로구매 결제창을 끊지 않는다(장바구니 출처만 닫는다). 바로구매 주문서 진입은 모두 닫는다.
set local role service_role;
select 1/case when public.release_unpaid_cart_orders('d2000000-0000-4000-8000-000000000002')=0 then 1 else 0 end as assert_cart_return_keeps_direct_payment;
reset role;
select 1/case when (select status='pending' from public.orders where id=:'direct_order') then 1 else 0 end as assert_direct_order_still_pending_after_cart_return;
-- 같은 상품을 다른 탭에서 다시 바로구매한다: 새 주문이 이전 바로구매를 닫고 쿠폰·재고를 돌려받아 다시 쓴다.
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-a',jsonb_build_array(
  jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',1))) as direct_draft_2 \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'direct_draft_2',:'address','d2000000-0000-4000-8000-000000000203','card',0,:'direct_coupon') as direct_order_2 \gset
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'direct_order')
 and (select state='released' and release_reason='superseded' from private.cart_order_holds where order_id=:'direct_order')
 and (select status='used' and used_order_id=:'direct_order_2'::uuid from public.user_coupons where id=:'direct_coupon')
 and exists(select 1 from public.audit_log where action='system.order.unpaid_cart_order_closed' and target='order:'||:'direct_order'
  and diff->>'trigger'='new_direct_order')
 and pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002')=:'cart_before_direct'::jsonb
 then 1 else 0 end as assert_second_tab_direct_supersedes_first_direct;
-- 출처를 건너도 다른 탭 중복 주문 방지는 같다: 장바구니 선택 주문이 바로구매 미결제 주문을 닫는다.
select jsonb_agg(value) as b_only from jsonb_array_elements(pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002')) value where value->>'good_id'='d2-b' \gset
set local role service_role;
select public.service_create_checkout_selection_draft('d2000000-0000-4000-8000-000000000002',:'b_only') as b_draft \gset
select public.place_order_with_cart_selection('d2000000-0000-4000-8000-000000000002',:'b_draft',:'address','d2000000-0000-4000-8000-000000000204','card',0,:'cart3_coupon') as b_order \gset
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'direct_order_2')
 and (select state='released' and release_reason='superseded' from private.cart_order_holds where order_id=:'direct_order_2')
 and (select status='active' from public.user_coupons where id=:'direct_coupon')
 and (select status='pending' from public.orders where id=:'b_order')
 then 1 else 0 end as assert_cart_selection_order_supersedes_direct_order;
-- 바로구매가 이전 장바구니 미결제 주문(B)을 닫고, 장바구니 쿠폰 선택(3천)을 바로구매 쿠폰으로 고르면 결제 확정 때 그 선택을 해제한다.
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-a',jsonb_build_array(
  jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',1))) as direct_draft_3 \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'direct_draft_3',:'address','d2000000-0000-4000-8000-000000000205','card',0,:'cart3_coupon') as direct_order_3 \gset
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'b_order')
 and (select user_coupon_id=:'cart3_coupon'::uuid from public.cart_coupon_selections where user_id='d2000000-0000-4000-8000-000000000002')
 then 1 else 0 end as assert_direct_supersedes_cart_order_and_keeps_cart_coupon_until_payment;
set local role service_role;
select public.prepare_goods_payment_attempt('d2000000-0000-4000-8000-000000000002',:'direct_order_3','toss')->>'id' as direct_attempt \gset
select public.bind_goods_payment_callback_nonce(:'direct_attempt',repeat('d',64));
reset role;
select provider_order_id as direct_provider from public.payment_attempts where id=:'direct_attempt' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'direct_provider',repeat('d',64),'d2000000-0000-4000-8000-000000000143');
select public.finalize_goods_payment_attempt(:'direct_attempt','d2000000-0000-4000-8000-000000000143','approved',null,'TEST-D2-DIRECT');
reset role;
select 1/case when (select status='paid' from public.orders where id=:'direct_order_3')
 and pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002')=:'cart_before_direct'::jsonb
 and not exists(select 1 from public.cart_coupon_selections where user_id='d2000000-0000-4000-8000-000000000002')
 and (select state='consumed' and consumption->'lines'='[]'::jsonb and (consumption->>'couponSelectionCleared')::boolean
  from private.cart_order_holds where order_id=:'direct_order_3')
 then 1 else 0 end as assert_direct_payment_keeps_cart_lines_and_clears_same_cart_coupon;
-- 무통장 바로구매: 장바구니 줄은 그대로, 같은 쿠폰의 장바구니 선택만 접수 때 해제한다. 보류는 없다.
set local role authenticated;
select public.apply_cart_coupon(:'direct_coupon');
reset role;
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-b',jsonb_build_array(
  jsonb_build_object('good_id','d2-b','variant_id',:'variant_b','qty',3))) as direct_bank_draft \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'direct_bank_draft',:'address','d2000000-0000-4000-8000-000000000206','bank_transfer',0,:'direct_coupon') as direct_bank_order \gset
reset role;
select 1/case when (select status='pending' and payment_method='bank_transfer' from public.orders where id=:'direct_bank_order')
 and (select sum(qty)=3 from public.order_items where order_id=:'direct_bank_order')
 and pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002')=:'cart_before_direct'::jsonb
 and not exists(select 1 from public.cart_coupon_selections where user_id='d2000000-0000-4000-8000-000000000002')
 and not exists(select 1 from private.cart_order_holds where order_id=:'direct_bank_order')
 then 1 else 0 end as assert_bank_transfer_direct_keeps_cart_and_releases_same_cart_coupon;
-- 주문서·장바구니를 열기만 해서는 바로구매 결제를 끊지 않는다. 견적이 결제 대기 주문 때문에 막혀 고객이 확인창에서 본 결제
-- 대기 주문(service_list_unpaid_checkout_orders)을 '결제 대기 주문 취소하고 계속'으로 확인할 때만 그 주문들을 출처와 무관하게
-- 닫는다. 무통장 입금 대기는 목록에 없고 닫지 않는다.
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-a',jsonb_build_array(
  jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',1))) as direct_draft_4 \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'direct_draft_4',:'address','d2000000-0000-4000-8000-000000000207','card',0,null) as direct_order_4 \gset
-- 장바구니 진입의 닫기(장바구니 출처만)는 바로구매 주문을 닫지 않는다.
select 1/case when public.release_unpaid_cart_orders('d2000000-0000-4000-8000-000000000002')=0 then 1 else 0 end as assert_cart_entry_keeps_direct_payment;
select public.service_list_unpaid_checkout_orders('d2000000-0000-4000-8000-000000000002') as unpaid_list \gset
select pg_temp.d2_expect_error(format('select public.release_unpaid_checkout_orders(%L,%L)','d2000000-0000-4000-8000-000000000002','{}'),'cart_order_supersede_invalid');
select public.release_unpaid_checkout_orders('d2000000-0000-4000-8000-000000000002',array[:'direct_order_4']::uuid[]) as customer_release \gset
select public.release_unpaid_checkout_orders('d2000000-0000-4000-8000-000000000002',array[:'direct_order_4']::uuid[]) as customer_release_again \gset
select public.service_list_unpaid_checkout_orders('d2000000-0000-4000-8000-000000000002') as unpaid_list_after \gset
reset role;
select 1/case when jsonb_array_length(:'unpaid_list'::jsonb)=1
 and :'unpaid_list'::jsonb->0->>'id'=:'direct_order_4'
 and (:'unpaid_list'::jsonb->0->>'releasable')::boolean
 and (:'unpaid_list'::jsonb->0->>'itemCount')::integer=1
 and :'unpaid_list'::jsonb->0->'goodIds'='["d2-a"]'::jsonb
 and :'unpaid_list'::jsonb->0->'variantIds'=jsonb_build_array(:'variant_a')
 and :'unpaid_list'::jsonb->0->'userCouponIds'='[]'::jsonb
 and :'unpaid_list'::jsonb->0->>'orderNumber'=(select order_number from public.orders where id=:'direct_order_4')
 and :'unpaid_list'::jsonb->0->>'itemName'=(select good_name_snapshot from public.order_items where order_id=:'direct_order_4')
 and (:'unpaid_list'::jsonb->0->>'total')::bigint=(select total from public.orders where id=:'direct_order_4')
 and (:'customer_release'::jsonb->>'released')::integer=1 and (:'customer_release'::jsonb->>'confirming')::integer=0
 and (:'customer_release_again'::jsonb->>'released')::integer=0
 -- 무통장 입금 대기(direct_bank_order)는 목록에도 없고 닫지도 않는다.
 and :'unpaid_list_after'::jsonb='[]'::jsonb
 then 1 else 0 end as assert_customer_release_closes_listed_unpaid_card_orders;
select 1/case when (select status='canceled' from public.orders where id=:'direct_order_4')
 and exists(select 1 from public.audit_log where action='system.order.unpaid_cart_order_closed' and target='order:'||:'direct_order_4'
  and diff->>'trigger'='customer_released')
 and (select status='pending' from public.orders where id=:'direct_bank_order')
 then 1 else 0 end as assert_customer_release_closes_card_holds_only;
-- 결제 승인을 확인 중인 주문은 닫지 않고 confirming으로 알린다(새 주문의 checkout_payment_in_progress와 같은 판단).
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-a',jsonb_build_array(
  jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',1))) as direct_draft_5 \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'direct_draft_5',:'address','d2000000-0000-4000-8000-000000000209','card',0,null) as direct_order_5 \gset
select public.prepare_goods_payment_attempt('d2000000-0000-4000-8000-000000000002',:'direct_order_5','toss')->>'id' as confirming_attempt \gset
select public.bind_goods_payment_callback_nonce(:'confirming_attempt',repeat('e',64));
reset role;
select provider_order_id as confirming_provider from public.payment_attempts where id=:'confirming_attempt' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'confirming_provider',repeat('e',64),'d2000000-0000-4000-8000-000000000144');
select public.service_list_unpaid_checkout_orders('d2000000-0000-4000-8000-000000000002') as confirming_list \gset
select public.release_unpaid_checkout_orders('d2000000-0000-4000-8000-000000000002',array[:'direct_order_5']::uuid[]) as confirming_release \gset
reset role;
select 1/case when jsonb_array_length(:'confirming_list'::jsonb)=1 and not (:'confirming_list'::jsonb->0->>'releasable')::boolean
 and (:'confirming_release'::jsonb->>'released')::integer=0 and (:'confirming_release'::jsonb->>'confirming')::integer=1
 and (select status='pending' from public.orders where id=:'direct_order_5')
 then 1 else 0 end as assert_customer_release_refuses_confirming_payment;
set local role service_role;
select public.finalize_goods_payment_attempt(:'confirming_attempt','d2000000-0000-4000-8000-000000000144','declined');
-- 확인창 뒤에 새로 생긴 주문은 닫지 않는다 — 고객이 본 주문만 닫는다.
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-c',jsonb_build_array(
  jsonb_build_object('good_id','d2-c','variant_id',:'variant_c','qty',1))) as unseen_draft \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'unseen_draft',:'address','d2000000-0000-4000-8000-000000000211','card',0,null) as unseen_order \gset
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'direct_order_5') then 1 else 0 end as assert_new_order_closed_declined_payment;
set local role service_role;
select public.release_unpaid_checkout_orders('d2000000-0000-4000-8000-000000000002',array[:'direct_order_5']::uuid[]) as unseen_release \gset
reset role;
select 1/case when (:'unseen_release'::jsonb->>'released')::integer=0
 and (select status='pending' from public.orders where id=:'unseen_order')
 and (select state='awaiting_payment' from private.cart_order_holds where order_id=:'unseen_order')
 then 1 else 0 end as assert_customer_release_skips_orders_not_confirmed;
set local role service_role;
select public.release_unpaid_checkout_orders('d2000000-0000-4000-8000-000000000002',array[:'unseen_order']::uuid[]) as declined_release \gset
reset role;
select 1/case when (:'declined_release'::jsonb->>'released')::integer=1 and (select status='canceled' from public.orders where id=:'unseen_order')
 then 1 else 0 end as assert_customer_release_closes_confirmed_order;
-- 만료된 바로구매 초안은 주문되지 않는다. 다른 계정은 남의 초안으로 주문할 수 없다.
set local role service_role;
select pg_temp.d2_expect_error(format('select public.place_direct_order(%L,%L,%L,%L,%L,0,null)','d2000000-0000-4000-8000-000000000003',:'direct_draft_4',:'address',
  'd2000000-0000-4000-8000-000000000208','card'),'checkout_draft_expired');
reset role;
select 1/case when has_function_privilege('service_role','public.place_direct_order(uuid,uuid,jsonb,uuid,public.order_payment_method,bigint,uuid)','execute')
 and not has_function_privilege('authenticated','public.place_direct_order(uuid,uuid,jsonb,uuid,public.order_payment_method,bigint,uuid)','execute')
 and has_function_privilege('service_role','public.service_create_checkout_direct_draft(uuid,text,jsonb)','execute')
 and not has_function_privilege('authenticated','public.service_create_checkout_direct_draft(uuid,text,jsonb)','execute')
 and has_function_privilege('authenticated','public.quote_goods_sales_for_address_with_coupon(jsonb,jsonb,uuid)','execute')
 and not has_function_privilege('anon','public.quote_goods_sales_for_address_with_coupon(jsonb,jsonb,uuid)','execute')
 and has_function_privilege('authenticated','public.get_my_store_credit_checkout_for_direct(bigint,jsonb,jsonb,uuid)','execute')
 and not has_function_privilege('anon','public.get_my_store_credit_checkout_for_direct(bigint,jsonb,jsonb,uuid)','execute')
 and has_function_privilege('service_role','public.release_unpaid_checkout_orders(uuid,uuid[])','execute')
 and not has_function_privilege('authenticated','public.release_unpaid_checkout_orders(uuid,uuid[])','execute')
 and has_function_privilege('service_role','public.service_list_unpaid_checkout_orders(uuid)','execute')
 and not has_function_privilege('authenticated','public.service_list_unpaid_checkout_orders(uuid)','execute')
 and has_function_privilege('service_role','public.service_retry_direct_order(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.service_retry_direct_order(uuid,uuid)','execute')
 and has_function_privilege('service_role','public.service_close_direct_order(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.service_close_direct_order(uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.close_direct_order_for_retry(uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.supersede_unpaid_checkout_orders(uuid,boolean,text[],text)','execute')
 and not has_function_privilege('service_role','private.record_direct_order_hold(uuid,uuid,text,jsonb,text)','execute')
 then 1 else 0 end as assert_direct_acl;

-- ── 4. 랜덤 판매 굿즈 바로구매(ADR-0027): 어떤 옵션을 넘겨도 장바구니 키로 모으고, 주문 생성이 배정한다 ────────
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000001',true);
select public.admin_save_good('{"id":"d2-random","ip_id":"d2-ip","name":"TEST D2 랜덤","price":5000,
 "variant_baseline":[],"variants":[
  {"name":"A","code":"D2-RANDOM-A","attributes":{"멤버":"A"},"extraPrice":0,"stockQty":2},
  {"name":"B","code":"D2-RANDOM-B","attributes":{"멤버":"B"},"extraPrice":0,"stockQty":3}],
 "allow_card_payment":true,"allow_bank_transfer":true,"sale_restriction":"none"}');
reset role;
update public.goods set type='문구',origin_id='d2000000-0000-4000-8000-000000000010',shipping_fee_type='policy' where id='d2-random';
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 values(('47c47700'||left(md5('d2-random'),24))::uuid,'authenticated','authenticated','d2-kc-'||md5('d2-random')||'@example.test','{"testFixture":"goods-kc"}',now(),now());
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('d2-random'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('d2-random');
update private.goods_subscription_policies set enabled=false where good_id='d2-random';
select id as random_key from public.goods_variants where code='D2-RANDOM-A' \gset
select id as random_b from public.goods_variants where code='D2-RANDOM-B' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000001',true);
select public.admin_set_goods_option_sale_mode('d2-random','random',(select updated_at from public.goods where id='d2-random'));
reset role;
select pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002') as cart_before_random \gset
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-random',jsonb_build_array(
  jsonb_build_object('good_id','d2-random','variant_id',:'random_b','qty',3))) as random_draft \gset
select public.service_get_checkout_draft('d2000000-0000-4000-8000-000000000002',:'random_draft') as random_view \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'random_draft',:'address','d2000000-0000-4000-8000-000000000301','card',0,null) as random_order \gset
reset role;
select 1/case when (:'random_view'::jsonb->'lines'->0->>'variantId')=:'random_key'
 and (select sum(qty) from public.order_items where order_id=:'random_order' and good_id='d2-random')=3
 and not exists(select 1 from public.order_items where order_id=:'random_order' and good_id='d2-random' and option_sale_mode_snapshot is distinct from 'random')
 and (select sum(stock_qty) from public.goods_variants where good_id='d2-random')=2
 and (select count(*)>=1 and bool_and(cart_item_id is null) and bool_and(cart_variant_id=:'random_key'::uuid)
  from private.order_item_random_allocations where order_id=:'random_order')
 and pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002')=:'cart_before_random'::jsonb
 then 1 else 0 end as assert_random_direct_allocates_from_key_without_cart_row;

-- ── 5. 거래 런타임도 같은 계약이다(운영은 꺼져 있다): 선택 주문 = 고른 줄 ⊆ 장바구니, 바로구매 = 초안 줄만 ──────────
update private.goods_transaction_runtime set enabled=true where singleton;
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.clear_cart_coupon();
select public.set_cart_item_quantity('d2-a',:'variant_a',1);
select public.set_cart_item_quantity('d2-b',:'variant_b',2);
reset role;
select pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002') as tx_cart_before \gset
select pg_temp.d2_lines('d2000000-0000-4000-8000-000000000002',array['d2-a']) as tx_a_only \gset
-- 선택 주문: A만 고르면 견적·주문은 A만, 카드 보류 줄도 A만이다. B는 남는다.
set local role service_role;
select public.quote_cart_goods_transaction('d2000000-0000-4000-8000-000000000002',:'tx_a_only',:'address','{}',null,0) as tx_quote \gset
select public.place_cart_goods_transaction('d2000000-0000-4000-8000-000000000002',:'tx_a_only',:'address',(:'tx_quote'::jsonb->>'quoteId')::uuid,
 'd2000000-0000-4000-8000-000000000401','card') as tx_selection_order \gset
reset role;
select 1/case when (select count(*) from public.order_items where order_id=:'tx_selection_order')=1
 and exists(select 1 from public.order_items where order_id=:'tx_selection_order' and good_id='d2-a')
 and (select calculation_version=2 from public.orders where id=:'tx_selection_order')
 and (select source='cart_transaction' and jsonb_array_length(lines)=1 and lines->0->>'goodId'='d2-a' from private.cart_order_holds where order_id=:'tx_selection_order')
 and pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002')=:'tx_cart_before'::jsonb
 then 1 else 0 end as assert_tx_selection_holds_only_selected_lines;
-- 고른 줄의 수량이 바뀌면(다른 탭) 견적이 PT409로 막힌다.
set local role authenticated;
select public.set_cart_item_quantity('d2-a',:'variant_a',2);
reset role;
set local role service_role;
select pg_temp.d2_expect_error(format('select public.quote_cart_goods_transaction(%L,%L,%L,%L,null,0)','d2000000-0000-4000-8000-000000000002',:'tx_a_only',:'address','{}'),'cart_snapshot_changed');
reset role;
-- 바로구매: 초안 줄만, 장바구니는 그대로. 새 바로구매가 이전 미결제 선택 주문을 닫는다(출처 무관).
set local role authenticated;
select public.set_cart_item_quantity('d2-a',:'variant_a',1);
reset role;
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-b',jsonb_build_array(
  jsonb_build_object('good_id','d2-b','variant_id',:'variant_b','qty',1))) as tx_direct_draft \gset
select public.quote_direct_goods_transaction('d2000000-0000-4000-8000-000000000002',:'tx_direct_draft',:'address','{}',null,0) as tx_direct_quote \gset
select public.place_direct_goods_transaction('d2000000-0000-4000-8000-000000000002',:'tx_direct_draft',:'address',(:'tx_direct_quote'::jsonb->>'quoteId')::uuid,
 'd2000000-0000-4000-8000-000000000402','card') as tx_direct_order \gset
-- 같은 키 재요청은 초안을 다시 보지 않고 원래 주문이다.
select 1/case when public.place_direct_goods_transaction('d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-0000000000ff',:'address',
 (:'tx_direct_quote'::jsonb->>'quoteId')::uuid,'d2000000-0000-4000-8000-000000000402','card')=:'tx_direct_order'::uuid
 and public.resume_direct_goods_transaction('d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-0000000000ff',
 (:'tx_direct_quote'::jsonb->>'quoteId')::uuid,'d2000000-0000-4000-8000-000000000402','card',false)=:'tx_direct_order'::uuid
 then 1 else 0 end as assert_transaction_direct_replay_returns_same_order;
reset role;
select 1/case when (select count(*) from public.order_items where order_id=:'tx_direct_order')=1
 and exists(select 1 from public.order_items where order_id=:'tx_direct_order' and good_id='d2-b' and qty=1)
 and (select source_kind='direct' and source_id='d2000000-0000-4000-8000-000000000002'::uuid from private.order_goods_transactions where order_id=:'tx_direct_order')
 and (select source='direct_transaction' and base_good_id='d2-b' from private.cart_order_holds where order_id=:'tx_direct_order')
 and (select discount_total=0 and status='pending' from public.orders where id=:'tx_direct_order')
 and (select status='canceled' from public.orders where id=:'tx_selection_order')
 and pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002')=:'tx_cart_before'::jsonb
 then 1 else 0 end as assert_tx_direct_orders_draft_only_and_supersedes;
-- 장바구니 선택 초안·다른 계정·만료 초안으로는 바로구매 견적이 되지 않는다.
set local role service_role;
select public.service_create_checkout_selection_draft('d2000000-0000-4000-8000-000000000002',:'tx_a_only') as tx_selection_draft \gset
select pg_temp.d2_expect_error(format('select public.quote_direct_goods_transaction(%L,%L,%L,%L,null,0)','d2000000-0000-4000-8000-000000000002',:'tx_selection_draft',:'address','{}'),'checkout_draft_expired');
select pg_temp.d2_expect_error(format('select public.quote_direct_goods_transaction(%L,%L,%L,%L,null,0)','d2000000-0000-4000-8000-000000000003',:'tx_direct_draft',:'address','{}'),'checkout_draft_expired');
reset role;
select 1/case when has_function_privilege('service_role','public.place_direct_goods_transaction(uuid,uuid,jsonb,uuid,uuid,public.order_payment_method)','execute')
 and not has_function_privilege('authenticated','public.place_direct_goods_transaction(uuid,uuid,jsonb,uuid,uuid,public.order_payment_method)','execute')
 and has_function_privilege('service_role','public.quote_direct_goods_transaction(uuid,uuid,jsonb,jsonb,uuid,bigint)','execute')
 and not has_function_privilege('authenticated','public.quote_direct_goods_transaction(uuid,uuid,jsonb,jsonb,uuid,bigint)','execute')
 and has_function_privilege('service_role','public.quote_direct_goods_transaction_combined(uuid,uuid,jsonb,jsonb,uuid[],bigint)','execute')
 and has_function_privilege('service_role','public.resume_direct_goods_transaction(uuid,uuid,uuid,uuid,public.order_payment_method,boolean)','execute')
 and not has_function_privilege('authenticated','public.resume_direct_goods_transaction(uuid,uuid,uuid,uuid,public.order_payment_method,boolean)','execute')
 and not has_function_privilege('service_role','private.direct_goods_transaction_selection(uuid,uuid,boolean)','execute')
 and not has_function_privilege('service_role','private.checkout_draft_for_order(uuid,uuid,text,boolean)','execute')
 and not has_function_privilege('service_role','private.checkout_draft_order_payment_unresolved(uuid)','execute')
 then 1 else 0 end as assert_transaction_direct_acl;
update private.goods_transaction_runtime set enabled=false where singleton;

-- ── 6. 같은 주문서(초안)의 재제출(완료 기준 5): 무통장 접수·결제 완료 뒤에는 새 키로 다시 내도 PT409 checkout_draft_used ──────
-- 다른 탭·뒤로 가기로 같은 주문서를 새 checkout key로 다시 내면 원 주문으로 안내한다(detail = 원 주문 id). 같은 키는 지금처럼
-- 원래 주문이고, 카드 미결제 주문이면 지금처럼 새 주문이 그 주문을 닫는다(supersede).
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.clear_cart_coupon();
reset role;
-- (가) 바로구매 무통장: 두 번째 제출(새 키)은 결제수단과 무관하게 거절, 주문은 1건이다.
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-a',jsonb_build_array(
  jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',1))) as used_bank_draft \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'used_bank_draft',:'address','d2000000-0000-4000-8000-000000000501','bank_transfer',0,null) as used_bank_order \gset
select pg_temp.d2_error_detail(format('select public.place_direct_order(%L,%L,%L,%L,%L,0,null)','d2000000-0000-4000-8000-000000000002',:'used_bank_draft',:'address',
  'd2000000-0000-4000-8000-000000000502','bank_transfer')) as used_bank_retry \gset
select pg_temp.d2_expect_error(format('select public.place_direct_order(%L,%L,%L,%L,%L,0,null)','d2000000-0000-4000-8000-000000000002',:'used_bank_draft',:'address',
  'd2000000-0000-4000-8000-000000000503','card'),'checkout_draft_used');
select 1/case when public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'used_bank_draft',:'address','d2000000-0000-4000-8000-000000000501','bank_transfer',0,null)=:'used_bank_order'::uuid
 then 1 else 0 end as assert_used_direct_draft_same_key_replays;
select public.service_get_checkout_draft('d2000000-0000-4000-8000-000000000002',:'used_bank_draft') as used_bank_view \gset
reset role;
select 1/case when :'used_bank_retry'='checkout_draft_used|'||:'used_bank_order'
 and (select count(*) from public.orders where user_id='d2000000-0000-4000-8000-000000000002'
  and checkout_key in ('d2000000-0000-4000-8000-000000000501','d2000000-0000-4000-8000-000000000502','d2000000-0000-4000-8000-000000000503'))=1
 and (select status='pending' and payment_method='bank_transfer' from public.orders where id=:'used_bank_order')
 and :'used_bank_view'::jsonb->>'usedOrderId'=:'used_bank_order' and :'used_bank_view'::jsonb->>'closed' is null
 and (select order_id=:'used_bank_order'::uuid from private.checkout_drafts where id=:'used_bank_draft')
 then 1 else 0 end as assert_two_tab_bank_direct_draft_orders_once;
-- (나) 바로구매 카드 결제 완료 뒤(3절 direct_order_3) 같은 주문서 재제출도 거절한다.
set local role service_role;
select pg_temp.d2_expect_error(format('select public.place_direct_order(%L,%L,%L,%L,%L,0,null)','d2000000-0000-4000-8000-000000000002',:'direct_draft_3',:'address',
  'd2000000-0000-4000-8000-000000000504','card'),'checkout_draft_used');
reset role;
select 1/case when (select status='paid' from public.orders where id=:'direct_order_3')
 and not exists(select 1 from public.orders where checkout_key='d2000000-0000-4000-8000-000000000504')
 then 1 else 0 end as assert_paid_direct_draft_resubmit_rejected;
-- (다) 장바구니 선택 초안도 같다: 결제 완료(2절 selection_order)·무통장 접수(2절 bank_selection_order) 뒤 재제출은 거절.
set local role service_role;
select pg_temp.d2_error_detail(format('select public.place_order_with_cart_selection(%L,%L,%L,%L,%L,0,null)','d2000000-0000-4000-8000-000000000002',:'selection_draft',:'address',
  'd2000000-0000-4000-8000-000000000505','card')) as used_selection_retry \gset
select pg_temp.d2_expect_error(format('select public.place_order_with_cart_selection(%L,%L,%L,%L,%L,0,null)','d2000000-0000-4000-8000-000000000002',:'bank_draft',:'address',
  'd2000000-0000-4000-8000-000000000506','bank_transfer'),'checkout_draft_used');
select public.service_get_checkout_draft('d2000000-0000-4000-8000-000000000002',:'bank_draft') as used_selection_view \gset
reset role;
select 1/case when :'used_selection_retry'='checkout_draft_used|'||:'selection_order'
 and :'used_selection_view'::jsonb->>'usedOrderId'=:'bank_selection_order'
 and not exists(select 1 from public.orders where checkout_key in ('d2000000-0000-4000-8000-000000000505','d2000000-0000-4000-8000-000000000506'))
 then 1 else 0 end as assert_used_selection_draft_resubmit_rejected;
-- (라) 카드 미결제 주문은 지금처럼: 같은 주문서를 새 키로 다시 내면 이전 주문을 닫고 새 주문이 그 초안의 주문이 된다.
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-b',jsonb_build_array(
  jsonb_build_object('good_id','d2-b','variant_id',:'variant_b','qty',1))) as unpaid_draft \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'unpaid_draft',:'address','d2000000-0000-4000-8000-000000000507','card',0,null) as unpaid_order_1 \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'unpaid_draft',:'address','d2000000-0000-4000-8000-000000000508','card',0,null) as unpaid_order_2 \gset
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'unpaid_order_1')
 and (select status='pending' from public.orders where id=:'unpaid_order_2')
 and (select order_id=:'unpaid_order_2'::uuid from private.checkout_drafts where id=:'unpaid_draft')
 then 1 else 0 end as assert_unpaid_card_draft_resubmit_supersedes;
-- (마) 거래 런타임 바로구매도 같다: 무통장 접수 뒤 같은 초안은 견적부터 거절, 결제 완료 뒤 재주문도 거절.
update private.goods_transaction_runtime set enabled=true where singleton;
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-a',jsonb_build_array(
  jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',1))) as tx_used_draft \gset
select public.quote_direct_goods_transaction('d2000000-0000-4000-8000-000000000002',:'tx_used_draft',:'address','{}',null,0) as tx_used_quote \gset
select public.place_direct_goods_transaction('d2000000-0000-4000-8000-000000000002',:'tx_used_draft',:'address',(:'tx_used_quote'::jsonb->>'quoteId')::uuid,
 'd2000000-0000-4000-8000-000000000509','bank_transfer') as tx_used_order \gset
select pg_temp.d2_expect_error(format('select public.quote_direct_goods_transaction(%L,%L,%L,%L,null,0)','d2000000-0000-4000-8000-000000000002',:'tx_used_draft',:'address','{}'),'checkout_draft_used');
select pg_temp.d2_error_detail(format('select public.place_direct_goods_transaction(%L,%L,%L,%L,%L,%L)','d2000000-0000-4000-8000-000000000002',:'tx_used_draft',:'address',
  (:'tx_used_quote'::jsonb->>'quoteId'),'d2000000-0000-4000-8000-000000000510','bank_transfer')) as tx_used_retry \gset
select 1/case when public.place_direct_goods_transaction('d2000000-0000-4000-8000-000000000002',:'tx_used_draft',:'address',(:'tx_used_quote'::jsonb->>'quoteId')::uuid,
 'd2000000-0000-4000-8000-000000000509','bank_transfer')=:'tx_used_order'::uuid then 1 else 0 end as assert_tx_used_draft_same_key_replays;
reset role;
select 1/case when :'tx_used_retry'='checkout_draft_used|'||:'tx_used_order'
 and (select status='pending' and payment_method='bank_transfer' from public.orders where id=:'tx_used_order')
 and not exists(select 1 from public.orders where checkout_key='d2000000-0000-4000-8000-000000000510')
 then 1 else 0 end as assert_tx_bank_direct_draft_orders_once;
update private.goods_transaction_runtime set enabled=false where singleton;

-- ── 7. 결제가 아직 확정되지 않은 이전 주문(승인 확인 중·리스가 지난 confirming)의 주문서 재제출(완료 기준 5) ──────────
-- 같은 초안을 새 키로 다시 내면 supersede가 그 주문을 떼어 내고(detach) 하나 더 만들 수 있었다. 이제 초안의 이전 주문 행을
-- 먼저 잠그고 결제 미확정이면 PT409 checkout_payment_in_progress(detail = 그 주문)로 거절한다 — 주문은 하나, 보류는 그대로다.
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-a',jsonb_build_array(
  jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',1))) as confirming_draft \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'confirming_draft',:'address','d2000000-0000-4000-8000-000000000601','card',0,null) as confirming_order \gset
select public.prepare_goods_payment_attempt('d2000000-0000-4000-8000-000000000002',:'confirming_order','toss')->>'id' as confirming_attempt_2 \gset
select public.bind_goods_payment_callback_nonce(:'confirming_attempt_2',repeat('f',64));
reset role;
select provider_order_id as confirming_provider_2 from public.payment_attempts where id=:'confirming_attempt_2' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'confirming_provider_2',repeat('f',64),'d2000000-0000-4000-8000-000000000145');
reset role;
-- 승인 API 호출 중 리스(10분)가 지났다고 흉내 낸다 — 상태는 confirming 그대로다.
update public.payment_attempts set claim_expires_at=clock_timestamp()-interval '1 second' where id=:'confirming_attempt_2';
set local role service_role;
select pg_temp.d2_error_detail(format('select public.place_direct_order(%L,%L,%L,%L,%L,0,null)','d2000000-0000-4000-8000-000000000002',:'confirming_draft',:'address',
  'd2000000-0000-4000-8000-000000000602','bank_transfer')) as confirming_retry \gset
reset role;
select 1/case when :'confirming_retry'='checkout_payment_in_progress|'||:'confirming_order'
 and not exists(select 1 from public.orders where checkout_key='d2000000-0000-4000-8000-000000000602')
 and (select status='pending' from public.orders where id=:'confirming_order')
 and (select state='awaiting_payment' from private.cart_order_holds where order_id=:'confirming_order')
 and (select order_id=:'confirming_order'::uuid from private.checkout_drafts where id=:'confirming_draft')
 then 1 else 0 end as assert_unresolved_payment_draft_resubmit_rejected_without_detach;
-- 결과 불명(unknown)도 같다. 거래 런타임 바로구매는 견적부터(잠그지 않고) 같은 판정으로 막고, 주문도 막는다.
update public.payment_attempts set state='unknown',claim_token=null,claim_expires_at=null where id=:'confirming_attempt_2';
update private.goods_transaction_runtime set enabled=true where singleton;
set local role service_role;
select pg_temp.d2_expect_error(format('select public.place_direct_order(%L,%L,%L,%L,%L,0,null)','d2000000-0000-4000-8000-000000000002',:'confirming_draft',:'address',
  'd2000000-0000-4000-8000-000000000603','card'),'checkout_payment_in_progress');
select pg_temp.d2_expect_error(format('select public.quote_direct_goods_transaction(%L,%L,%L,%L,null,0)','d2000000-0000-4000-8000-000000000002',:'confirming_draft',:'address','{}'),
  'checkout_payment_in_progress');
select pg_temp.d2_expect_error(format('select public.place_direct_goods_transaction(%L,%L,%L,%L,%L,%L)','d2000000-0000-4000-8000-000000000002',:'confirming_draft',:'address',
  'd2000000-0000-4000-8000-0000000000ff','d2000000-0000-4000-8000-000000000604','bank_transfer'),'checkout_payment_in_progress');
reset role;
update private.goods_transaction_runtime set enabled=false where singleton;
-- 장바구니 선택 초안도 같다(승인 확인 중인 선택 주문을 같은 주문서로 다시 내기).
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000002',true);
select public.set_cart_item_quantity('d2-b',:'variant_b',1);
reset role;
select pg_temp.d2_lines('d2000000-0000-4000-8000-000000000002',array['d2-b']) as confirming_lines \gset
set local role service_role;
select public.service_create_checkout_selection_draft('d2000000-0000-4000-8000-000000000002',:'confirming_lines') as confirming_selection_draft \gset
select public.place_order_with_cart_selection('d2000000-0000-4000-8000-000000000002',:'confirming_selection_draft',:'address',
 'd2000000-0000-4000-8000-000000000605','card',0,null) as confirming_selection_order \gset
select public.prepare_goods_payment_attempt('d2000000-0000-4000-8000-000000000002',:'confirming_selection_order','toss')->>'id' as confirming_selection_attempt \gset
reset role;
update public.payment_attempts set state='needs_review' where id=:'confirming_selection_attempt';
set local role service_role;
select pg_temp.d2_error_detail(format('select public.place_order_with_cart_selection(%L,%L,%L,%L,%L,0,null)','d2000000-0000-4000-8000-000000000002',
  :'confirming_selection_draft',:'address','d2000000-0000-4000-8000-000000000606','card')) as confirming_selection_retry \gset
reset role;
select 1/case when :'confirming_selection_retry'='checkout_payment_in_progress|'||:'confirming_selection_order'
 and not exists(select 1 from public.orders where checkout_key='d2000000-0000-4000-8000-000000000606')
 and (select state='awaiting_payment' from private.cart_order_holds where order_id=:'confirming_selection_order')
 then 1 else 0 end as assert_unresolved_selection_draft_resubmit_rejected;
-- 다른 주문의 승인 확인 중(supersede가 거절)도 그 주문을 detail로 알린다 — 주문서가 그 주문으로 안내한다.
update public.payment_attempts set state='confirming',claim_token='d2000000-0000-4000-8000-000000000146',claim_expires_at=clock_timestamp()+interval '5 minutes'
 where id=:'confirming_selection_attempt';
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-c',jsonb_build_array(
  jsonb_build_object('good_id','d2-c','variant_id',:'variant_c','qty',1))) as other_draft \gset
select pg_temp.d2_error_detail(format('select public.place_direct_order(%L,%L,%L,%L,%L,0,null)','d2000000-0000-4000-8000-000000000002',:'other_draft',:'address',
  'd2000000-0000-4000-8000-000000000607','card')) as other_confirming \gset
reset role;
select 1/case when :'other_confirming'='checkout_payment_in_progress|'||:'confirming_selection_order'
 then 1 else 0 end as assert_supersede_names_confirming_order;

-- ── 8. 바로구매 '다시 구매하기'(확정 동작 8): 결제가 승인 전에 끝난 주문을 닫고 같은 줄로 바로구매 초안을 다시 만든다 ─────────
-- 고객이 굿즈 상세에서 다시 고르지 않고 주문서로 간다. 그 주문이 잡던 재고·한도는 닫기로 돌아온다(본인 주문이 재고를 잡아
-- 상세가 품절로 보이던 문제). 승인 확인 중이면 닫지 않고, 결제가 끝난 주문·다른 계정·장바구니 주문은 다시 만들지 않는다.
-- 7절의 승인 확인 중인 선택 주문은 거절로 끝내 둔다(이 절의 새 주문이 그 주문 때문에 막히지 않게).
set local role service_role;
select public.finalize_goods_payment_attempt(:'confirming_selection_attempt','d2000000-0000-4000-8000-000000000146','declined');
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-a',jsonb_build_array(
  jsonb_build_object('good_id','d2-a','variant_id',:'variant_a','qty',2))) as retry_draft \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'retry_draft',:'address','d2000000-0000-4000-8000-000000000701','card',0,null) as retry_order \gset
select public.prepare_goods_payment_attempt('d2000000-0000-4000-8000-000000000002',:'retry_order','toss')->>'id' as retry_attempt \gset
select public.bind_goods_payment_callback_nonce(:'retry_attempt',repeat('9',64));
reset role;
select provider_order_id as retry_provider from public.payment_attempts where id=:'retry_attempt' \gset
select pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002') as retry_cart_before \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'retry_provider',repeat('9',64),'d2000000-0000-4000-8000-000000000147');
select public.service_retry_direct_order('d2000000-0000-4000-8000-000000000002',:'retry_order') as retry_confirming \gset
select public.finalize_goods_payment_attempt(:'retry_attempt','d2000000-0000-4000-8000-000000000147','declined');
select public.service_retry_direct_order('d2000000-0000-4000-8000-000000000003',:'retry_order') is null as retry_other_account \gset
select public.service_retry_direct_order('d2000000-0000-4000-8000-000000000002',:'retry_order') as retry_declined \gset
-- 같은 주문을 다시 누르면(두 탭·뒤로 가기) 살아 있는 그 초안을 돌려준다. 결제가 끝난 바로구매 주문(3절)은 다시 만들지 않는다.
select public.service_retry_direct_order('d2000000-0000-4000-8000-000000000002',:'retry_order') as retry_again \gset
select public.service_retry_direct_order('d2000000-0000-4000-8000-000000000002',:'direct_order_3') as retry_paid \gset
select public.service_retry_direct_order('d2000000-0000-4000-8000-000000000002',:'selection_order') is null as retry_cart_order \gset
reset role;
select 1/case when :'retry_confirming'::jsonb->>'result'='payment_in_progress'
 and :'retry_other_account'::boolean and :'retry_cart_order'::boolean
 and :'retry_declined'::jsonb->>'result'='draft'
 and (select status='canceled' from public.orders where id=:'retry_order')
 and (select state='released' and release_reason='superseded' from private.cart_order_holds where order_id=:'retry_order')
 and exists(select 1 from public.audit_log where action='system.order.unpaid_cart_order_closed' and target='order:'||:'retry_order'
  and diff->>'trigger'='customer_released')
 and (select source='direct' and base_good_id='d2-a' and order_id is null and jsonb_array_length(lines)=1
   and lines->0->>'goodId'='d2-a' and (lines->0->>'variantId')::uuid=:'variant_a'::uuid and (lines->0->>'qty')::integer=2
   from private.checkout_drafts where id=(:'retry_declined'::jsonb->>'draftId')::uuid)
 and :'retry_again'::jsonb->>'result'='draft' and :'retry_again'::jsonb->>'draftId'=:'retry_declined'::jsonb->>'draftId'
 and (select count(*) from private.checkout_drafts where retry_order_id=:'retry_order')=1
 and :'retry_paid'::jsonb->>'result'='not_retryable'
 and pg_temp.d2_cart('d2000000-0000-4000-8000-000000000002')=:'retry_cart_before'::jsonb
 then 1 else 0 end as assert_direct_retry_closes_unpaid_order_and_reopens_same_lines;
-- 다시 만든 초안으로 그대로 주문할 수 있다(재고가 돌아왔다).
set local role service_role;
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',(:'retry_declined'::jsonb->>'draftId')::uuid,:'address',
 'd2000000-0000-4000-8000-000000000702','card',0,null) as retried_order \gset
reset role;
select 1/case when (select status='pending' from public.orders where id=:'retried_order')
 and (select sum(qty)=2 from public.order_items where order_id=:'retried_order' and good_id='d2-a')
 then 1 else 0 end as assert_direct_retry_draft_orders_same_lines;
-- 지금 같은 줄로 초안을 만들 수 없으면(판매 중지) 닫기는 남기고 굿즈 상세로 보낸다.
set local role service_role;
select public.prepare_goods_payment_attempt('d2000000-0000-4000-8000-000000000002',:'retried_order','toss')->>'id' as retried_attempt \gset
reset role;
update public.payment_attempts set state='declined' where id=:'retried_attempt';
update public.goods set published_at=null where id='d2-a';
set local role service_role;
select public.service_retry_direct_order('d2000000-0000-4000-8000-000000000002',:'retried_order') as retry_unavailable \gset
reset role;
update public.goods set published_at=now() where id='d2-a';
select 1/case when :'retry_unavailable'::jsonb->>'result'='unavailable' and :'retry_unavailable'::jsonb->>'baseGoodId'='d2-a'
 and (select status='canceled' from public.orders where id=:'retried_order')
 then 1 else 0 end as assert_direct_retry_unavailable_still_closes_order;

-- ── 9. 결제 대기 주문의 원인 판정 재료(담긴 옵션·쓴 쿠폰)와 '이 주문 닫고 굿즈 상세에서 다시 고르기' ─────────────
-- 화면은 막힘의 원인일 수 있는 주문만 고른다 — 목록이 담긴 옵션과 쓴 보유 쿠폰을 함께 돌려준다. 보조 동작은 같은 닫기만 하고
-- 초안은 만들지 않는다(마지막 재고를 잡은 본인 주문 때문에 굿즈 상세가 품절로 보이지 않게, 상세로 가기 전에 닫는다).
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status) values
 ('D2R3C1K','TEST D2 원인 쿠폰','fixed',1000,0,now()-interval '1 day','active');
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.apply_cart_coupon_code('D2R3C1K') as cause_coupon \gset
select public.clear_cart_coupon();
reset role;
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-b',jsonb_build_array(
  jsonb_build_object('good_id','d2-b','variant_id',:'variant_b','qty',1))) as cause_draft \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'cause_draft',:'address','d2000000-0000-4000-8000-000000000801','card',0,:'cause_coupon') as cause_order \gset
select public.service_list_unpaid_checkout_orders('d2000000-0000-4000-8000-000000000002') as cause_list \gset
reset role;
select count(*) as drafts_before_close from private.checkout_drafts where user_id='d2000000-0000-4000-8000-000000000002' \gset
set local role service_role;
select public.service_close_direct_order('d2000000-0000-4000-8000-000000000003',:'cause_order') is null as close_other_account \gset
select public.service_close_direct_order('d2000000-0000-4000-8000-000000000002',:'direct_order_3') as close_paid \gset
select public.service_close_direct_order('d2000000-0000-4000-8000-000000000002',:'cause_order') as close_reselect \gset
reset role;
select 1/case when (select entry->'variantIds'=jsonb_build_array(:'variant_b') and entry->'userCouponIds'=jsonb_build_array(:'cause_coupon')
   and entry->'goodIds'='["d2-b"]'::jsonb and (entry->>'releasable')::boolean
   from jsonb_array_elements(:'cause_list'::jsonb) as entry where entry->>'id'=:'cause_order')
 and :'close_other_account'::boolean
 and :'close_paid'::jsonb->>'result'='not_retryable'
 and :'close_reselect'::jsonb->>'result'='closed' and :'close_reselect'::jsonb->>'baseGoodId'='d2-b'
 and (select status='canceled' from public.orders where id=:'cause_order')
 and (select state='released' from private.cart_order_holds where order_id=:'cause_order')
 and exists(select 1 from public.audit_log where action='system.order.unpaid_cart_order_closed' and target='order:'||:'cause_order'
  and diff->>'trigger'='customer_released')
 and (select count(*) from private.checkout_drafts where user_id='d2000000-0000-4000-8000-000000000002')=:'drafts_before_close'::bigint
 then 1 else 0 end as assert_unpaid_list_carries_variants_and_coupons_close_for_reselect_only_closes;

-- ── 10. 다시 구매하기는 주문 단위로 한 번(두 탭·뒤로 가기): 두 번 눌러도 초안 하나, 그 초안으로 접수한 뒤에는 다시 주문 불가 ─────
set local role service_role;
select public.service_create_checkout_direct_draft('d2000000-0000-4000-8000-000000000002','d2-c',jsonb_build_array(
  jsonb_build_object('good_id','d2-c','variant_id',:'variant_c','qty',1))) as twice_source_draft \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',:'twice_source_draft',:'address','d2000000-0000-4000-8000-000000000901','card',0,null) as twice_order \gset
select public.prepare_goods_payment_attempt('d2000000-0000-4000-8000-000000000002',:'twice_order','toss')->>'id' as twice_attempt \gset
reset role;
update public.payment_attempts set state='declined' where id=:'twice_attempt';
set local role service_role;
select public.service_retry_direct_order('d2000000-0000-4000-8000-000000000002',:'twice_order') as twice_tab1 \gset
select public.service_retry_direct_order('d2000000-0000-4000-8000-000000000002',:'twice_order') as twice_tab2 \gset
select public.place_direct_order('d2000000-0000-4000-8000-000000000002',(:'twice_tab1'::jsonb->>'draftId')::uuid,:'address',
 'd2000000-0000-4000-8000-000000000902','bank_transfer',0,null) as twice_bank \gset
select public.service_retry_direct_order('d2000000-0000-4000-8000-000000000002',:'twice_order') as twice_tab3 \gset
select pg_temp.d2_expect_error(format('select public.place_direct_order(%L,%L,%L,%L,%L,0,null)','d2000000-0000-4000-8000-000000000002',
  :'twice_tab2'::jsonb->>'draftId',:'address','d2000000-0000-4000-8000-000000000903','bank_transfer'),'checkout_draft_used');
reset role;
select 1/case when :'twice_tab1'::jsonb->>'result'='draft' and :'twice_tab1'::jsonb->>'draftId'=:'twice_tab2'::jsonb->>'draftId'
 and (select count(*) from private.checkout_drafts where retry_order_id=:'twice_order')=1
 and :'twice_tab3'::jsonb->>'result'='not_retryable' and :'twice_tab3'::jsonb->>'orderId'=:'twice_bank'
 and (select count(*) from public.orders where user_id='d2000000-0000-4000-8000-000000000002'
  and checkout_key in ('d2000000-0000-4000-8000-000000000902','d2000000-0000-4000-8000-000000000903'))=1
 then 1 else 0 end as assert_direct_retry_once_per_order;

rollback;
