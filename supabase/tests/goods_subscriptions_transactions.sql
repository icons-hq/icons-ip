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
select public.confirm_my_goods_subscription('b1714000-0000-4000-8000-000000000002',:'plan_id','b1714000-0000-4000-8000-000000000030',1,
 :'quote_id',:'terms_id','b1714000-0000-4000-8000-000000000023','b1714000-0000-4000-8000-000000000031',true) as confirmed \gset
select 1/case when :'confirmed'::jsonb->>'state'='awaiting_first_payment' and
 public.confirm_my_goods_subscription('b1714000-0000-4000-8000-000000000002',:'plan_id','b1714000-0000-4000-8000-000000000030',1,
 :'quote_id',:'terms_id','b1714000-0000-4000-8000-000000000023','b1714000-0000-4000-8000-000000000031',true)=:'confirmed'::jsonb
 then 1 else 0 end as assert_first_receipt_replay;
select pg_temp.expect_subscription_transaction_error($q$select public.request_my_billing_credential_revocation('b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000023',1,'b1714000-0000-4000-8000-000000000032')$q$,'billing_credential_in_use');
reset role;
select 1/case when (select count(*)=1 from public.orders where user_id='b1714000-0000-4000-8000-000000000002')
 and (select stock_qty=99 from public.goods_variants where id=:'variant') then 1 else 0 end as assert_exact_one_order_and_reservation;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.expect_subscription_transaction_error($q$select public.service_prepare_goods_subscription_work('b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000030',null,0,'b1714000-0000-4000-8000-000000000020','fake-v1')$q$,'subscription_claim_stale');
select pg_temp.expect_subscription_transaction_error($q$select public.service_finish_goods_subscription_work('b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000030',null,0,'approved')$q$,'subscription_claim_stale');
select pg_temp.expect_subscription_transaction_error($q$select public.service_finish_billing_credential_revocation('b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000023',null,0,'revoked')$q$,'billing_credential_claim_stale');
select public.service_claim_goods_subscription_work('b1714000-0000-4000-8000-000000000040','b1714000-0000-4000-8000-000000000030') as claimed \gset
select public.service_prepare_goods_subscription_work('b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000030',
 'b1714000-0000-4000-8000-000000000040',(:'claimed'::jsonb->>'fence')::bigint,'b1714000-0000-4000-8000-000000000020','fake-v1') as work \gset
select 1/case when :'work'::jsonb->>'kind'='charge' and :'work'::jsonb#>>'{attempt,amount}'='11000'
 and :'work'::jsonb#>>'{binding,cycleId}'='b1714000-0000-4000-8000-000000000030'
 and public.service_claim_goods_subscription_work('b1714000-0000-4000-8000-000000000041','b1714000-0000-4000-8000-000000000030') is null
 then 1 else 0 end as assert_single_charge_claim_and_binding;
select public.service_finish_goods_subscription_work('b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000030',
 'b1714000-0000-4000-8000-000000000040',(:'claimed'::jsonb->>'fence')::bigint,'approved','fake_payment_subscription_tx','fake_approval_subscription_tx','12345678','DONE','카드','43301234****123*',clock_timestamp());
reset role;
select 1/case when (select state='active' and next_slot=1 and last_cycle_number=2 and next_run_at>clock_timestamp() from private.goods_subscription_plans where id=:'plan_id')
 and (select count(*)=2 from private.goods_subscription_cycles where plan_id=:'plan_id')
 and (select status='paid' and total=11000 from public.orders where id=(:'confirmed'::jsonb->>'orderId')::uuid)
 and (select qty=5 from public.cart_items where good_id='subscription-tx-good' and user_id='b1714000-0000-4000-8000-000000000002') then 1 else 0 end as assert_paid_and_next_slot_atomic;
