\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql; use only the isolated synthetic DB.
begin;
create function pg_temp.best_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected BEST error: %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('93500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','review-best-'||n||'@example.test',now(),'{}','{}' from generate_series(1,8)n;
update public.profiles set role=case when id='93500000-0000-4000-8000-000000000001' then 'admin'::public.user_role when right(id::text,12)::integer<=3 then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='선정 합성 '||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id::text like '93500000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role)
 select ('93500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,role from unnest(array['primary','deputy','logistics']) with ordinality r(role,n);
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) select 'review-best-ip','선정 리뷰 합성 IP',key,now() from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price) values('review-best-good','review-best-ip','선정 리뷰 합성 상품','문구',10000);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id='review-best-good';
update public.profiles set role='staff' where id=(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id='review-best-good');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id='review-best-good';
select pg_temp.publish_goods_kc_fixture('review-best-good');
create function pg_temp.best_order(n integer,stars integer,with_evidence boolean default true) returns uuid language plpgsql as $$
declare purchase uuid:=('93500000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid;payment uuid:=('93500000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid;
 attempt uuid:=('93500000-0000-4000-8003-'||lpad(n::text,12,'0'))::uuid;buyer uuid:=('93500000-0000-4000-8000-'||lpad((n%5+4)::text,12,'0'))::uuid;review uuid;
begin
 insert into public.orders(id,user_id,status,total,address,delivered_at) values(purchase,buyer,'delivered',10000,'{}',clock_timestamp()-interval '2 days');
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select purchase,g.id,v.id,1,10000,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='review-best-good';
 insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key) values(payment,buyer,'order',purchase,'korpay',10000,'paid','review-best-payment-'||n);
 insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(attempt,'korpay',buyer,'order',purchase,10000,'approved','review-best-attempt-'||n,'review-best-order-'||n,'review-best-product-'||n,payment,now()+interval '1 hour');
 if with_evidence then insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(attempt,'confirm',now()-interval '3 days');end if;
 perform set_config('request.jwt.claim.sub',buyer::text,true);
 review:=public.create_good_review(purchase,'review-best-good',stars,'별점과 무관한 선정 리뷰 합성 본문 '||n);
 return review;
end $$;

