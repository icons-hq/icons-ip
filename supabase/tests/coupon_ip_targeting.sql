\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
begin;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c7170930-0000-4000-8000-000000000001','authenticated','authenticated','coupon-ip-check-admin@example.test',now(),'{}','{}',now(),now()),
 ('c7170930-0000-4000-8000-000000000002','authenticated','authenticated','coupon-ip-check-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST IP 쿠폰 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='c7170930-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('c7170930-0000-4000-8000-000000000001','c7170930-0000-4000-8000-000000000002');
insert into private.operator_memberships(profile_id,manager_role) values('c7170930-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values
 ('coupon-ip-check-main','TEST IP 쿠폰 대상','character',now()),
 ('coupon-ip-check-other','TEST IP 쿠폰 다른 IP','character',now()),
 ('coupon-ip-check-archived','TEST IP 쿠폰 보관 IP','character',now());
update public.ips set archived_at=now() where id='coupon-ip-check-archived';
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('c7170930-0000-4000-8000-000000000010','coupon-ip-check-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('coupon-ip-check-a','coupon-ip-check-main','TEST 상품 A','문구',10000,'ok',100,'c7170930-0000-4000-8000-000000000010','policy',0),
 ('coupon-ip-check-b','coupon-ip-check-other','TEST 상품 B','문구',5000,'ok',100,'c7170930-0000-4000-8000-000000000010','policy',0);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','transaction-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where id in('coupon-ip-check-a','coupon-ip-check-b');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id in('coupon-ip-check-a','coupon-ip-check-b');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in('coupon-ip-check-a','coupon-ip-check-b');
select id as variant_a from public.goods_variants where good_id='coupon-ip-check-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='coupon-ip-check-b' and is_default \gset

insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select ('c7170930-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('c7170930-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,2)n;
create function pg_temp.coupon_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','c7170930-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','c7170930-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','c7170930-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
select pg_temp.coupon_actor(1);set local role authenticated;
select public.admin_save_shipping_region_policy(null,jsonb_build_object('originId','c7170930-0000-4000-8000-000000000010','carrierCode','hanjin','name','TEST IP 기본운임',
 'startsAt',now()-interval '1 day','endsAt',null,'openEnded',true,'sourceEvidence','TEST IP coupon regional policy','unlistedDisposition','standard','feeUnit','per_shipment',
 'chargePolicyGoods',true,'waivePolicyThreshold',false,'chargeFreeGoods',false,'chargeIndividualGoods',true,'noRulesConfirmed',true,'rules','[]'::jsonb),null) as region \gset
select public.admin_set_shipping_region_policy_status((:'region'::jsonb->>'id')::uuid,'active',1,true);
reset role;select pg_temp.coupon_actor(2);set local role authenticated;
select public.set_cart_item_quantity('coupon-ip-check-a',:'variant_a',2);
select public.set_cart_item_quantity('coupon-ip-check-b',:'variant_b',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as expected_cart from public.cart_items where user_id='c7170930-0000-4000-8000-000000000002' \gset
select '{"recipientName":"TEST 전달 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset
reset role;

create function pg_temp.ip_coupon(p_code text,p_min integer default 0,p_ips jsonb default '["coupon-ip-check-main"]') returns jsonb language sql as $$select jsonb_build_object(
 'target_code',p_code,'target_name','TEST IP 쿠폰','target_discount_type','percent','target_discount_value',10,
 'target_max_discount_amount',null,'target_min_subtotal',p_min,'target_starts_at',now()-interval '1 day','target_ends_at',now()+interval '7 days',
 'target_issue_starts_at',now()-interval '1 day','target_issue_ends_at',now()+interval '7 days','target_valid_days',null,
 'target_issue_limit',10,'target_status','active','target_grade_benefit',null,'target_previous_code',null,'target_expected_revision',null,
 'target_recipient_segment','all','target_goods_scope','selected_ips','target_good_ids','[]'::jsonb,
 'target_ip_ids',p_ips,'target_issuance_mode','code','target_benefit_kind','goods','target_stackable',false)$$;
select pg_temp.coupon_actor(1);set local role authenticated;
-- "The IP over 15,000 won" passes because only IP lines (20,000) count; 25,000 fails though the cart is 25,000.
select public.admin_upsert_coupon_scheduled(pg_temp.ip_coupon('IP-COUPON',15000));
select public.admin_upsert_coupon_scheduled(pg_temp.ip_coupon('IP-COUPON-MIN',25000));
select pg_temp.transaction_expect_error(format('select public.admin_upsert_coupon_scheduled(%L)',pg_temp.ip_coupon('IP-EMPTY',0,'[]')),'coupon_ip_scope_ready');
select pg_temp.transaction_expect_error(format('select public.admin_upsert_coupon_scheduled(%L)',pg_temp.ip_coupon('IP-MISSING',0,'["coupon-ip-check-none"]')),'coupon_target_ip_unavailable');
select pg_temp.transaction_expect_error(format('select public.admin_upsert_coupon_scheduled(%L)',pg_temp.ip_coupon('IP-ARCHIVED',0,'["coupon-ip-check-archived"]')),'coupon_target_ip_unavailable');
select pg_temp.transaction_expect_error(format('select public.admin_upsert_coupon_scheduled(%L)',pg_temp.ip_coupon('IP-BAD',0,'["Bad IP"]')),'invalid_coupon_ip_targeting');
select pg_temp.transaction_expect_error(format('select public.admin_upsert_coupon_scheduled(%L)',pg_temp.ip_coupon('IP-WRONG-SCOPE')||'{"target_goods_scope":"all"}'),'coupon_ip_scope_ready');
select 1/case when public.admin_search_coupon_ips('TEST IP 쿠폰')->>'total'='2' then 1 else 0 end as search_excludes_archived_ip;
select 1/case when (select target_ip_ids from public.admin_search_coupon_console_v4('IP-COUPON-MIN'))=array['coupon-ip-check-main']
 and (select target_ips#>>'{0,title}' from public.admin_search_coupon_console_v4('IP-COUPON-MIN'))='TEST IP 쿠폰 대상' then 1 else 0 end as selected_ip_readback;
select terms_revision as ip_revision from public.coupons where code='IP-COUPON' \gset
-- Changing the targeted IP set is a terms change and is audited.
select public.admin_upsert_coupon_scheduled(pg_temp.ip_coupon('IP-COUPON',15000,'["coupon-ip-check-main","coupon-ip-check-other"]')||jsonb_build_object('target_previous_code','IP-COUPON','target_expected_revision',:ip_revision));
select 1/case when (select terms_revision>:ip_revision and target_ip_ids=array['coupon-ip-check-main','coupon-ip-check-other'] from public.coupons where code='IP-COUPON')
 and exists(select 1 from public.audit_log where target='coupons:IP-COUPON' and diff#>'{after,targetIpIds}'='["coupon-ip-check-main","coupon-ip-check-other"]') then 1 else 0 end as ip_change_revision_and_audit;
select public.admin_upsert_coupon_scheduled(pg_temp.ip_coupon('IP-COUPON',15000)||jsonb_build_object('target_previous_code','IP-COUPON','target_expected_revision',(select terms_revision from public.coupons where code='IP-COUPON')));
reset role;
select pg_temp.transaction_expect_error('update public.coupons set target_ip_ids=''{}'' where code=''IP-COUPON''','coupon_goods_scope_ready');
select pg_temp.transaction_expect_error('update public.coupons set target_good_ids=''{coupon-ip-check-a}'' where code=''IP-COUPON''','coupon_goods_scope_ready');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('coupon-ip-check-new','coupon-ip-check-main','TEST 나중에 추가한 상품','문구',1000,'ok',10);
select 1/case when private.coupon_good_matches('selected_ips','{}','{}',array['coupon-ip-check-main'],'coupon-ip-check-new')
 and not private.coupon_good_matches('selected_ips','{}','{}',array['coupon-ip-check-main'],'coupon-ip-check-b')
 and not private.coupon_good_matches('selected_ips','{}','{}','coupon-ip-check-new')
 and private.coupon_good_matches('all','{}','{}',array[]::text[],'coupon-ip-check-b') then 1 else 0 end as future_good_automatically_eligible;
select pg_temp.coupon_actor(2);set local role authenticated;
select public.claim_coupon_code('IP-COUPON') as ip_coupon \gset
select public.claim_coupon_code('IP-COUPON-MIN') as ip_coupon_min \gset
reset role;
-- Legacy checkout evaluation (the operating order path).
select coalesce(o_reason,'') as o_reason,o_eligible_subtotal,o_discount,o_terms_snapshot from private.evaluate_coupon_target_lines_at(:'ip_coupon','c7170930-0000-4000-8000-000000000002',
 '[{"good_id":"coupon-ip-check-a","subtotal":20000},{"good_id":"coupon-ip-check-b","subtotal":5000}]',null,now()) \gset legacy_
select 1/case when :'legacy_o_reason'='' and :legacy_o_eligible_subtotal=20000 and :legacy_o_discount=2000
 and :'legacy_o_terms_snapshot'::jsonb->'targetIpIds'='["coupon-ip-check-main"]' and :'legacy_o_terms_snapshot'::jsonb->>'goodsScope'='selected_ips' then 1 else 0 end as legacy_ip_subtotal_only;
select coalesce(o_reason,'') as o_reason,o_eligible_subtotal,o_discount,o_terms_snapshot from private.evaluate_coupon_target_lines_at(:'ip_coupon_min','c7170930-0000-4000-8000-000000000002',
 '[{"good_id":"coupon-ip-check-a","subtotal":20000},{"good_id":"coupon-ip-check-b","subtotal":5000}]',null,now()) \gset min_
select 1/case when :'min_o_reason'='coupon_min_subtotal' and :min_o_eligible_subtotal=20000 then 1 else 0 end as min_subtotal_within_ip;
select coalesce(o_reason,'') as o_reason,o_eligible_subtotal,o_discount,o_terms_snapshot from private.evaluate_coupon_target_lines_at(:'ip_coupon','c7170930-0000-4000-8000-000000000002',
 '[{"good_id":"coupon-ip-check-b","subtotal":5000}]',null,now()) \gset none_
select 1/case when :'none_o_reason'='coupon_no_eligible_goods' then 1 else 0 end as other_ip_not_eligible;
-- Transaction runtime: single-coupon snapshot path and the combined definition path.
insert into public.cart_coupon_selections(user_id,user_coupon_id) values('c7170930-0000-4000-8000-000000000002',:'ip_coupon');
set local role service_role;
select public.quote_cart_goods_transaction('c7170930-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',:'ip_coupon',0) as single_quote \gset
select public.quote_cart_goods_transaction_combined('c7170930-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',array[:'ip_coupon']::uuid[],0) as combined_quote \gset
reset role;
select 1/case when :'single_quote'::jsonb#>>'{display,totals,couponDiscountTotal}'='2000' then 1 else 0 end as runtime_single_ip_discount;
select 1/case when :'combined_quote'::jsonb#>>'{display,totals,couponDiscountTotal}'='2000' then 1 else 0 end as runtime_combined_ip_discount;
select 1/case when (select bool_and(case when line->>'goodId'='coupon-ip-check-a' then (line->>'couponDiscount')::int=2000 else coalesce((line->>'couponDiscount')::int,0)=0 end)
 from jsonb_array_elements(:'single_quote'::jsonb#>'{display,lines}') line) then 1 else 0 end as single_allocation_only_ip_lines;
select 1/case when not has_function_privilege('authenticated','private.coupon_good_matches(text,text[],uuid[],text[],text)','execute')
 and not has_function_privilege('anon','public.admin_search_coupon_ips(text,integer)','execute')
 and not has_function_privilege('service_role','public.admin_search_coupon_console_v4(text,text,integer,integer,jsonb)','execute')
 and not has_function_privilege('anon','public.admin_coupon_target_ips(public.coupons)','execute') then 1 else 0 end as ip_roles_sealed;
select pg_temp.coupon_actor(2);set local role authenticated;
select pg_temp.transaction_expect_error('select public.admin_search_coupon_ips()','operator_capability_required');
reset role;
rollback;
