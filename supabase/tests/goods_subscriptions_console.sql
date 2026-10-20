\set ON_ERROR_STOP on
begin;
create function pg_temp.expect_subscription_transaction_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('b1714000-0000-4000-8000-000000000001','authenticated','authenticated','subscription-tx-admin@example.test',now(),'{}','{}',now(),now()),
 ('b1714000-0000-4000-8000-000000000002','authenticated','authenticated','subscription-tx-buyer@example.test',now(),'{}','{}',now(),now()),
 ('b1714000-0000-4000-8000-000000000003','authenticated','authenticated','subscription-tx-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 정기배송 '||right(id::text,1),birth_date='1995-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='b1714000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('b1714000-0000-4000-8000-000000000001','b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('b1714000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
update private.goods_subscription_runtime set public_enabled=true,charge_enabled=true,worker_enabled=true,fake_local_enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('subscription-tx-ip','TEST 정기배송 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('b1714000-0000-4000-8000-000000000010','subscription-tx-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('subscription-tx-good','subscription-tx-ip','TEST 정기배송 상품','문구',10000,'ok',100,'b1714000-0000-4000-8000-000000000010','policy',0);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','subscription-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='subscription-tx-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='subscription-tx-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='subscription-tx-ip';
select id as variant from public.goods_variants where good_id='subscription-tx-good' and is_default \gset
insert into private.goods_subscription_policies(good_id,enabled,intervals) values('subscription-tx-good',true,'["month_1","week_2"]');
insert into private.billing_profiles(id,merchant_id,environment,adapter,enabled) values('b1714000-0000-4000-8000-000000000020','localbilling','test','fake',true);
insert into private.billing_customers(id,user_id,profile_id,customer_key) values('b1714000-0000-4000-8000-000000000021','b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000020','b1714000-0000-4000-8000-000000000022');
insert into private.billing_credentials(id,owner_id,customer_id,profile_id,envelope,state,issuer_code,masked_number,authenticated_at)
 values('b1714000-0000-4000-8000-000000000023','b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000021','b1714000-0000-4000-8000-000000000020',
 '{"v":1,"keyVersion":"fake-v1","iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA"}','active','61','43301234****123*',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','b1714000-0000-4000-8000-000000000001',true);
select public.admin_save_store_credit_policy('b1714000-0000-4000-8000-000000000024',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":1000,"earnMaxPerOrder":5000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"TEST-ONLY subscription policy"}');
select public.admin_adjust_store_credit('b1714000-0000-4000-8000-000000000025','b1714000-0000-4000-8000-000000000002',10000,now()+interval '1 day','TEST 지급',0);
reset role;
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status,goods_scope,target_good_ids)
 values('SUBSCRIPTION10P','TEST 정기배송10%','percent',10,0,now()-interval '1 day','active','selected_goods',array['subscription-tx-good']);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1714000-0000-4000-8000-000000000002',true);
select public.set_cart_item_quantity('subscription-tx-good',:'variant',5);
select public.apply_cart_coupon_code('SUBSCRIPTION10P') as coupon \gset
select jsonb_build_array(jsonb_build_object('goodId','subscription-tx-good','variantId',:'variant','qty',1,'inputRevision',0,'inputValues','{}'::jsonb)) as selection \gset
select '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}'::jsonb as address \gset
select jsonb_build_object('unit','month','interval',1,'anchorDate',(clock_timestamp() at time zone 'Asia/Seoul')::date,'time','09:00','monthEnd',false) as schedule \gset
select public.prepare_my_goods_subscription('b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000030',:'selection',:'address',:'schedule','{}',:'coupon',1000) as prepared \gset
select 1/case when :'prepared'::jsonb->>'state'='prepared' and :'prepared'::jsonb#>>'{subscription,firstDisplay,totals,onlineTotal}'='11000'
 and :'prepared'::jsonb#>>'{subscription,renewalDisplay,totals,onlineTotal}'='13000'
 and :'prepared'::jsonb#>>'{subscription,renewalDisplay,totals,couponDiscountTotal}'='0' and :'prepared'::jsonb#>>'{subscription,renewalDisplay,totals,storeCreditTotal}'='0'
 and (select qty=5 from public.cart_items where good_id='subscription-tx-good' and user_id=auth.uid()) then 1 else 0 end as assert_first_benefits_separate_cart_untouched;
select :'prepared'::jsonb#>>'{subscription,id}' as plan_id,:'prepared'::jsonb#>>'{subscription,termsId}' as terms_id,
 :'prepared'::jsonb#>>'{subscription,firstQuoteId}' as quote_id \gset

reset role;
update private.goods_subscription_plans set state='canceled',canceled_at=clock_timestamp() where id=:'plan_id';
do $$declare n integer;selection jsonb;address jsonb;schedule jsonb;begin
 select t.selection,t.address,t.schedule into selection,address,schedule from private.goods_subscription_terms t
 join private.goods_subscription_plans p on p.current_terms_id=t.id where p.creation_operation_id='b1714000-0000-4000-8000-000000000030';
 perform set_config('request.jwt.claim.sub','b1714000-0000-4000-8000-000000000002',true);
 for n in 1..104 loop perform public.prepare_my_goods_subscription('b1714000-0000-4000-8000-000000000002',
  ('b1714100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,selection,address,schedule,'{}',null,0);
 update private.goods_subscription_plans set state='canceled',canceled_at=clock_timestamp() where creation_operation_id=('b1714100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;end loop;
end $$;

set local role authenticated;
select public.get_my_goods_subscriptions_page('b1714000-0000-4000-8000-000000000002') as page_one \gset
select public.get_my_goods_subscriptions_page('b1714000-0000-4000-8000-000000000002',(:'page_one'::jsonb#>>'{nextCursor,updatedAt}')::timestamptz,
 (:'page_one'::jsonb#>>'{nextCursor,id}')::uuid) as page_two \gset
select public.get_my_goods_subscriptions_page('b1714000-0000-4000-8000-000000000002',(:'page_two'::jsonb#>>'{nextCursor,updatedAt}')::timestamptz,
 (:'page_two'::jsonb#>>'{nextCursor,id}')::uuid) as page_three \gset
select 1/case when :'page_one'::jsonb->>'total'='105' and jsonb_array_length(:'page_one'::jsonb->'rows')=50
 and jsonb_array_length(:'page_two'::jsonb->'rows')=50 and jsonb_array_length(:'page_three'::jsonb->'rows')=5
 and (select count(distinct x->>'id')=105 from jsonb_array_elements((:'page_one'::jsonb->'rows')||(:'page_two'::jsonb->'rows')||(:'page_three'::jsonb->'rows')) x)
 and :'page_three'::jsonb->>'hasMore'='false' then 1 else 0 end as assert_105_customer_plans_complete_once;
reset role;
insert into private.goods_subscription_cycles(id,plan_id,owner_id,cycle_number,schedule_slot,terms_id,scheduled_at,state)
 select gen_random_uuid(),:'plan_id','b1714000-0000-4000-8000-000000000002',n,n-1,:'terms_id',clock_timestamp()+n*interval '1 month','skipped' from generate_series(2,66) n;
set local role authenticated;
select public.get_my_goods_subscription_cycles('b1714000-0000-4000-8000-000000000002',:'plan_id') as cycles_one \gset
select public.get_my_goods_subscription_cycles('b1714000-0000-4000-8000-000000000002',:'plan_id',(:'cycles_one'::jsonb->>'nextBeforeNumber')::integer) as cycles_two \gset
select 1/case when :'cycles_one'::jsonb->>'total'='66' and jsonb_array_length(:'cycles_one'::jsonb->'rows')=50 and jsonb_array_length(:'cycles_two'::jsonb->'rows')=16
 and (select count(distinct x->>'id')=66 from jsonb_array_elements((:'cycles_one'::jsonb->'rows')||(:'cycles_two'::jsonb->'rows')) x)
 then 1 else 0 end as assert_66_cycles_complete_once;
select pg_temp.expect_subscription_transaction_error($q$select public.admin_list_goods_subscriptions('b1714000-0000-4000-8000-000000000002')$q$,'subscription_operator_required');
select set_config('request.jwt.claim.sub','b1714000-0000-4000-8000-000000000003',true);
select pg_temp.expect_subscription_transaction_error(format('select public.get_my_goods_subscription_cycles(%L,%L)','b1714000-0000-4000-8000-000000000003',:'plan_id'),'subscription_actor_changed');
select set_config('request.jwt.claim.sub','b1714000-0000-4000-8000-000000000001',true);
select public.admin_list_goods_subscriptions('b1714000-0000-4000-8000-000000000001','canceled','TEST 정기배송',3,50) as admin_page \gset
select 1/case when :'admin_page'::jsonb->>'total'='105' and jsonb_array_length(:'admin_page'::jsonb->'rows')=5 then 1 else 0 end as assert_admin_conditions_all_pages;
select public.admin_prepare_goods_subscription_export('b1714000-0000-4000-8000-000000000001','canceled','TEST 정기배송') as exported \gset
select 1/case when :'exported'::jsonb->>'total'='105' and jsonb_array_length(:'exported'::jsonb->'rows')=105
 and :'exported'::jsonb::text!~'(authKey|envelope|customerKey|recipientName|postalCode|phone|masked_number)' then 1 else 0 end as assert_export_full_scope_without_delivery_and_billing_secrets;
reset role;set local role service_role;select set_config('request.jwt.claim.role','service_role',true);
select public.service_record_goods_subscription_export('b1714000-0000-4000-8000-000000000001',(:'exported'::jsonb->>'receiptId')::uuid,:'exported'::jsonb->>'fingerprint',repeat('c',64)) as audit_id \gset
select pg_temp.expect_subscription_transaction_error(format('select public.service_record_goods_subscription_export(%L,%L,%L,%L)',
 'b1714000-0000-4000-8000-000000000001',:'exported'::jsonb->>'receiptId',repeat('d',64),repeat('c',64)),'subscription_export_changed');
reset role;
select 1/case when exists(select 1 from public.audit_log where id=:'audit_id' and diff->>'rowCount'='105' and diff->>'fileSha256'=repeat('c',64)) then 1 else 0 end as assert_export_ciphertext_hash_audit;

insert into private.billing_enrollments(id,owner_id,session_id,profile_id,customer_id,credential_id,nonce_digest,nonce_envelope,auth_envelope,auth_fingerprint,
 write_key_version,idempotency_key,state,first_dispatched_at,recovery_until,expires_at,created_at) values
 ('b1714800-0000-4000-8000-000000000001','b1714000-0000-4000-8000-000000000002','b1714800-0000-4000-8000-000000000002',
 'b1714000-0000-4000-8000-000000000020','b1714000-0000-4000-8000-000000000021','b1714800-0000-4000-8000-000000000003',repeat('a',64),
 '{"v":1,"keyVersion":"fake-v1","iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA"}',
 '{"v":1,"keyVersion":"fake-v1","iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA"}',repeat('b',64),
 'fake-v1','billing-register-ttl-fixture','unknown',clock_timestamp()-interval '25 hours',clock_timestamp()-interval '1 hour',clock_timestamp()-interval '25 hours 50 minutes',clock_timestamp()-interval '26 hours');
update private.subscription_export_receipts set created_at=clock_timestamp()-interval '25 hours',expires_at=clock_timestamp()-interval '24 hours' where id=(:'exported'::jsonb->>'receiptId')::uuid;
set local role service_role;
select 1/case when public.service_purge_billing_registration_secrets(100)=1 and public.service_purge_goods_subscription_exports(100)=1 then 1 else 0 end as assert_expired_sensitive_payloads_purged;
reset role;
select 1/case when exists(select 1 from private.billing_enrollments where id='b1714800-0000-4000-8000-000000000001' and state='needs_review' and auth_envelope is null)
 and not exists(select 1 from private.subscription_export_receipts where id=(:'exported'::jsonb->>'receiptId')::uuid)
 then 1 else 0 end as assert_ttl_keeps_unknown_metadata_without_auth_secret;
rollback;
