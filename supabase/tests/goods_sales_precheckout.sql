\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql, the frozen shipping-charge fixture prefix, and
-- pg_temp.precheckout_old_savings_{core,quote} copied before this migration.
-- The prefix starts this transaction; every synthetic row is rolled back.
create function pg_temp.pc_items(ids text[],quantities integer[] default null) returns jsonb language sql stable as $$
 select jsonb_agg(jsonb_build_object('goodId',g.id,'variantId',v.id,'qty',coalesce(quantities[n],1)) order by n)
 from unnest(ids) with ordinality selected(id,n) join public.goods g on g.id=selected.id
 join public.goods_variants v on v.good_id=g.id and v.is_default;
$$;
create function pg_temp.pc_parity(items jsonb) returns boolean language sql stable as $$
 select private.shipping_savings_sales_core(items)=pg_temp.precheckout_old_savings_core(items)
 and private.shipping_savings_sales_quote(items)=pg_temp.precheckout_old_savings_quote(items);
$$;
select pg_temp.sc_error($q$select public.quote_goods_sales_precheckout('[]')$q$,'checkout_contract_upgrade_required');
update private.goods_transaction_runtime set enabled=true where singleton;
set local role authenticated;
select public.admin_save_shipping_charge_group(pg_temp.sc_save(701,201,0,pg_temp.sc_values('min')));
select public.admin_preview_shipping_charge_group_assignment(pg_temp.sc_id(201),array['sc-good-001','sc-good-002','sc-family-owner'],pg_temp.sc_id(1),pg_temp.sc_id(11)) as pc_preview \gset
select public.admin_assign_shipping_charge_group(pg_temp.sc_apply(702,:'pc_preview'));
reset role;
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','pc-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where id in('sc-good-001','sc-good-002','sc-good-003','sc-good-005','sc-family-owner','sc-family-child');
insert into private.operator_memberships(profile_id,manager_role)
 select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods
 where id in('sc-good-001','sc-good-002','sc-good-003','sc-good-005','sc-family-owner','sc-family-child');
select pg_temp.publish_goods_kc_fixture(id) from public.goods
 where id in('sc-good-001','sc-good-002','sc-good-003','sc-good-005','sc-family-owner','sc-family-child') order by id;
select pg_temp.sc_auth(3,15);
select pg_temp.pc_items(array['sc-good-001','sc-good-002'],array[1,2]) as pc_grouped \gset
select pg_temp.pc_items(array['sc-good-003','sc-good-005']) as pc_ungrouped \gset
set local role authenticated;
select public.quote_goods_sales_precheckout(:'pc_grouped') as pc_quote \gset
select pg_temp.sc_assert(:'pc_quote'::jsonb->>'subtotal'='30000' and :'pc_quote'::jsonb->'shipping'='{"status":"checkout_required"}'::jsonb
 and not (:'pc_quote'::jsonb ? 'coupon') and jsonb_array_length(:'pc_quote'::jsonb->'lines')=2
 and (select bool_and((value->>'available')::boolean) from jsonb_array_elements(:'pc_quote'::jsonb->'lines'))
 and (select bool_and(value->>'reason' is null) from jsonb_array_elements(:'pc_quote'::jsonb->'goods')),
 'grouped fixed plus repeated quantity price conditions succeed without shipping or coupon amounts');
select 'GOODS_SALES_PRECHECKOUT_DTO:'||jsonb_build_object('kind','grouped_fixed_repeat','items',:'pc_grouped'::jsonb,'value',:'pc_quote'::jsonb)::text;
select pg_temp.sc_error(format('select public.quote_goods_sales_for_address(%L,null)',:'pc_grouped'),'checkout_contract_upgrade_required');
reset role;
select pg_temp.sc_assert(pg_temp.pc_parity(:'pc_grouped') and pg_temp.pc_parity(:'pc_ungrouped'),
 'grouped and ungrouped savings core and enriched quote retain entire JSON including timestamps');

-- The existing selected coupon stays in savings, while precheckout never asks
-- for coupon state and never promises a discount amount before the order sheet.
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status,goods_scope,target_good_ids)
 values('TEST-PRECHECKOUT','TEST 가격조건 쿠폰','percent',10,0,now()-interval '1 day','active','selected_goods',array['sc-good-001']);
set local role authenticated;
select public.set_cart_item_quantity('sc-good-001',(select id from public.goods_variants where good_id='sc-good-001' and is_default),1);
select public.set_cart_item_quantity('sc-good-002',(select id from public.goods_variants where good_id='sc-good-002' and is_default),2);
select public.apply_cart_coupon_code('TEST-PRECHECKOUT');
reset role;
select pg_temp.sc_assert(pg_temp.pc_parity(:'pc_grouped') and private.shipping_savings_sales_quote(:'pc_grouped')->'coupon'<>'null'::jsonb,
 'existing selected-coupon savings payload remains exactly identical');

-- Family quantities share limits while selected owner/child line identities stay
-- intact. Existing pending order 501 reserves one unit for good 001.
update public.goods set order_quantity_limit_enabled=true,min_order_qty=3,max_order_qty=4 where id='sc-family-owner';
select pg_temp.pc_items(array['sc-family-owner','sc-family-child'],array[1,2]) as pc_family \gset
set local role authenticated;
select public.quote_goods_sales_precheckout(:'pc_family') as pc_family_quote \gset
select pg_temp.sc_assert(jsonb_array_length(:'pc_family_quote'::jsonb->'lines')=2
 and (select bool_and(value->>'reason' is null) from jsonb_array_elements(:'pc_family_quote'::jsonb->'goods')),
 'owner and child combine three units for family minimum while preserving selected identities');