select pg_temp.expect_subscription_transaction_error(format('update private.goods_subscription_terms set address=%L where id=%L','{}',:'terms_id'),'subscription_evidence_immutable');
select pg_temp.expect_subscription_transaction_error($q$update private.billing_profiles set merchant_id='anothermid' where id='b1714000-0000-4000-8000-000000000020'$q$,'billing_profile_immutable');
select revision as revision from private.goods_subscription_plans where id=:'plan_id' \gset
set local role authenticated;
select public.change_my_goods_subscription_state('b1714000-0000-4000-8000-000000000002',:'plan_id',:revision,'b1714000-0000-4000-8000-000000000050','pause') as paused \gset
select 1/case when public.get_my_goods_subscription('b1714000-0000-4000-8000-000000000002',:'plan_id')->>'state'='paused' then 1 else 0 end as assert_paused;
select jsonb_build_object('schedule',jsonb_build_object('unit','month','interval',1,'anchorDate',((clock_timestamp() at time zone 'Asia/Seoul')::date+1),'time','09:00','monthEnd',false)) as change_payload \gset
select public.prepare_my_goods_subscription_change('b1714000-0000-4000-8000-000000000002',:'plan_id',(:'paused'::jsonb->>'revision')::bigint,
 'b1714000-0000-4000-8000-000000000051','resume',:'change_payload') as proposal \gset
select 1/case when :'proposal'::jsonb#>>'{display,totals,onlineTotal}'='13000' then 1 else 0 end as assert_resume_without_first_coupon_credit;
select public.confirm_my_goods_subscription_change('b1714000-0000-4000-8000-000000000002',:'plan_id',(:'paused'::jsonb->>'revision')::bigint,
 'b1714000-0000-4000-8000-000000000051',(:'proposal'::jsonb->>'termsId')::uuid,(:'proposal'::jsonb->>'quoteId')::uuid,
 'b1714000-0000-4000-8000-000000000023','b1714000-0000-4000-8000-000000000052',true) as resumed \gset
select public.change_my_goods_subscription_state('b1714000-0000-4000-8000-000000000002',:'plan_id',(:'resumed'::jsonb->>'revision')::bigint,
 'b1714000-0000-4000-8000-000000000053','cancel');
select public.request_my_billing_credential_revocation('b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000023',1,'b1714000-0000-4000-8000-000000000054') as revoking \gset
reset role;
select 1/case when private.goods_subscription_account_blockers('b1714000-0000-4000-8000-000000000002')='["billing_card_cleanup"]'::jsonb
 and private.goods_subscription_account_retention('b1714000-0000-4000-8000-000000000002')::text!~'(recipient|phone|address|envelope|customerKey|authKey|issuer|profileId|43301234|TEST 수취인)'
 then 1 else 0 end as assert_retention_no_secrets_and_revoke_blocker;
set local role service_role;
select public.service_claim_billing_credential_revocation('b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000023','b1714000-0000-4000-8000-000000000055') as revoke_claim \gset
select public.service_finish_billing_credential_revocation('b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000023',
 'b1714000-0000-4000-8000-000000000055',(:'revoke_claim'::jsonb->>'claimFence')::bigint,'revoked');
reset role;
select 1/case when private.goods_subscription_account_blockers('b1714000-0000-4000-8000-000000000002')='[]'::jsonb
 and (select envelope is null from private.billing_credentials where id='b1714000-0000-4000-8000-000000000023') then 1 else 0 end as assert_verified_revoke_clears_ciphertext;
