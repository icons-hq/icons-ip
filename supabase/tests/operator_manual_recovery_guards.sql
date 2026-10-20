\set ON_ERROR_STOP on
begin;
-- Guard-only synthetic fixtures. Never invoke a successful financial finalizer,
-- create paid/refund results, or contact a provider. Everything is rolled back.
do $$ begin
 if (select configured from private.operator_access_state where id) or to_regclass('private.operator_legacy_fixture_control') is not null then
  raise exception 'Run without legacy helper in an unconfigured isolated test DB';end if;
end $$;
create function pg_temp.expect_manual_guard(q text,wanted_state text,wanted_message text) returns void language plpgsql as $$
begin begin execute q;exception when others then
 if sqlstate=wanted_state and sqlerrm=wanted_message then return;end if;raise;
 end;raise exception 'expected guard %: %',wanted_state,wanted_message;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('bfc01800-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','manual-guard-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,7)n;
update public.profiles set role=case when right(id::text,2) in ('01','03','04','06') then 'admin'::public.user_role when right(id::text,2)='07' then 'user'::public.user_role else 'staff'::public.user_role end
 where id::text like 'bfc01800-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 ('bfc01800-0000-4000-8000-000000000001','owner'),('bfc01800-0000-4000-8000-000000000002','primary'),('bfc01800-0000-4000-8000-000000000003','deputy');
insert into private.operator_legacy_cohort(profile_id,legacy_role) values('bfc01800-0000-4000-8000-000000000004','admin'),('bfc01800-0000-4000-8000-000000000005','staff');
-- A real pending order/request relationship makes the finalizer's nonfinancial
-- status gate reachable. No paid payment, refund, stock or reward result exists.
insert into public.orders(id,user_id,status,total,address) values('bfc01800-0000-4000-8000-000000000101','bfc01800-0000-4000-8000-000000000007','pending',1000,'{}');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,status,stage)
 values('bfc01800-0000-4000-8000-000000000102','bfc01800-0000-4000-8000-000000000101','bfc01800-0000-4000-8000-000000000007','합성 guard 검사','requested','requested');
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,expires_at)
 values('bfc01800-0000-4000-8000-000000000103','korpay','bfc01800-0000-4000-8000-000000000007','order','bfc01800-0000-4000-8000-000000000101',1000,'needs_review','manual-guard-only','manual-guard-order','manual-guard-product',now()+interval '1 hour');
insert into private.goods_payment_manual_recovery_claims(attempt_id,order_id,request_id,actor_id,operation,case_ref,claim_token,prior_attempt_state,expires_at)
 values('bfc01800-0000-4000-8000-000000000103','bfc01800-0000-4000-8000-000000000101','bfc01800-0000-4000-8000-000000000102','bfc01800-0000-4000-8000-000000000002','provider_cancel_confirmed','case_v1_00000000000000000000000000000001','bfc01800-0000-4000-8000-000000000104','needs_review',now()+interval '15 minutes');
create temp table manual_guard_money_before as select
 (select count(*) from public.payments) payments,(select count(*) from public.refunds) refunds,
 (select count(*) from private.goods_payment_manual_recovery_audits) manual_audits,
 (select md5(string_agg(id::text||':'||stock_qty::text,',' order by id)) from public.goods) stock_digest;
select 1/case when not has_function_privilege('authenticated','public.claim_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid)','execute')
 and not has_function_privilege('authenticated','public.finalize_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid,boolean)','execute')
 and not has_function_privilege('anon','public.claim_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid)','execute')
 and has_function_privilege('service_role','public.claim_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid)','execute')
 and has_function_privilege('service_role','public.finalize_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid,boolean)','execute') then 1 else 0 end as service_only_acl;
set local role service_role;
do $$ declare n integer; expected_state text; expected_message text;
begin for n in 1..6 loop
 -- Missing attempt guarantees no claim or payment state can be created. Getting
 -- P0002 proves the actor passed both the entry and nested authorization checks.
 expected_state:=case when n in (1,2,4) then 'P0002' else '42501' end;
 expected_message:=case when n in (1,2,4) then 'goods_payment_attempt_not_found' else 'operator_capability_required' end;
 perform pg_temp.expect_manual_guard(format('select public.claim_goods_manual_payment_recovery(%L,%L,%L,%L,%L,%L)',
  'bfc01800-0000-4000-8000-000000000999',('bfc01800-0000-4000-8000-'||lpad(n::text,12,'0')),
  'bfc01800-0000-4000-8000-000000000102','case_v1_00000000000000000000000000000001','provider_cancel_confirmed','bfc01800-0000-4000-8000-000000000104'),expected_state,expected_message);
 end loop;end $$;
