\set ON_ERROR_STOP on
begin;
create function pg_temp.expect_subscription_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
select 1/case when not (select public_enabled or charge_enabled or worker_enabled or fake_local_enabled from private.goods_subscription_runtime)
 then 1 else 0 end as assert_default_closed;
select 1/case when private.subscription_slot_at('{"unit":"month","interval":1,"anchorDate":"2028-01-31","time":"09:00","monthEnd":false}',1)='2028-02-29T00:00:00Z'
 and private.subscription_slot_at('{"unit":"month","interval":1,"anchorDate":"2028-01-31","time":"09:00","monthEnd":false}',2)='2028-03-31T00:00:00Z'
 then 1 else 0 end as assert_kst_calendar_anchor;
select pg_temp.expect_subscription_error($q$select private.subscription_normalize_schedule('{"unit":"week","interval":3,"anchorDate":"2028-01-31","time":"09:00","monthEnd":false}')$q$,'invalid_subscription_schedule');
select pg_temp.expect_subscription_error($q$select private.subscription_normalize_schedule('{"unit":"month","interval":1,"anchorDate":"2028-02-30","time":"09:00","monthEnd":false}')$q$,'invalid_subscription_schedule');
select 1/case when not has_table_privilege('authenticated','private.billing_credentials','SELECT,INSERT,UPDATE,DELETE')
 and not has_table_privilege('service_role','private.billing_credentials','SELECT,INSERT,UPDATE,DELETE')
 and not has_function_privilege('authenticated','public.service_prepare_billing_registration(uuid,uuid,uuid,uuid,text,jsonb,text)','execute')
 and not has_function_privilege('anon','public.get_my_billing_credentials(uuid)','execute')
 and not has_function_privilege('service_role','private.subscription_slot_at(jsonb,integer)','execute')
 then 1 else 0 end as assert_private_acl;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('b1712000-0000-4000-8000-000000000001','authenticated','authenticated','subscription-admin@example.test',now(),'{}','{}',now(),now()),
 ('b1712000-0000-4000-8000-000000000002','authenticated','authenticated','subscription-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='TEST 정기배송 관리자' where id='b1712000-0000-4000-8000-000000000001';
update public.profiles set nickname='TEST 정기배송 고객',birth_date='1995-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id='b1712000-0000-4000-8000-000000000002';
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values('b1712000-0000-4000-8000-000000000003','b1712000-0000-4000-8000-000000000002',now(),now(),'aal1');
insert into private.operator_memberships(profile_id,manager_role) values('b1712000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) values('subscription-tests','TEST 정기배송','character',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','b1712000-0000-4000-8000-000000000001',true);
select public.admin_save_good('{"id":"subscription-policy-good","ip_id":"subscription-tests","name":"TEST 정기배송 상품","price":10000,"variant_baseline":[],"variants":[{"name":"기본 옵션","attributes":{},"code":"SUBSCRIPTION-TERMS-01","extraPrice":0,"stockQty":20}]}');
select public.admin_get_goods_subscription_policy('b1712000-0000-4000-8000-000000000001','subscription-policy-good') as policy_before \gset
select 1/case when :'policy_before'::jsonb->>'revision'='0' and :'policy_before'::jsonb->>'enabled'='false' then 1 else 0 end as assert_policy_default_off;
select public.admin_save_goods_subscription_policy('b1712000-0000-4000-8000-000000000001','subscription-policy-good',0,
 (:'policy_before'::jsonb->>'goodUpdatedAt')::timestamptz,'b1712000-0000-4000-8000-000000000010',true,'["week_2","month_1"]','정기배송 안내') as saved_policy \gset
select 1/case when :'saved_policy'::jsonb->>'revision'='1' and :'saved_policy'::jsonb->>'enabled'='true'
 and public.admin_save_goods_subscription_policy('b1712000-0000-4000-8000-000000000001','subscription-policy-good',0,
 (:'policy_before'::jsonb->>'goodUpdatedAt')::timestamptz,'b1712000-0000-4000-8000-000000000010',true,'["month_1","week_2"]','정기배송 안내')=:'saved_policy'::jsonb
 then 1 else 0 end as assert_policy_original_receipt;
select pg_temp.expect_subscription_error(format('select public.admin_save_goods_subscription_policy(%L,%L,0,%L,%L,true,%L,%L)',
 'b1712000-0000-4000-8000-000000000001','subscription-policy-good',(:'policy_before'::jsonb->>'goodUpdatedAt'),
 'b1712000-0000-4000-8000-000000000011','["month_1"]','안내'),'subscription_policy_conflict');
reset role;
insert into private.billing_profiles(id,merchant_id,environment,adapter,enabled) values('b1712000-0000-4000-8000-000000000020','subscribetest','test','fake',true);
select '{"v":1,"keyVersion":"fixture-v1","iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA"}'::jsonb as envelope \gset
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.expect_subscription_error(format('select public.service_prepare_billing_registration(%L,%L,%L,%L,%L,%L,%L)',
 'b1712000-0000-4000-8000-000000000002','b1712000-0000-4000-8000-000000000003','b1712000-0000-4000-8000-000000000021',
 'b1712000-0000-4000-8000-000000000020',repeat('a',64),:'envelope','fixture-v1'),'subscriptions_unavailable');
reset role;
update private.goods_subscription_runtime set public_enabled=true,fake_local_enabled=true where singleton;
set local role service_role;
select public.service_prepare_billing_registration('b1712000-0000-4000-8000-000000000002','b1712000-0000-4000-8000-000000000003',
 'b1712000-0000-4000-8000-000000000021','b1712000-0000-4000-8000-000000000020',repeat('a',64),:'envelope','fixture-v1') as prepared \gset
select pg_temp.expect_subscription_error(format('select public.service_finish_billing_registration(%L,%L,null,0,%L,%L,%L,now())',
 'b1712000-0000-4000-8000-000000000002','b1712000-0000-4000-8000-000000000021','ready',:'envelope','{"issuerCode":"11","number":"123456******1234"}'),'billing_registration_claim_stale');
select public.service_claim_billing_registration('b1712000-0000-4000-8000-000000000002','b1712000-0000-4000-8000-000000000003',
 'b1712000-0000-4000-8000-000000000021',repeat('a',64),:'envelope',repeat('b',64),'b1712000-0000-4000-8000-000000000022') as claimed \gset
select 1/case when :'claimed'::jsonb->>'kind'='claimed' and :'claimed'::jsonb->>'claimFence'='1'
 and public.service_claim_billing_registration('b1712000-0000-4000-8000-000000000002','b1712000-0000-4000-8000-000000000003',
 'b1712000-0000-4000-8000-000000000021',repeat('a',64),:'envelope',repeat('b',64),'b1712000-0000-4000-8000-000000000023')->>'kind'='busy'
 then 1 else 0 end as assert_single_registration_claim;
select public.service_finish_billing_registration('b1712000-0000-4000-8000-000000000002','b1712000-0000-4000-8000-000000000021',
 'b1712000-0000-4000-8000-000000000022',1,'ready',:'envelope','{"issuerCode":"11","number":"123456******1234"}',now());
reset role;
select 1/case when (select auth_envelope is null from private.billing_enrollments where id='b1712000-0000-4000-8000-000000000021') then 1 else 0 end as assert_auth_cleared;
update public.profiles set suspended_at=now(),suspension_reason='TEST 일시 정지' where id='b1712000-0000-4000-8000-000000000002';
set local role service_role;
select 1/case when public.service_prepare_billing_registration('b1712000-0000-4000-8000-000000000002','b1712000-0000-4000-8000-000000000003',
 'b1712000-0000-4000-8000-000000000021','b1712000-0000-4000-8000-000000000020',repeat('a',64),:'envelope','fixture-v1')->>'state'='ready'
 then 1 else 0 end as assert_fenced_receipt_replay;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','b1712000-0000-4000-8000-000000000002',true);
select public.get_my_billing_credentials('b1712000-0000-4000-8000-000000000002') as cards \gset
select 1/case when jsonb_array_length(:'cards')=1 and not ((:'cards')::jsonb->0 ?| array['envelope','customerKey','profileId','merchantId']) then 1 else 0 end as assert_customer_safe_projection;
select pg_temp.expect_subscription_error($q$select public.get_my_billing_credentials('b1712000-0000-4000-8000-000000000001')$q$,'subscription_actor_changed');
rollback;
