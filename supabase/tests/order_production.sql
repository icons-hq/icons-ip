\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
begin;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c7160805-0000-4000-8000-000000000001','authenticated','authenticated','production-check-admin@example.test',now(),'{}','{}',now(),now()),
 ('c7160805-0000-4000-8000-000000000002','authenticated','authenticated','production-check-buyer@example.test',now(),'{}','{}',now(),now()),
 ('c7160805-0000-4000-8000-000000000003','authenticated','authenticated','production-check-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 제작 회귀 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='c7160805-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-8000-000000000002','c7160805-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('c7160805-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('production-check-ip','TEST 제작 회귀 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('c7160805-0000-4000-8000-000000000010','production-check-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('production-check-a','production-check-ip','TEST 상품 A','문구',10000,'ok',100,'c7160805-0000-4000-8000-000000000010','policy',0),
 ('production-check-b','production-check-ip','TEST 상품 B','문구',5000,'ok',100,'c7160805-0000-4000-8000-000000000010','individual',2000);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','transaction-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='production-check-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='production-check-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='production-check-ip';
select id as variant_a from public.goods_variants where good_id='production-check-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='production-check-b' and is_default \gset

insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select ('c7160805-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('c7160805-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
create function pg_temp.production_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','c7160805-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','c7160805-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','c7160805-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
create function pg_temp.production_values(days integer default 5) returns jsonb language sql as $$select jsonb_build_object('enabled',true,'leadDays',days,'dayBasis','calendar','closedDates','[]'::jsonb,'publicNote','TEST 결제 확인 후 제작','evidence','TEST 명시적 납기 설정','confirmed',true);$$;
select pg_temp.production_actor(1);set local role authenticated;
select public.admin_save_shipping_region_policy(null,jsonb_build_object('originId','c7160805-0000-4000-8000-000000000010','carrierCode','hanjin','name','TEST 제작 기본운임',
 'startsAt',now()-interval '1 day','endsAt',null,'openEnded',true,'sourceEvidence','TEST production regional policy','unlistedDisposition','standard','feeUnit','per_shipment',
 'chargePolicyGoods',true,'waivePolicyThreshold',false,'chargeFreeGoods',false,'chargeIndividualGoods',true,'noRulesConfirmed',true,'rules','[]'::jsonb),null) as region \gset
select public.admin_set_shipping_region_policy_status((:'region'::jsonb->>'id')::uuid,'active',1,true);
select public.admin_save_goods_production('production-check-a',pg_temp.production_values(),0,'c7160805-0000-4002-8000-000000000001','c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-9000-000000000001') as saved \gset
select 1/case when public.admin_save_goods_production('production-check-a',pg_temp.production_values(),0,'c7160805-0000-4002-8000-000000000001','c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-9000-000000000001')=:'saved'::jsonb then 1 else 0 end as settings_replay;
reset role;
select 1/case when private.production_deadline('2026-10-16T03:00:00Z','{"leadDays":2,"dayBasis":"business","closedDates":["2026-10-19"]}')='2026-10-21T14:59:59.999999Z' then 1 else 0 end as weekend_and_explicit_holiday;
select pg_temp.production_actor(2);set local role authenticated;
select public.set_cart_item_quantity('production-check-a',:'variant_a',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as expected_cart from public.cart_items where user_id='c7160805-0000-4000-8000-000000000002' \gset
select '{"recipientName":"TEST 제작 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset
reset role;set local role service_role;
select public.quote_cart_goods_transaction('c7160805-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',null,0) as quote \gset
select 1/case when :'quote'::jsonb#>>'{display,lines,0,production,leadDays}'='5' then 1 else 0 end as public_quote_terms;
reset role;select pg_temp.production_actor(1);set local role authenticated;
select public.admin_save_goods_production('production-check-a',pg_temp.production_values(7),1,gen_random_uuid(),'c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-9000-000000000001');
reset role;set local role service_role;
select pg_temp.transaction_expect_error(format('select public.place_cart_goods_transaction(%L,%L,%L,%L,%L,%L)','c7160805-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId'),gen_random_uuid(),'card'),'transaction_quote_changed');
select public.quote_cart_goods_transaction('c7160805-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',null,0) as quote \gset
select public.place_cart_goods_transaction('c7160805-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId')::uuid,'c7160805-0000-4002-8000-000000000010','card') as order_id \gset
reset role;
select 1/case when (select count(*) from private.order_production_jobs where order_id=:'order_id' and state='pending' and terms->>'leadDays'='7')=1 then 1 else 0 end as exact_order_terms_and_job;
select id as job_id from private.order_production_jobs where order_id=:'order_id' \gset
select id as shipment_id from public.order_shipments where order_id=:'order_id' \gset
insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key) select 'c7160805-0000-4004-8000-000000000001',user_id,'order',id,'toss',total,'paid','production-paid' from public.orders where id=:'order_id';
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at) select 'c7160805-0000-4005-8000-000000000001','toss',user_id,'order',id,total,'approved','production-attempt','production-provider','production-check-code','c7160805-0000-4004-8000-000000000001',now()+interval '1 hour' from public.orders where id=:'order_id';
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values('c7160805-0000-4005-8000-000000000001','confirm',now());
update public.orders set status='paid' where id=:'order_id';
select pg_temp.production_actor(1);set local role authenticated;
select public.admin_update_order_status(:'order_id','confirmed',null,null);
select pg_temp.transaction_expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',:'shipment_id','shipping','hanjin','TESTPROD1234'),'production_incomplete');
select pg_temp.transaction_expect_error(format('select public.admin_shipment_export(array[%L::uuid])',:'shipment_id'),'production_incomplete');
select public.admin_change_order_production(:'job_id','start',1,'c7160805-0000-4002-8000-000000000020','c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-9000-000000000001','TEST 실제 제작 시작') as started \gset
select 1/case when public.admin_change_order_production(:'job_id','start',1,'c7160805-0000-4002-8000-000000000020','c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-9000-000000000001','TEST 실제 제작 시작')=:'started'::jsonb then 1 else 0 end as start_frozen_replay;
select pg_temp.transaction_expect_error(format('select public.admin_change_order_production(%L,%L,1,gen_random_uuid(),%L,%L,%L)',:'job_id','complete','c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-9000-000000000001','TEST 오래된 상태'),'production_changed');
reset role;
savepoint claim_request;
set local role service_role;
select public.request_order_cancellation(:'order_id','c7160805-0000-4000-8000-000000000002','TEST 제작 시작 후 취소','change_of_mind') as cancellation \gset
select 1/case when :'cancellation'='requested' then 1 else 0 end as started_cancellation_intake;
reset role;
select 1/case when exists(select 1 from public.order_cancellation_requests where order_id=:'order_id' and stage='requested') and not exists(select 1 from public.refunds where cancellation_request_id in(select id from public.order_cancellation_requests where order_id=:'order_id')) then 1 else 0 end as no_auto_refund;
set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_change_order_production(%L,%L,2,gen_random_uuid(),%L,%L,%L)',:'job_id','complete','c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-9000-000000000001','TEST 취소 요청 중 제작'),'production_transition_unavailable');
reset role;rollback to claim_request;
set local role authenticated;
select public.admin_change_order_production(:'job_id','complete',2,gen_random_uuid(),'c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-9000-000000000001','TEST 실제 제작 완료');
select public.admin_update_shipment_status(:'shipment_id','shipping','hanjin','TESTPROD1234');
reset role;
select 1/case when not private.order_cancel_eligible(:'order_id') and (select state from private.order_production_jobs where id=:'job_id')='completed' then 1 else 0 end as completed_then_dispatched;
select pg_temp.production_actor(2);set local role authenticated;
select 1/case when public.get_my_order_production(:'order_id')#>>'{jobs,0,state}'='completed' and jsonb_array_length(public.get_my_order_production(:'order_id')#>'{jobs,0,history}')=0 then 1 else 0 end as customer_public_status_no_internal_evidence;
reset role;
-- An exchange gets its own job only after full physical recovery, preserving
-- the original contract even if the current product settings change.
set local role service_role;
select public.request_order_claim(:'order_id','c7160805-0000-4000-8000-000000000002','exchange','TEST 제작품 전체 교환','defect');
reset role;
select id as exchange_id from public.order_cancellation_requests where order_id=:'order_id' \gset
select 1/case when not exists(select 1 from private.order_production_jobs where claim_id=:'exchange_id') then 1 else 0 end as no_replacement_before_recovery;
select pg_temp.production_actor(1);set local role authenticated;
select public.admin_save_goods_production('production-check-a',pg_temp.production_values(9),2,gen_random_uuid(),'c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-9000-000000000001');
select public.admin_decide_order_claim(:'exchange_id','approve',null);
select public.admin_record_order_claim_origin_collection(:'exchange_id',:'shipment_id','TEST 제작품 실물 전체 회수');
reset role;
select id as exchange_job from private.order_production_jobs where claim_id=:'exchange_id' \gset
select 1/case when (select terms->>'leadDays'='7' and basis_at is not null and due_at is not null from private.order_production_jobs where id=:'exchange_job') then 1 else 0 end as replacement_preserves_purchased_terms;
select pg_temp.transaction_expect_error(format('select private.record_order_claim_reshipment_physical(%L,%L,%L,%L)',:'exchange_id','hanjin','TESTREPROD1234','[]'),'production_incomplete');
set local role authenticated;
select public.admin_change_order_production(:'exchange_job','start',1,gen_random_uuid(),'c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-9000-000000000001','TEST 교환 재제작 시작');
select public.admin_change_order_production(:'exchange_job','complete',2,gen_random_uuid(),'c7160805-0000-4000-8000-000000000001','c7160805-0000-4000-9000-000000000001','TEST 교환 재제작 완료');
reset role;
select private.record_order_claim_reshipment_physical(:'exchange_id','hanjin','TESTREPROD1234','[]');
select 1/case when (select reshipped_at is not null from public.order_cancellation_requests where id=:'exchange_id') and (select count(*) from private.order_production_jobs where order_id=:'order_id' and state='completed')=2 then 1 else 0 end as replacement_released_after_completion;
select pg_temp.production_actor(3);set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.get_my_order_production(%L)',:'order_id'),'insufficient_privilege');
reset role;
-- Deletion preserves structured transaction evidence and strips free text.
update private.account_deletion_control set transaction_lookup_hmac_ready=true,legacy_transaction_evidence_ready=true,
 immutable_ticket_contract_ready=true,community_legal_records_ready=true,phase_one_enabled=true where singleton;
select pg_temp.production_actor(2);set local role authenticated;
select public.request_my_account_deletion('회원 탈퇴를 신청합니다','c7160805-0000-4006-8000-000000000001');
reset role;
select 1/case when (select count(*) from private.account_deletion_legal_snapshots s join private.account_deletion_requests d on d.deletion_event_id=s.deletion_event_id
 where d.subject_user_id='c7160805-0000-4000-8000-000000000002' and s.record_type='order_production' and s.snapshot_data::text!~'(publicNote|sessionId|evidence|TEST)')=2 then 1 else 0 end as production_legal_evidence_minimized;
select 1/case when not has_function_privilege('service_role','public.admin_change_order_production(uuid,text,bigint,uuid,uuid,uuid,text)','execute') and not has_function_privilege('authenticated','private.production_deadline(timestamptz,jsonb)','execute') then 1 else 0 end as sealed_acl;
rollback;