select 'GOODS_SALES_PRECHECKOUT_DTO:'||jsonb_build_object('kind','family_owner_child','items',:'pc_family'::jsonb,'value',:'pc_family_quote'::jsonb)::text;
select pg_temp.sc_assert((select bool_and(value->>'reason'='order_quantity_above_maximum') from jsonb_array_elements(
 public.quote_goods_sales_precheckout(pg_temp.pc_items(array['sc-family-owner','sc-family-child'],array[2,3]))->'goods')),
 'split owner and child cannot bypass combined family maximum');
reset role;
update public.goods set member_purchase_limit_enabled=true,member_lifetime_qty_limit=2 where id='sc-good-001';
set local role authenticated;
select public.quote_goods_sales_precheckout(pg_temp.pc_items(array['sc-good-001'],array[2])) as pc_member \gset
select pg_temp.sc_assert(:'pc_member'::jsonb#>>'{goods,0,memberReservedQty}'='1'
 and :'pc_member'::jsonb#>>'{goods,0,memberRemainingQty}'='1' and :'pc_member'::jsonb#>>'{goods,0,reason}'='member_purchase_limit_exceeded',
 'existing member reservation remains part of lifetime limit');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role anon;
select pg_temp.sc_assert(public.quote_goods_sales_precheckout(:'pc_grouped')#>'{goods,0,memberReservedQty}'='null'::jsonb,
 'anonymous conditions reveal no member order quantity');
reset role;
select pg_temp.sc_assert(pg_temp.pc_parity(:'pc_grouped'),'anonymous complete savings parity');

-- Real period and preorder admin RPCs feed the same product-condition readers.
select pg_temp.sc_auth();
set local role authenticated;
select public.admin_save_goods_price_period('sc-good-005',(select id from public.goods_variants where good_id='sc-good-005' and is_default),null,
 jsonb_build_object('state','active','discountPrice',8000,'startsAt',now()-interval '1 hour','endsAt',now()+interval '30 minutes'));
select public.admin_save_goods_preorder('sc-good-005',(select id from public.goods_variants where good_id='sc-good-005' and is_default),null,
 jsonb_build_object('state','active','capacityQty',5,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour',
 'expectedShipDate',(now() at time zone 'Asia/Seoul')::date+7,'approvalReference','TEST-ONLY precheckout supply'));
reset role;
update public.goods set allow_bank_transfer=false where id='sc-good-005';
update public.goods_variants set stock_qty=0 where good_id='sc-good-005';
select pg_temp.sc_auth(3,15);
select pg_temp.pc_items(array['sc-good-005'],array[2]) as pc_preorder \gset
set local role authenticated;
select public.quote_goods_sales_precheckout(:'pc_preorder') as pc_preorder_quote \gset
select pg_temp.sc_assert(:'pc_preorder_quote'::jsonb->>'subtotal'='16000'
 and :'pc_preorder_quote'::jsonb#>>'{lines,0,effectivePrice}'='8000'
 and :'pc_preorder_quote'::jsonb#>>'{lines,0,available}'='true'
 and :'pc_preorder_quote'::jsonb#>>'{paymentMethods,card}'='true' and :'pc_preorder_quote'::jsonb#>>'{paymentMethods,bankTransfer}'='false'
 and (:'pc_preorder_quote'::jsonb->>'nextChangeAt')::timestamptz=now()+interval '30 minutes',
 'period price preorder capacity payment intersection and nearest change boundary remain authoritative');
select 'GOODS_SALES_PRECHECKOUT_DTO:'||jsonb_build_object('kind','preorder_period','items',:'pc_preorder'::jsonb,'value',:'pc_preorder_quote'::jsonb)::text;
select pg_temp.sc_assert(public.quote_goods_sales_precheckout(pg_temp.pc_items(array['sc-good-005'],array[6]))#>>'{lines,0,available}'='false',
 'preorder capacity exhaustion blocks availability');
reset role;
select pg_temp.sc_assert(pg_temp.pc_parity(:'pc_preorder'),'preorder and active price complete savings parity');
update public.goods set stock='soldout' where id='sc-good-003';
select pg_temp.sc_assert(public.quote_goods_sales_precheckout(pg_temp.pc_items(array['sc-good-003']))#>>'{lines,0,available}'='false','soldout product remains unavailable');
select pg_temp.sc_error($q$select public.quote_goods_sales_precheckout('[{"goodId":"sc-good-001","variantId":"00000000-0000-4000-8000-000000000001","qty":0}]')$q$,'invalid_sales_quote_items');
select pg_temp.sc_error($q$select public.quote_goods_sales_precheckout(pg_temp.pc_items(array['sc-good-006']))$q$,'sales_quote_good_unavailable');
select pg_temp.sc_assert(not has_function_privilege('service_role','public.quote_goods_sales_precheckout(jsonb)','execute')
 and has_function_privilege('anon','public.quote_goods_sales_precheckout(jsonb)','execute')
 and has_function_privilege('authenticated','public.quote_goods_sales_precheckout(jsonb)','execute')
 and not has_function_privilege('authenticated','private.goods_sales_conditions_quote(jsonb)','execute')
 and not has_function_privilege('anon','private.goods_sales_conditions_core(jsonb)','execute'),'public conditions and private helpers have explicit role boundaries');
select pg_temp.sc_assert(not exists(select 1 from sc_old_order old where not exists(select 1 from public.order_items i where to_jsonb(i)=old.value)),
 'existing order snapshot remains identical');
set constraints all immediate;
rollback;
