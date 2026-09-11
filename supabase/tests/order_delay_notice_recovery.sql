\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000494101','authenticated','authenticated','delay-recovery-staff@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000494102','authenticated','authenticated','delay-recovery-buyer@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000494101';
insert into public.orders(id,user_id,status,total,address,confirmed_at)
 select ('00000000-0000-4000-8000-00000049411'||n)::uuid,'00000000-0000-4000-8000-000000494102','confirmed',10000,'{}',now()-interval '5 days' from generate_series(1,3)n;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status)
 select ('00000000-0000-4000-8000-00000049412'||n)::uuid,('00000000-0000-4000-8000-00000049411'||n)::uuid,
 '00000000-0000-4000-8000-000000042201','김포',0,'{}','ready' from generate_series(1,3)n;
select 1/case when not (select enabled from private.order_delay_notice_delivery_control where singleton)
 and not (select enabled from private.email_dispatch_control where singleton) then 1 else 0 end as assert_both_default_off;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000494101',true);
select public.admin_prepare_order_delay_notice('00000000-0000-4000-8000-000000494131',
 array['00000000-0000-4000-8000-000000494121','00000000-0000-4000-8000-000000494122','00000000-0000-4000-8000-000000494123']::uuid[],'고객 안내','확인되는 대로 알려드리겠습니다.',null);
do $$begin perform public.admin_request_order_delay_notice('00000000-0000-4000-8000-000000494131');raise exception 'disabled gate sent';exception when check_violation then if sqlerrm<>'delay_notice_delivery_disabled' then raise;end if;end$$;
reset role;
update private.order_delay_notice_delivery_control set enabled=true where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000494101',true);
select public.admin_request_order_delay_notice('00000000-0000-4000-8000-000000494131');
set local role service_role;
select public.claim_order_delay_email_jobs(3) as jobs \gset
select value->>'id' as first_id,value->>'claimToken' as first_claim from jsonb_array_elements(:'jobs') where value->>'orderId'='00000000-0000-4000-8000-000000494111' \gset
select value->>'id' as second_id,value->>'claimToken' as second_claim from jsonb_array_elements(:'jobs') where value->>'orderId'='00000000-0000-4000-8000-000000494112' \gset
select value->>'id' as third_id,value->>'claimToken' as third_claim from jsonb_array_elements(:'jobs') where value->>'orderId'='00000000-0000-4000-8000-000000494113' \gset
select public.enqueue_email_intent('auth_hook',repeat('a0',32),repeat('b0',32),'auth_signup','auth_signup_v1')->>'intentId' as auth_intent \gset
select 1/case when public.claim_email_intent_dispatch(:'auth_intent',repeat('b0',32))->>'kind'='disabled' then 1 else 0 end as assert_order_gate_does_not_enable_auth;
select public.enqueue_email_intent('order_delay_notice',repeat('a1',32),repeat('b1',32),'order_delay_notice','order_delay_v1')->>'intentId' as first_intent \gset
select public.enqueue_email_intent('order_delay_notice',repeat('a2',32),repeat('b1',32),'order_delay_notice','order_delay_v1')->>'intentId' as second_intent \gset
select public.enqueue_email_intent('order_delay_notice',repeat('a3',32),repeat('b1',32),'order_delay_notice','order_delay_v1')->>'intentId' as third_intent \gset
select 1/case when public.bind_order_delay_email_intent(:'first_id',:'first_claim',:'first_intent') then 1 else 0 end as assert_first_bind;
select 1/case when public.claim_email_intent_dispatch(:'first_intent',repeat('b1',32))->>'kind'='claimed' then 1 else 0 end as assert_narrow_gate_dispatches;
select public.record_email_intent_dispatch_failure(:'first_intent','ambiguous');
select public.finish_order_delay_email_job(:'first_id',:'first_claim','unknown','delivery_outcome_unknown',false);
select 1/case when public.enqueue_email_intent('order_delay_notice',repeat('a1',32),repeat('b1',32),'order_delay_notice','order_delay_v1')->>'intentId'=:'first_intent' then 1 else 0 end as assert_unknown_replays_same_intent;
select 1/case when public.bind_order_delay_email_intent(:'third_id',:'third_claim',:'third_intent') then 1 else 0 end as assert_third_bind;
select public.claim_email_intent_dispatch(:'third_intent',repeat('b1',32))->>'claimId' as dispatch_claim \gset
select public.record_email_intent_accepted(:'third_intent',repeat('c3',32));
select 1/case when public.recover_email_acceptance_persistence_failure(:'third_intent',:'dispatch_claim')->>'state'='accepted' then 1 else 0 end as assert_acceptance_commit_survives_lost_response;
reset role;
update public.profiles set email='changed-recovery@example.test' where id='00000000-0000-4000-8000-000000494102';
set local role service_role;
select 1/case when not public.bind_order_delay_email_intent(:'second_id',:'second_claim',:'second_intent') then 1 else 0 end as assert_unattempted_recipient_change_stops_dispatch;
select public.finish_order_delay_email_job(:'third_id',:'third_claim','sent',null,false);
select 1/case when not public.finish_order_delay_email_job(:'third_id',:'third_claim','failed','provider_retryable',true) then 1 else 0 end as assert_late_worker_cannot_overwrite_acceptance;
reset role;
update private.order_delay_notice_targets set available_at=now()-interval '1 second' where id=:'first_id';
set local role service_role;
select value->>'claimToken' as recovery_claim from jsonb_array_elements(public.claim_order_delay_email_jobs(1)) where value->>'id'=:'first_id' \gset
select 1/case when not public.bind_order_delay_email_intent(:'first_id',:'recovery_claim',:'first_intent') then 1 else 0 end as assert_attempted_recipient_change_does_not_replay;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000494101',true);
select public.admin_get_order_delay_notice('00000000-0000-4000-8000-000000494131') as recovered \gset
select 1/case when (:'recovered'::jsonb->'targets') @> '[{"emailStatus":"unknown","retryable":false,"inAppStatus":"sent"},{"emailStatus":"suppressed","retryable":false},{"emailStatus":"sent","retryable":false}]'
 then 1 else 0 end as assert_partial_results_are_preserved;
