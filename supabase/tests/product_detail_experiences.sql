\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql; use supabase_admin for LOAD safeupdate.
begin;
create function pg_temp.expect_experience_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'expected error: %',expected;end $$;
update private.operator_access_state set configured=false where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('92200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','detail-experience-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,21)n;
update public.profiles set role=case when id='92200000-0000-4000-8000-000000000001' then 'admin'::public.user_role when right(id::text,12)::bigint<=6 then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='체험검증'||right(id::text,3),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id::text like '92200000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role)
 select ('92200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,role from unnest(array['owner','primary','deputy','influencer','agency','logistics']) with ordinality r(role,n);
update private.operator_access_state set configured=true where id;
update private.product_detail_experience_settings set revision=0,values=case when section='messages' then '{"buyers":false,"minBuyers":10,"twoYears":true,"repeatBuyers":false,"minRepeatBuyers":10,"bestSeller":false,"newProduct":false}'::jsonb else '{"interests":false,"shippingSavings":false}'::jsonb end where section in('messages','discovery');
insert into public.ips(id,title,vertical_key,published_at,public_slug) select 'experience-test-ip','체험 검증 IP',key,now(),'experience-test-ip' from public.verticals limit 1;
insert into public.fulfillment_origins(id,code,name,base_fee,free_threshold,is_active)
 values('92200000-0000-4000-8000-000000000101','experience-test-origin','체험 검증 출고지',3000,2500,true),
 ('92200000-0000-4000-8000-000000000102','experience-test-origin-other','다른 출고지',3000,null,true);
insert into public.goods(id,ip_id,name,type,price,origin_id,order_quantity_limit_enabled,min_order_qty,max_order_qty)
 select 'experience-test-'||n,'experience-test-ip','체험 검증 굿즈 '||n,'문구',case when n=2 then 1500 else 1000 end,'92200000-0000-4000-8000-000000000101',true,case when n=3 then 2 else 1 end,100 from generate_series(1,6)n;
update public.goods_variants set stock_qty=100 where good_id like 'experience-test-%';
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}',now(),now() from public.goods where id like 'experience-test-%';
update public.profiles set role='staff' where id in(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id like 'experience-test-%');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'experience-test-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'experience-test-%';
update public.goods set shipping_fee_type='individual',individual_fee=500 where id='experience-test-4';
update public.goods set shipping_fee_type='free' where id='experience-test-5';
update public.goods set origin_id='92200000-0000-4000-8000-000000000102' where id='experience-test-6';
-- Fixture-only history does not alter stock, run checkout, or contact a provider.
create function pg_temp.experience_paid(n integer,customer integer,approved timestamptz,good text default 'experience-test-1',quantity integer default 1,proof boolean default true) returns uuid language plpgsql as $$
declare buyer uuid:=('92200000-0000-4000-8000-'||lpad(customer::text,12,'0'))::uuid;
 purchase uuid:=('92200000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid;
 payment uuid:=('92200000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid;
 attempt uuid:=('92200000-0000-4000-8003-'||lpad(n::text,12,'0'))::uuid;
 amount integer;
begin
 select g.price*quantity into amount from public.goods g where g.id=good;
 insert into public.orders(id,user_id,status,total,address,payment_method) values(purchase,buyer,'paid',amount,'{}','card');
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select purchase,g.id,v.id,quantity,g.price,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id=good;
 insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key) values(payment,buyer,'order',purchase,'korpay',amount,'paid','experience-payment-'||n);
 insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(attempt,'korpay',buyer,'order',purchase,amount,'approved','experience-attempt-'||n,'experience-order-'||n,'experience-product-'||n,payment,now()+interval '10 minutes');
 if proof then insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(attempt,'confirm',approved);end if;
 return purchase;
end $$;
select pg_temp.experience_paid(n,n+6,now()) from generate_series(1,10)n;
select pg_temp.experience_paid(n+10,n+6,now()-interval '1 hour') from generate_series(1,10)n;
select pg_temp.experience_paid(21,17,now()-interval '200 days');
select pg_temp.experience_paid(22,18,now()-interval '500 days');
select pg_temp.experience_paid(23,19,now(),proof=>false);
select pg_temp.experience_paid(27,17,now()-interval '500 days',good=>'experience-test-2');
select pg_temp.experience_paid(24,20,now());
update public.payments set amount=amount+1 where id='92200000-0000-4000-8002-000000000024';
select pg_temp.experience_paid(25,21,now());
insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type,stage,status,completed_at)
 values('92200000-0000-4000-8001-000000000025','92200000-0000-4000-8000-000000000021','합성 반품','return','completed','completed',now());
select pg_temp.experience_paid(26,7,(date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')-interval '12 hours',quantity=>1000000);
insert into public.wishlists(user_id,good_id) values('92200000-0000-4000-8000-000000000007','experience-test-2'),('92200000-0000-4000-8000-000000000008','experience-test-3');
insert into public.cart_items(user_id,good_id,variant_id,qty) select '92200000-0000-4000-8000-000000000007',g.id,v.id,1 from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='experience-test-4';
load 'safeupdate';
set local role authenticated;
select set_config('request.jwt.claim.sub','92200000-0000-4000-8000-000000000001',true);
select 1/case when public.admin_get_product_detail_experiences()#>>'{revisions,messages}'='0' then 1 else 0 end as initial_revision;
select public.admin_save_product_detail_experiences('messages','{"buyers":true,"minBuyers":10,"twoYears":true,"repeatBuyers":true,"minRepeatBuyers":10,"bestSeller":true,"newProduct":true}',0,'92200000-0000-4000-8004-000000000001');
select public.admin_save_product_detail_experiences('messages','{"buyers":true,"minBuyers":10,"twoYears":true,"repeatBuyers":true,"minRepeatBuyers":10,"bestSeller":true,"newProduct":true}',0,'92200000-0000-4000-8004-000000000001');
select pg_temp.expect_experience_error($q$select public.admin_save_product_detail_experiences('discovery','{"interests":true,"shippingSavings":true}',0,'92200000-0000-4000-8004-000000000001')$q$,'operation_conflict');
select pg_temp.expect_experience_error($q$select public.admin_save_product_detail_experiences('messages','{"buyers":false,"minBuyers":10,"twoYears":true,"repeatBuyers":false,"minRepeatBuyers":10,"bestSeller":false,"newProduct":false}',0,'92200000-0000-4000-8004-000000000002')$q$,'PT409');
select pg_temp.expect_experience_error($q$select public.admin_save_product_detail_experiences('messages','{"buyers":true,"minBuyers":9,"twoYears":true,"repeatBuyers":true,"minRepeatBuyers":10,"bestSeller":true,"newProduct":true}',1,gen_random_uuid())$q$,'invalid_product_detail_experience');
select pg_temp.expect_experience_error($q$select public.admin_save_product_detail_experiences('messages','{"buyers":true,"minBuyers":1001,"twoYears":true,"repeatBuyers":true,"minRepeatBuyers":10,"bestSeller":true,"newProduct":true}',1,gen_random_uuid())$q$,'invalid_product_detail_experience');
select pg_temp.expect_experience_error($q$select public.admin_save_product_detail_experiences('discovery','{"interests":true,"shippingSavings":true,"extra":true}',0,gen_random_uuid())$q$,'invalid_product_detail_experience');
select public.admin_save_product_detail_experiences('discovery','{"interests":true,"shippingSavings":true}',0,'92200000-0000-4000-8004-000000000003');
reset role;
select 1/case when (select count(*) from public.audit_log where id='92200000-0000-4000-8004-000000000001')=1 then 1 else 0 end as exact_request_once;
select 1/case when not has_table_privilege('authenticated','private.product_detail_experience_settings','SELECT')
 and not has_function_privilege('anon','public.admin_save_product_detail_experiences(text,jsonb,bigint,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','private.product_detail_experience_values_valid(text,jsonb)','EXECUTE') then 1 else 0 end as sealed_acl;
-- Every operator role is checked against the real capability matrix.
do $$declare role_number integer;can_manage boolean;begin
 for role_number in 1..6 loop
  perform set_config('request.jwt.claim.sub',('92200000-0000-4000-8000-'||lpad(role_number::text,12,'0')),true);
  can_manage:=public.has_operator_capability('store.manage');
  if can_manage then perform public.admin_get_product_detail_experiences();
  else perform pg_temp.expect_experience_error('select public.admin_get_product_detail_experiences()','42501');end if;
 end loop;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1/case when (select count(*) from jsonb_array_elements(public.get_product_detail_experience('experience-test-1')->'messages'))=4 then 1 else 0 end as all_real_messages;
select 1/case when exists(select 1 from jsonb_array_elements(public.get_product_detail_experience('experience-test-1')->'messages') m where m->>'kind'='buyers' and m->>'count'='10' and m->>'window'='today')
 and exists(select 1 from jsonb_array_elements(public.get_product_detail_experience('experience-test-1')->'messages') m where m->>'kind'='repeatBuyers' and m->>'count'='10') then 1 else 0 end as distinct_customers_not_orders;
select 1/case when public.get_product_detail_experience('missing') is null and public.get_my_product_detail_interests()->>'ownerId' is null
 and public.get_my_product_detail_interests()->'wishlist'='[]'::jsonb then 1 else 0 end as guest_private_empty;
reset role;
update private.product_detail_experience_settings set values=jsonb_set(values,'{minBuyers}','11') where section='messages';
select 1/case when exists(select 1 from jsonb_array_elements(public.get_product_detail_experience('experience-test-1')->'messages') m where m->>'kind'='buyers' and m->>'count'='11' and m->>'window'='year') then 1 else 0 end as adaptive_year;
update private.product_detail_experience_settings set values=jsonb_set(values,'{minBuyers}','12') where section='messages';
select 1/case when exists(select 1 from jsonb_array_elements(public.get_product_detail_experience('experience-test-1')->'messages') m where m->>'kind'='buyers' and m->>'count'='12' and m->>'window'='twoYears') then 1 else 0 end as two_years;
select 1/case when exists(select 1 from jsonb_array_elements(public.get_product_detail_experience('experience-test-2')->'messages') m where m->>'kind'='buyers' and m->>'count'='1' and m->>'window'='twoYears') then 1 else 0 end as two_years_single_buyer_fallback;
update private.product_detail_experience_settings set values=jsonb_set(values,'{twoYears}','false') where section='messages';
select 1/case when not exists(select 1 from jsonb_array_elements(public.get_product_detail_experience('experience-test-1')->'messages') m where m->>'kind'='buyers') then 1 else 0 end as two_years_disabled;
update public.goods set created_at=now()-interval '8 days' where id='experience-test-1';
select 1/case when not exists(select 1 from jsonb_array_elements(public.get_product_detail_experience('experience-test-1')->'messages') m where m->>'kind'='newProduct') then 1 else 0 end as new_expires;
set local role authenticated;
select set_config('request.jwt.claim.sub','92200000-0000-4000-8000-000000000007',true);
select 1/case when public.get_my_product_detail_interests()->'wishlist'='["experience-test-2"]'::jsonb
 and public.get_my_product_detail_interests()->'cart'='["experience-test-4"]'::jsonb
 and public.get_my_product_detail_interests()->'repurchase'='["experience-test-1"]'::jsonb then 1 else 0 end as owner_only_interests;
select pg_temp.expect_experience_error('select public.admin_get_product_detail_experiences()','42501');
select set_config('request.jwt.claim.sub','92200000-0000-4000-8000-000000000008',true);
select 1/case when public.get_my_product_detail_interests()->'wishlist'='["experience-test-3"]'::jsonb and public.get_my_product_detail_interests()->'cart'='[]'::jsonb then 1 else 0 end as second_owner_isolated;
reset role;
-- Shipping uses the exact option and quantity, and checkout's current quote.
select set_config('request.jwt.claim.sub','',true);
select 1/case when exists(select 1 from jsonb_array_elements(public.get_product_shipping_savings('experience-test-1',(select id from public.goods_variants where good_id='experience-test-1' and is_default),1)->'items') item
 where item->>'goodId'='experience-test-2' and item->>'separateFee'='6000' and item->>'combinedFee'='0' and item->>'savings'='6000') then 1 else 0 end as actual_shipping_savings;
select 1/case when exists(select 1 from jsonb_array_elements(public.get_product_shipping_savings('experience-test-1',(select id from public.goods_variants where good_id='experience-test-1' and is_default),1)->'items') item
 where item->>'goodId'='experience-test-3' and item->>'qty'='2')
 and not exists(select 1 from jsonb_array_elements(public.get_product_shipping_savings('experience-test-1',(select id from public.goods_variants where good_id='experience-test-1' and is_default),1)->'items') item
 where item->>'goodId' in('experience-test-4','experience-test-5','experience-test-6')) then 1 else 0 end as candidate_minimum_individual_free_other_origin;
select 1/case when public.get_product_shipping_savings('experience-test-1',(select id from public.goods_variants where good_id='experience-test-1' and is_default),101)->>'selectionUnavailable'='true' then 1 else 0 end as unavailable_quantity;
update public.goods set published_at=null where id='experience-test-2';
select 1/case when not exists(select 1 from jsonb_array_elements(public.get_product_shipping_savings('experience-test-1',(select id from public.goods_variants where good_id='experience-test-1' and is_default),1)->'items') item where item->>'goodId'='experience-test-2') then 1 else 0 end as candidate_unpublished;
update public.ips set published_at=null where id='experience-test-ip';
select 1/case when public.get_product_detail_experience('experience-test-1') is null and public.get_product_shipping_savings('experience-test-1',(select id from public.goods_variants where good_id='experience-test-1' and is_default),1) is null then 1 else 0 end as public_ip_gate;
update private.product_detail_experience_settings set values='{"interests":false,"shippingSavings":false}' where section='discovery';
select set_config('request.jwt.claim.sub','92200000-0000-4000-8000-000000000007',true);
select 1/case when public.get_my_product_detail_interests()->'wishlist'='[]'::jsonb
 and public.get_product_shipping_savings('experience-test-1',(select id from public.goods_variants where good_id='experience-test-1' and is_default),1)->'items'='[]'::jsonb then 1 else 0 end as disabled_no_private_items;
rollback;