-- A currently privileged but unbound actor cannot complete someone else's claim.
select pg_temp.expect_manual_guard($q$select public.finalize_goods_manual_payment_recovery('bfc01800-0000-4000-8000-000000000103','bfc01800-0000-4000-8000-000000000001','bfc01800-0000-4000-8000-000000000102','case_v1_00000000000000000000000000000001','provider_cancel_confirmed','bfc01800-0000-4000-8000-000000000104',true)$q$,'42501','admin required');
-- Matching primary passes authority and stops before any financial result.
select pg_temp.expect_manual_guard($q$select public.finalize_goods_manual_payment_recovery('bfc01800-0000-4000-8000-000000000103','bfc01800-0000-4000-8000-000000000002','bfc01800-0000-4000-8000-000000000102','case_v1_00000000000000000000000000000001','provider_cancel_confirmed','bfc01800-0000-4000-8000-000000000104',true)$q$,'55000','cancellation_request_not_recoverable');
reset role;
update private.operator_memberships set manager_role='deputy',revision=revision+1 where profile_id='bfc01800-0000-4000-8000-000000000002';
select 1/case when not private.has_operator_capability('bfc01800-0000-4000-8000-000000000002','sales.manage',true)
 and private.can_finish_operator_manual_recovery('bfc01800-0000-4000-8000-000000000103','bfc01800-0000-4000-8000-000000000102','bfc01800-0000-4000-8000-000000000002','provider_cancel_confirmed','case_v1_00000000000000000000000000000001','bfc01800-0000-4000-8000-000000000104') then 1 else 0 end as revoked_actor_has_only_bound_finish;
set local role service_role;
select pg_temp.expect_manual_guard($q$select public.claim_goods_manual_payment_recovery('bfc01800-0000-4000-8000-000000000999','bfc01800-0000-4000-8000-000000000002','bfc01800-0000-4000-8000-000000000102','case_v1_00000000000000000000000000000001','provider_cancel_confirmed','bfc01800-0000-4000-8000-000000000104')$q$,'42501','operator_capability_required');
select pg_temp.expect_manual_guard($q$select public.finalize_goods_manual_payment_recovery('bfc01800-0000-4000-8000-000000000103','bfc01800-0000-4000-8000-000000000002','bfc01800-0000-4000-8000-000000000102','case_v1_00000000000000000000000000000001','provider_cancel_confirmed','bfc01800-0000-4000-8000-000000000104',true)$q$,'55000','cancellation_request_not_recoverable');
select pg_temp.expect_manual_guard($q$select public.finalize_goods_manual_payment_recovery('bfc01800-0000-4000-8000-000000000103','bfc01800-0000-4000-8000-000000000002','bfc01800-0000-4000-8000-000000000102','case_v1_00000000000000000000000000000001','provider_cancel_confirmed','bfc01800-0000-4000-8000-000000000104',false)$q$,'22023','goods_manual_recovery_attestation_invalid');
select pg_temp.expect_manual_guard($q$select public.finalize_goods_manual_payment_recovery('bfc01800-0000-4000-8000-000000000103','bfc01800-0000-4000-8000-000000000002','bfc01800-0000-4000-8000-000000000102','case_v1_00000000000000000000000000000001','provider_cancel_confirmed','bfc01800-0000-4000-8000-000000000105',true)$q$,'42501','admin required');
reset role;
select 1/case when (select count(*) from public.payments)=b.payments and (select count(*) from public.refunds)=b.refunds
 and (select count(*) from private.goods_payment_manual_recovery_audits)=b.manual_audits
 and (select md5(string_agg(id::text||':'||stock_qty::text,',' order by id)) from public.goods) is not distinct from b.stock_digest
 and (select status='pending' from public.orders where id='bfc01800-0000-4000-8000-000000000101')
 and (select state='needs_review' from public.payment_attempts where id='bfc01800-0000-4000-8000-000000000103')
 and (select status='requested' from public.order_cancellation_requests where id='bfc01800-0000-4000-8000-000000000102') then 1 else 0 end as no_financial_effect from manual_guard_money_before b;
rollback;