-- A fresh explicitly composed notice is a different version. Expired unknown retries remain blocked.
select public.admin_prepare_order_delay_notice('00000000-0000-4000-8000-000000494132',array['00000000-0000-4000-8000-000000494121']::uuid[],'새 일정 안내','별도로 작성한 후속 문구',null);
select public.admin_request_order_delay_notice('00000000-0000-4000-8000-000000494132');
set local role service_role;
select value->>'id' as expired_id,value->>'claimToken' as expired_claim from jsonb_array_elements(public.claim_order_delay_email_jobs(1)) \gset
select public.enqueue_email_intent('order_delay_notice',repeat('a4',32),repeat('b4',32),'order_delay_notice','order_delay_v1')->>'intentId' as expired_intent \gset
select public.bind_order_delay_email_intent(:'expired_id',:'expired_claim',:'expired_intent');
reset role;
update private.email_intents set created_at=now()-interval '2 days',state='unknown',attempt_count=1,claimed_at=now()-interval '25 hours',
 first_dispatched_at=now()-interval '25 hours',idempotency_expires_at=now()-interval '1 hour' where id=:'expired_intent';
set local role service_role;
select 1/case when public.claim_email_intent_dispatch(:'expired_intent',repeat('b4',32))->>'kind'='needs_review' then 1 else 0 end as assert_expired_provider_key_never_reused;
select public.finish_order_delay_email_job(:'expired_id',:'expired_claim','unknown','delivery_needs_review',false);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000494101',true);
select 1/case when public.admin_retry_order_delay_notice('00000000-0000-4000-8000-000000494132')->'targets' @> '[{"emailStatus":"unknown","retryable":false}]' then 1 else 0 end as assert_operator_retry_cannot_bypass_expiry;
reset role;
insert into public.order_cancellation_requests(order_id,requested_by,reason) values('00000000-0000-4000-8000-000000494111','00000000-0000-4000-8000-000000494102','합성 자료 클레임 검증');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000494101',true);
do $$begin perform public.admin_prepare_order_delay_notice('00000000-0000-4000-8000-000000494133',array['00000000-0000-4000-8000-000000494121']::uuid[],'안내','내용',null);raise exception 'active claim accepted';exception when check_violation then if sqlerrm<>'delay_notice_ineligible' then raise;end if;end$$;
rollback;