-- Defaults have no financial effect. Test-only policy is rolled back.
select 1/case when (select not grade_enabled and not best_enabled from private.customer_reward_policy where singleton) then 1 else 0 end as assert_default_off;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values('93500000-0000-4000-8000-000000000101','93500000-0000-4000-8000-000000000001',now(),now(),now()+interval '1 hour');
select pg_temp.best_order(1,1) as review_a \gset
select pg_temp.best_order(2,2) as review_b \gset
select pg_temp.best_order(3,5) as review_c \gset
select pg_temp.best_order(4,4) as review_d \gset
select private.review_event_review_fingerprint(r) as fp_a from public.reviews r where id=:'review_a' \gset
select private.review_event_review_fingerprint(r) as fp_b from public.reviews r where id=:'review_b' \gset
select private.review_event_review_fingerprint(r) as fp_c from public.reviews r where id=:'review_c' \gset
select private.review_event_review_fingerprint(r) as fp_d from public.reviews r where id=:'review_d' \gset
select set_config('request.jwt.claim.sub','93500000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"93500000-0000-4000-8000-000000000001","role":"authenticated","session_id":"93500000-0000-4000-8000-000000000101"}',true);
set local role authenticated;
select public.admin_set_review_best(:'review_a',true,'TEST 정책 꺼짐 확인',0,:'fp_a',gen_random_uuid());
select 1/case when public.admin_process_review_best_reward(:'review_a')->>'state'='disabled' then 1 else 0 end as assert_disabled_no_reward;
select '{"gradeEnabled":true,"gradeRates":{"welcome":100,"silver":200,"gold":300,"platinum":400},"bestEnabled":true,"bestAmount":1000,"bestValidityDays":30,"bestReversal":"revoke","evidence":"TEST synthetic only","acknowledged":true}' as values \gset
select pg_temp.best_error(format($q$select public.admin_save_customer_reward_policy(%L,1,gen_random_uuid(),'93500000-0000-4000-8000-000000000001','93500000-0000-4000-8000-000000000101')$q$,:'values'),'store_credit_policy_required');
select public.admin_save_store_credit_policy(gen_random_uuid(),(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":1000,"earnMaxPerOrder":5000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"TEST ONLY"}');
select public.admin_save_customer_reward_policy(:'values',1,'93500000-0000-4000-8000-000000000201','93500000-0000-4000-8000-000000000001','93500000-0000-4000-8000-000000000101') as saved \gset
select 1/case when public.admin_save_customer_reward_policy(:'values',1,'93500000-0000-4000-8000-000000000201','93500000-0000-4000-8000-000000000001','93500000-0000-4000-8000-000000000101')=:'saved'::jsonb then 1 else 0 end as assert_exact_policy_replay;
select pg_temp.best_error(format($q$select public.admin_save_customer_reward_policy(%L,1,gen_random_uuid(),'93500000-0000-4000-8000-000000000001','93500000-0000-4000-8000-000000000101')$q$,:'values'),'customer_reward_policy_changed');
select pg_temp.best_error(format($q$select public.admin_save_customer_reward_policy(%L,2,gen_random_uuid(),'93500000-0000-4000-8000-000000000002','93500000-0000-4000-8000-000000000101')$q$,:'values'),'customer_reward_auth_changed');
select pg_temp.best_error(format($q$select public.admin_save_customer_reward_policy(%L::jsonb||'{"gradeRates":{"welcome":null,"silver":200,"gold":300,"platinum":400}}'::jsonb,2,gen_random_uuid(),'93500000-0000-4000-8000-000000000001','93500000-0000-4000-8000-000000000101')$q$,:'values'),'invalid_customer_reward_rate');
-- Previously selected while disabled is not paid retroactively. New selection is.
select 1/case when public.admin_process_review_best_reward(:'review_a')->>'amount'='0' then 1 else 0 end as assert_no_retroactive_award;
select public.admin_set_review_best(:'review_a',false,'TEST 새 정책 전 선정 해제',1,:'fp_a',gen_random_uuid());
select public.admin_set_review_best(:'review_a',true,'TEST 1점도 동일하게 보상',2,:'fp_a',gen_random_uuid());
select public.admin_process_review_best_reward(:'review_a');
select 1/case when public.admin_process_review_best_reward(:'review_a')->>'amount'='1000' then 1 else 0 end as assert_one_star_reward_once;
reset role;
select 1/case when (select count(*)=1 and sum(amount)=1000 from public.store_credit_ledger where order_id='93500000-0000-4000-8001-000000000001' and kind='adjustment_credit') then 1 else 0 end as assert_single_ledger_grant;
set local role anon;
select 1/case when public.get_review_event_disclosures(array[:'review_a'::uuid])#>>'{0,eventTitle}'='BEST 리뷰 보상' then 1 else 0 end as assert_public_benefit_disclosure;
reset role;
-- A used reward becomes future-credit offset, without charging money.
update private.store_credit_lots set available_amount=600,spent_amount=400 where id=(select lot_id from private.review_best_rewards where review_id=:'review_a');
set local role authenticated;
select public.admin_set_review_best(:'review_a',false,'TEST 사용한 보상 회수',3,:'fp_a',gen_random_uuid());
-- A quick reselection cannot undo an already recorded revocation decision.
select public.admin_set_review_best(:'review_a',true,'TEST 다시 선정 중복 금지',4,:'fp_a',gen_random_uuid());
select public.admin_process_review_best_reward(:'review_a');
reset role;
select 1/case when (select available_amount=0 and revoked_amount=600 and debt_amount=400 from private.store_credit_lots where id=(select lot_id from private.review_best_rewards where review_id=:'review_a'))
 and (select count(*)=1 from public.store_credit_ledger where order_id='93500000-0000-4000-8001-000000000001' and kind='adjustment_credit')
 and public.get_review_event_disclosures(array[:'review_a'::uuid])#>>'{0,revoked}'='true' then 1 else 0 end as assert_used_reward_reversal_and_reselection;
-- Immutable queued policy survives a later setting change; keep mode survives removal.
set local role authenticated;
select public.admin_save_customer_reward_policy(:'values'::jsonb||'{"bestReversal":"keep"}',2,gen_random_uuid(),'93500000-0000-4000-8000-000000000001','93500000-0000-4000-8000-000000000101');
select public.admin_set_review_best(:'review_b',true,'TEST 유지 정책 보상',0,:'fp_b',gen_random_uuid());
select public.admin_save_customer_reward_policy(:'values'::jsonb||'{"bestEnabled":false}',3,gen_random_uuid(),'93500000-0000-4000-8000-000000000001','93500000-0000-4000-8000-000000000101');
select 1/case when public.admin_process_review_best_reward(:'review_b')->>'amount'='1000' then 1 else 0 end as assert_pending_policy_snapshot;
select public.admin_set_review_best(:'review_b',false,'TEST 지급 유지',1,:'fp_b',gen_random_uuid());
select 1/case when public.admin_process_review_best_reward(:'review_b')->>'state'='paid' then 1 else 0 end as assert_keep_policy;
select public.admin_save_customer_reward_policy(:'values',4,gen_random_uuid(),'93500000-0000-4000-8000-000000000001','93500000-0000-4000-8000-000000000101');
-- Holding cap is respected and the limited award is not topped up on reselect.
select public.admin_adjust_store_credit(gen_random_uuid(),'93500000-0000-4000-8000-000000000007',99900,now()+interval '1 day','TEST 한도',0);
select public.admin_set_review_best(:'review_c',true,'TEST 보유 한도',0,:'fp_c',gen_random_uuid());
select 1/case when public.admin_process_review_best_reward(:'review_c')->>'amount'='100' then 1 else 0 end as assert_holding_cap;
select public.admin_set_review_best(:'review_d',true,'TEST 삭제 회수',0,:'fp_d',gen_random_uuid());
select public.admin_process_review_best_reward(:'review_d');
reset role;
delete from public.reviews where id=:'review_d';
select private.process_review_best_reward_jobs(:'review_d');
select 1/case when (select revoked_at is not null from private.review_best_rewards where review_id=:'review_d') then 1 else 0 end as assert_delete_revokes;
select 1/case when not has_table_privilege('authenticated','private.review_best_rewards','select')
 and not has_function_privilege('authenticated','public.process_review_best_rewards()','execute')
 and not has_function_privilege('service_role','public.admin_save_customer_reward_policy(jsonb,bigint,uuid,uuid,uuid)','execute') then 1 else 0 end as assert_sealed_roles;
set local role authenticated;
select set_config('request.jwt.claim.sub','93500000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"93500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.best_error(format('select public.admin_process_review_best_reward(%L)',:'review_a'),'operator_capability_required');
reset role;
select 1/case when not exists(select 1 from private.review_best_reward_jobs where review_id=any(array[:'review_a'::uuid,:'review_b'::uuid,:'review_c'::uuid,:'review_d'::uuid]) and state<>'done') then 1 else 0 end as assert_no_failed_jobs;
rollback;