select pg_temp.expect_subscription_transaction_error($q$select private.purge_goods_subscription_account_data('b1714000-0000-4000-8000-000000000002')$q$,'subscription_account_cleanup_pending');
select pg_temp.expect_subscription_transaction_error(format('delete from private.payment_provider_bindings where attempt_id=%L',(:'work'::jsonb#>>'{attempt,id}')),'billing_financial_binding_retained');
set local role service_role;
select public.service_prepare_billing_refund((:'work'::jsonb#>>'{attempt,id}')::uuid,'subscription-refund-retention-fixture',11000,repeat('a',64),'fake-v1');
reset role;
insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status)
 values('b1714000-0000-4000-8000-000000000060','b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000061','awaiting_email_intent');
insert into private.account_action_fences(subject_user_id,deletion_event_id)
 values('b1714000-0000-4000-8000-000000000002','b1714000-0000-4000-8000-000000000060');
select private.goods_subscription_account_retention('b1714000-0000-4000-8000-000000000002') as retained_contract \gset
select 1/case when jsonb_array_length(:'retained_contract'::jsonb#>'{subscriptions,0,terms}')=2
 and exists(select 1 from jsonb_array_elements(:'retained_contract'::jsonb#>'{subscriptions,0,terms}') term
  where term->>'id'=:'terms_id' and term->>'policyTermsVersion'='goods-subscription-v1' and term->>'renewalTermsHash'~'^[0-9a-f]{64}$'
   and term->'schedule'=:'schedule'::jsonb and term#>>'{selection,0,goodId}'='subscription-tx-good'
   and term#>>'{selection,0,variantId}'=:'variant' and term#>>'{selection,0,qty}'='1'
   and term#>>'{firstAmounts,totals,onlineTotal}'='11000' and term#>>'{renewalAmounts,totals,onlineTotal}'='13000'
   and term#>>'{renewalAmounts,totals,couponDiscountTotal}'='0' and term#>>'{renewalAmounts,totals,storeCreditTotal}'='0')
 and (select count(distinct term->>'renewalTermsHash')=2 from jsonb_array_elements(:'retained_contract'::jsonb#>'{subscriptions,0,terms}') term)
 and (select count(distinct term->'schedule')=2 from jsonb_array_elements(:'retained_contract'::jsonb#>'{subscriptions,0,terms}') term)
 and exists(select 1 from jsonb_array_elements(:'retained_contract'::jsonb#>'{subscriptions,0,operations}') operation
  where operation->>'command'='confirm' and operation->>'recordedAt' is not null and operation->>'termsId'=:'terms_id' and operation->>'cycleId'='b1714000-0000-4000-8000-000000000030' and operation->>'revision'='2')
 and exists(select 1 from jsonb_array_elements(:'retained_contract'::jsonb#>'{subscriptions,0,operations}') operation
  where operation->>'command'='resume' and operation->>'recordedAt' is not null and operation->>'revision'=:'resumed'::jsonb->>'revision' and operation->>'termsId'=:'proposal'::jsonb->>'termsId' and operation->>'cycleId'=:'proposal'::jsonb->>'id')
 and not exists(select 1 from jsonb_array_elements(:'retained_contract'::jsonb#>'{subscriptions,0,cycles}') cycle
  where not exists(select 1 from jsonb_array_elements(:'retained_contract'::jsonb#>'{subscriptions,0,terms}') term where term->>'id'=cycle->>'termsId'))
 and :'retained_contract'::jsonb::text!~'(recipient|phone|address|inputValues|envelope|customerKey|authKey|issuer|profileId|43301234|TEST 수취인)'
 then 1 else 0 end as assert_contract_schedule_terms_amounts_reconsent_cycle_links_no_pii;
-- Add future/untrusted fields to a copy of the private accepted JSON. Projection
-- must ignore them even if future schema additions can contain personal data.
select 1/case when private.subscription_retention_display(
 (select first_display||jsonb_build_object('authKey','PRIVATE-CANARY','address','PRIVATE-CANARY','inputValues','PRIVATE-CANARY',
  'lines',(select jsonb_agg(line||jsonb_build_object('inputValues','PRIVATE-CANARY','masked_number','PRIVATE-CANARY')) from jsonb_array_elements(first_display->'lines') line))
  from private.goods_subscription_terms where id=:'terms_id'),clock_timestamp())::text not like '%PRIVATE-CANARY%'
 then 1 else 0 end as assert_retained_display_reconstructs_allowlist;

-- A separate synthetic future-schema contract contains privacy canaries. It is
-- not an application acceptance fixture; it tests the deletion projection boundary.
insert into private.goods_subscription_plans(id,owner_id,creation_operation_id,creation_request_hash,state,first_cycle_id,draft_expires_at,consented_at,canceled_at)
 values('b1714810-0000-4000-8000-000000000001','b1714000-0000-4000-8000-000000000002','b1714810-0000-4000-8000-000000000002',repeat('e',64),
 'canceled','b1714810-0000-4000-8000-000000000003',clock_timestamp()+interval '10 minutes',clock_timestamp(),clock_timestamp());
insert into private.goods_subscription_terms select (jsonb_populate_record(null::private.goods_subscription_terms,to_jsonb(term)||jsonb_build_object(
 'id','b1714810-0000-4000-8000-000000000004','plan_id','b1714810-0000-4000-8000-000000000001',
 'selection',jsonb_set(term.selection,'{0,inputValues}','{"engraving":"PRIVATE-DIRECT-INPUT-CANARY"}'),
 'address',term.address||'{"address1":"PRIVATE-ADDRESS-CANARY","phone":"01099887766"}'::jsonb,
 'first_display',term.first_display||'{"billingKey":"PRIVATE-BILLING-CANARY","authKey":"PRIVATE-AUTH-CANARY","masked_number":"PRIVATE-CARD-CANARY"}'::jsonb))).*
 from private.goods_subscription_terms term where term.id=:'terms_id';
update private.goods_subscription_plans set current_terms_id='b1714810-0000-4000-8000-000000000004' where id='b1714810-0000-4000-8000-000000000001';
insert into private.goods_subscription_cycles(id,plan_id,owner_id,cycle_number,schedule_slot,terms_id,scheduled_at,state) values
 ('b1714810-0000-4000-8000-000000000003','b1714810-0000-4000-8000-000000000001','b1714000-0000-4000-8000-000000000002',1,0,
 'b1714810-0000-4000-8000-000000000004',clock_timestamp(),'canceled');
select private.goods_subscription_account_retention('b1714000-0000-4000-8000-000000000002') as full_retained_contract \gset
select 1/case when jsonb_array_length(:'full_retained_contract'::jsonb->'subscriptions')=2
 and :'full_retained_contract'::jsonb::text!~'(PRIVATE-|01099887766|inputValues|billingKey|authKey|masked_number|address1|recipientName)'
 and exists(select 1 from jsonb_array_elements(:'full_retained_contract'::jsonb->'subscriptions') contract
  where contract->>'id'='b1714810-0000-4000-8000-000000000001' and contract#>>'{terms,0,selection,0,qty}'='1'
   and contract#>>'{terms,0,firstAmounts,totals,onlineTotal}'='11000')
 then 1 else 0 end as assert_whole_contract_excludes_address_direct_input_card_auth_canaries;
select private.purge_goods_subscription_account_data('b1714000-0000-4000-8000-000000000002');
select 1/case when not exists(select 1 from private.goods_subscription_plans where owner_id='b1714000-0000-4000-8000-000000000002')
 and not exists(select 1 from private.billing_credentials where owner_id='b1714000-0000-4000-8000-000000000002')
 and not exists(select 1 from private.billing_customers where user_id='b1714000-0000-4000-8000-000000000002')
 and exists(select 1 from private.payment_provider_bindings where attempt_id=(:'work'::jsonb#>>'{attempt,id}')::uuid)
 and exists(select 1 from private.billing_refund_operations where attempt_id=(:'work'::jsonb#>>'{attempt,id}')::uuid)
 and exists(select 1 from public.payment_attempts where id=(:'work'::jsonb#>>'{attempt,id}')::uuid)
 then 1 else 0 end as assert_pii_purged_financial_routing_retained;
set local role service_role;
select 1/case when public.service_get_payment_gateway_binding((:'work'::jsonb#>>'{attempt,id}')::uuid)->>'profileId'='b1714000-0000-4000-8000-000000000020'
 then 1 else 0 end as assert_erased_account_still_billing_dispatch;
select public.claim_goods_payment_reconciliation((:'work'::jsonb#>>'{attempt,id}')::uuid,'b1714000-0000-4000-8000-000000000062','subscription_retained_finance');
select 1/case when public.service_finalize_subscription_payment_reconciliation((:'work'::jsonb#>>'{attempt,id}')::uuid,'b1714000-0000-4000-8000-000000000062','approved')='approved'
 then 1 else 0 end as assert_retained_financial_finalizer_without_cycle;
rollback;
