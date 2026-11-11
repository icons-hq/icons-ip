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

rollback;
