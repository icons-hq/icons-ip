\set ON_ERROR_STOP on
begin;
create function pg_temp.segment_expect_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'expected %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('bfc01600-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','segment-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,14)n;
update public.profiles set role=case when right(id::text,2) in ('01','02') then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='segment_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true,"marketing":true}' where id::text like 'bfc01600-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values('bfc01600-0000-4000-8000-000000000001','primary'),('bfc01600-0000-4000-8000-000000000002','deputy');
update public.profiles set consents='{"terms":true,"privacy":true,"marketing":false}' where id='bfc01600-0000-4000-8000-000000000007';
update public.profiles set suspended_at=now(),suspension_reason='합성 검사' where id='bfc01600-0000-4000-8000-000000000008';
update public.profiles set onboarded_at=null where id='bfc01600-0000-4000-8000-000000000014';
insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status) values('bfc01600-0000-4000-8000-000000000601','bfc01600-0000-4000-8000-000000000009',gen_random_uuid(),'awaiting_email_intent');
insert into private.account_action_fences(subject_user_id,deletion_event_id) values('bfc01600-0000-4000-8000-000000000009','bfc01600-0000-4000-8000-000000000601');
insert into public.ips(id,title,vertical_key) select 'segment-test-ip','세그먼트 합성 IP',key from public.verticals limit 1;
insert into public.catalog_categories(id,code,name) values('bfc01600-0000-4000-8000-000000000101','segment-root','세그먼트 분류');
insert into public.catalog_categories(id,code,name,parent_id,depth) values('bfc01600-0000-4000-8000-000000000102','segment-child','세그먼트 하위','bfc01600-0000-4000-8000-000000000101',2);
insert into public.goods(id,ip_id,name,type,price,category_id) values('segment-test-good','segment-test-ip','세그먼트 합성 상품','문구',1000,'bfc01600-0000-4000-8000-000000000102');
insert into public.goods(id,ip_id,name,type,price) values('segment-test-cart','segment-test-ip','세그먼트 장바구니 상품','문구',1000);
insert into public.orders(id,user_id,status,total,address,created_at)
 select ('bfc01600-0000-4000-8000-'||lpad((200+n)::text,12,'0'))::uuid,('bfc01600-0000-4000-8000-'||lpad(customer::text,12,'0'))::uuid,
  case when customer=6 then 'canceled'::public.order_status else 'paid'::public.order_status end,1000,'{}',now()-make_interval(days=>days)
 from(values(1,4,20),(2,5,100),(3,5,10),(4,6,5),(5,10,20),(6,10,5),(7,11,190),(8,13,3)) facts(n,customer,days);
insert into public.payments(user_id,purpose,ref_id,amount,status,payment_key,idempotency_key)
 select user_id,'order',id,1000,'paid','segment-'||id::text,'segment-'||id::text from public.orders where id::text like 'bfc01600-0000-4000-8000-0000000002%';
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot) select id,'segment-test-good',(select id from public.goods_variants where good_id='segment-test-good' and is_default),1,1000,'세그먼트 상품','문구','segment-test-ip' from public.orders where id::text like 'bfc01600-0000-4000-8000-0000000002%';
insert into public.cart_items(user_id,good_id,variant_id,qty) select ('bfc01600-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'segment-test-cart',(select id from public.goods_variants where good_id='segment-test-cart' and is_default),1 from unnest(array[3,7])n;
insert into public.wishlists(user_id,good_id,created_at) values('bfc01600-0000-4000-8000-000000000003','segment-test-good',now()-interval '6 days'),('bfc01600-0000-4000-8000-000000000013','segment-test-good',now()-interval '6 days');
insert into public.coupons(code,name,discount_type,discount_value,ends_at) values('SEGMENT-TEST','세그먼트 쿠폰','fixed',100,now()+interval '10 days');
insert into public.user_coupons(coupon_code,user_id,issued_source,usable_from,expires_at) values('SEGMENT-TEST','bfc01600-0000-4000-8000-000000000012','admin_grant',now()-interval '1 day',now()+interval '10 days');
insert into public.ip_follows(user_id,ip_id) values('bfc01600-0000-4000-8000-000000000012','segment-test-ip');
-- Targets use actual paid, noncancelled orders and the current remaining interest rows.
do $$ declare target text; actual integer; expected integer; settings jsonb;
begin for target,expected,settings in values
 ('first_purchase',4,'{}'::jsonb),('purchased',5,'{}'::jsonb),('first_purchase_recent',3,'{"months":1}'::jsonb),
 ('lapsed_purchase',1,'{"months":6}'::jsonb),('repeat_purchase',2,'{}'::jsonb),('repeat_purchase',1,'{"months":1}'::jsonb),
 ('cart_unpurchased',2,'{"goodsScope":"goods","goodIds":["segment-test-cart"]}'::jsonb),
 ('wishlist_unpurchased',1,'{}'::jsonb),('unused_coupon',1,'{}'::jsonb),('ip_notifications',1,'{}'::jsonb)
 loop select count(*) into actual from private.customer_segment_members(jsonb_build_object('version',1,'target',target)||settings,statement_timestamp()) where customer_id::text like 'bfc01600-%';
 if actual<>expected then raise exception '% expected % actual %',target,expected,actual;end if;end loop;
 if (select count(*) from private.customer_segment_members('{"version":1,"target":"purchased","goodsScope":"category","categoryId":"bfc01600-0000-4000-8000-000000000101"}',now()))<>5 then raise exception 'nested category';end if;
 perform pg_temp.segment_expect_error($q$select private.normalize_customer_segment_rule('{"version":2,"target":"purchased"}')$q$,'invalid_customer_segment_rule');
 perform pg_temp.segment_expect_error($q$select private.normalize_customer_segment_rule('{"version":1,"target":"purchased","ageBands":[20,20]}')$q$,'invalid_customer_segment_rule');
 perform pg_temp.segment_expect_error($q$select private.normalize_customer_segment_rule('{"version":1,"target":"first_purchase","goodsScope":"goods","goodIds":["segment-test-good"]}')$q$,'invalid_customer_segment_rule');
 perform pg_temp.segment_expect_error($q$select * from private.customer_segment_members('{"version":1,"target":"purchased","goodsScope":"goods","goodIds":["segment-missing"]}',now())$q$,'customer_segment_target_unavailable');
end $$;
select 1/case when not has_table_privilege('authenticated','private.customer_segments','select') and not has_table_privilege('service_role','private.customer_segment_estimates','insert')
 and not has_function_privilege('authenticated','private.customer_segment_execution_members(uuid,integer,text)','execute') then 1 else 0 end as sealed_acl;
select set_config('request.jwt.claim.sub','bfc01600-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_customer_segment_overview() as overview \gset
select 1/case when :'overview'::jsonb#>'{groups,potential}'='null'::jsonb and :'overview'::jsonb#>'{groups,visitor}'='null'::jsonb then 1 else 0 end as no_invented_visitors;
select 1/case when public.admin_customer_segment_options('good','세그먼트')->>'total'='2' and public.admin_customer_segment_options('ip','세그먼트')->>'total'='1'
 and public.admin_customer_segment_options('category','세그먼트')->>'total'='2' and public.admin_customer_segment_options('coupon','세그먼트')->>'total'='1' then 1 else 0 end as options;
select public.admin_estimate_customer_segment('{"version":1,"target":"cart_unpurchased","goodsScope":"goods","goodIds":["segment-test-cart"]}','bfc01600-0000-4000-8000-000000000301') as estimate \gset
select 1/case when :'estimate'::jsonb->>'matchedCount'='2' and :'estimate'::jsonb->>'consentedCount'='1' then 1 else 0 end as exact_counts;
select 1/case when public.admin_estimate_customer_segment('{"version":1,"target":"cart_unpurchased","goodsScope":"goods","goodIds":["segment-test-cart"]}','bfc01600-0000-4000-8000-000000000301')=:'estimate'::jsonb then 1 else 0 end as estimate_retry;
select pg_temp.segment_expect_error($q$select public.admin_estimate_customer_segment('{"version":1,"target":"first_purchase"}','bfc01600-0000-4000-8000-000000000301')$q$,'customer_segment_operation_conflict');
select public.admin_save_customer_segment('bfc01600-0000-4000-8000-000000000401',0,'bfc01600-0000-4000-8000-000000000501','장바구니 대상','{"version":1,"target":"cart_unpurchased","goodsScope":"goods","goodIds":["segment-test-cart"]}','bfc01600-0000-4000-8000-000000000301') as saved \gset
select 1/case when public.admin_save_customer_segment('bfc01600-0000-4000-8000-000000000401',0,'bfc01600-0000-4000-8000-000000000501','장바구니 대상','{"version":1,"target":"cart_unpurchased","goodsScope":"goods","goodIds":["segment-test-cart"]}','bfc01600-0000-4000-8000-000000000301')=:'saved'::jsonb then 1 else 0 end as save_retry;
select public.admin_get_customer_segment('bfc01600-0000-4000-8000-000000000401') as detail \gset
select 1/case when jsonb_array_length(:'detail'::jsonb->'history')=13 and (select count(*) from jsonb_array_elements(:'detail'::jsonb->'history') x where x->'matchedCount'='null')=12
 and :'detail'::jsonb#>>'{selectedOptions,0,id}'='segment-test-cart' and public.admin_list_customer_segments('장바구니 대상')->>'total'='1' then 1 else 0 end as saved_readback_unobserved_months;
select pg_temp.segment_expect_error($q$select public.admin_save_customer_segment('bfc01600-0000-4000-8000-000000000401',0,gen_random_uuid(),'바뀐 이름','{"version":1,"target":"cart_unpurchased","goodsScope":"goods","goodIds":["segment-test-cart"]}','bfc01600-0000-4000-8000-000000000301')$q$,'customer_segment_changed');
select pg_temp.segment_expect_error($q$select public.admin_save_customer_segment('bfc01600-0000-4000-8000-000000000402',0,gen_random_uuid(),'다른 조건','{"version":1,"target":"first_purchase"}','bfc01600-0000-4000-8000-000000000301')$q$,'customer_segment_estimate_required');
reset role;
update private.operator_memberships set manager_role='primary' where profile_id='bfc01600-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','bfc01600-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.segment_expect_error($q$select public.admin_save_customer_segment('bfc01600-0000-4000-8000-000000000402',0,gen_random_uuid(),'다른 운영자 추정','{"version":1,"target":"cart_unpurchased","goodsScope":"goods","goodIds":["segment-test-cart"]}','bfc01600-0000-4000-8000-000000000301')$q$,'customer_segment_estimate_required');
reset role;
update private.operator_memberships set manager_role='deputy' where profile_id='bfc01600-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','bfc01600-0000-4000-8000-000000000001',true);
select 1/case when (select count(*) from private.customer_segment_execution_members('bfc01600-0000-4000-8000-000000000401',1,:'saved'::jsonb->>'ruleHash'))=1 then 1 else 0 end as current_consent_only;
update public.profiles set consents=consents||'{"marketing":false}' where id='bfc01600-0000-4000-8000-000000000003';
select 1/case when not exists(select 1 from private.customer_segment_execution_members('bfc01600-0000-4000-8000-000000000401',1,:'saved'::jsonb->>'ruleHash'))
 and (select consented_count=1 from private.customer_segment_estimates where id='bfc01600-0000-4000-8000-000000000301') then 1 else 0 end as withdrawn_consent_rechecked_snapshot_immutable;
select pg_temp.segment_expect_error($q$select * from private.customer_segment_execution_members('bfc01600-0000-4000-8000-000000000401',2,repeat('0',64))$q$,'customer_segment_changed');
update private.customer_segment_estimates set valid_until=clock_timestamp()-interval '1 second',evaluated_at=clock_timestamp()-interval '16 minutes' where id='bfc01600-0000-4000-8000-000000000301';
set local role authenticated;
select pg_temp.segment_expect_error($q$select public.admin_save_customer_segment('bfc01600-0000-4000-8000-000000000401',1,gen_random_uuid(),'기한 초과','{"version":1,"target":"cart_unpurchased","goodsScope":"goods","goodIds":["segment-test-cart"]}','bfc01600-0000-4000-8000-000000000301')$q$,'customer_segment_estimate_required');
select public.admin_set_customer_segment_favorite('bfc01600-0000-4000-8000-000000000401',true);
select public.admin_set_customer_segment_favorite(md5('icons-customer-segment:first_purchase')::uuid,true);
select public.admin_set_customer_segment_favorite(md5('icons-customer-segment:purchased')::uuid,true);
select public.admin_set_customer_segment_favorite(md5('icons-customer-segment:purchased')::uuid,true);
select pg_temp.segment_expect_error($q$select public.admin_set_customer_segment_favorite(md5('icons-customer-segment:repeat_purchase')::uuid,true)$q$,'customer_segment_favorite_limit');
select 1/case when public.admin_list_customer_segments(p_favorite_only=>true)->>'total'='3' then 1 else 0 end as favorite_max_three;
select pg_temp.segment_expect_error($q$select public.admin_archive_customer_segments(jsonb_build_array(jsonb_build_object('id',md5('icons-customer-segment:purchased')::uuid,'revision',1)),gen_random_uuid())$q$,'customer_segment_preset_readonly');
select public.admin_estimate_customer_segment('{"version":1,"target":"cart_unpurchased","goodsScope":"goods","goodIds":["segment-test-cart"]}','bfc01600-0000-4000-8000-000000000302');
select public.admin_save_customer_segment('bfc01600-0000-4000-8000-000000000401',1,'bfc01600-0000-4000-8000-000000000503','수정된 대상','{"version":1,"target":"cart_unpurchased","goodsScope":"goods","goodIds":["segment-test-cart"]}','bfc01600-0000-4000-8000-000000000302');
select 1/case when public.admin_get_customer_segment('bfc01600-0000-4000-8000-000000000401')#>>'{segment,revision}'='2' and public.admin_get_customer_segment('bfc01600-0000-4000-8000-000000000401')#>>'{segment,name}'='수정된 대상' then 1 else 0 end as update_readback;
select public.admin_archive_customer_segments('[{"id":"bfc01600-0000-4000-8000-000000000401","revision":2}]','bfc01600-0000-4000-8000-000000000502');
select public.admin_archive_customer_segments('[{"id":"bfc01600-0000-4000-8000-000000000401","revision":2}]','bfc01600-0000-4000-8000-000000000502');
select 1/case when public.admin_get_customer_segment('bfc01600-0000-4000-8000-000000000401') is null and public.admin_list_customer_segments(p_favorite_only=>true)->>'total'='2' then 1 else 0 end as archived_and_favorite_removed;
select set_config('request.jwt.claim.sub','bfc01600-0000-4000-8000-000000000002',true);
select pg_temp.segment_expect_error('select public.admin_customer_segment_overview()','operator_capability_required');
select pg_temp.segment_expect_error('select public.admin_list_customer_segments()','operator_capability_required');
select pg_temp.segment_expect_error($q$select public.admin_estimate_customer_segment('{"version":1,"target":"first_purchase"}',gen_random_uuid())$q$,'operator_capability_required');
reset role;
rollback;
