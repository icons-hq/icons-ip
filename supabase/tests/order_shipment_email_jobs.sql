\set ON_ERROR_STOP on
begin;
select 1 / case when to_regclass('public.order_shipment_email_jobs') is not null then 1 else 0 end as assert_durable_outbox;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000447081','authenticated','authenticated','shipment-job-staff@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000447082','authenticated','authenticated','shipment-job-buyer@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000447081';
insert into public.orders(id,user_id,status,total,address) values
 ('00000000-0000-4000-8000-000000447083','00000000-0000-4000-8000-000000447082','confirmed',10000,'{}');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) values
 ('00000000-0000-4000-8000-000000447084','00000000-0000-4000-8000-000000447083','00000000-0000-4000-8000-000000042201','김포',0,'{}');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000447081',true);
select public.admin_update_shipment_status('00000000-0000-4000-8000-000000447084','shipping','hanjin','4470000084');
select 1 / case when (select count(*) from public.order_shipment_email_jobs
 where shipment_id='00000000-0000-4000-8000-000000447084' and status='pending')=1 then 1 else 0 end as assert_dispatch_commits_outbox;
select 1 / case when public.admin_enqueue_shipment_emails('[{"orderId":"00000000-0000-4000-8000-000000447083","shipmentId":"00000000-0000-4000-8000-000000447084"},
 {"orderId":"00000000-0000-4000-8000-000000447083","shipmentId":"00000000-0000-4000-8000-000000447084"}]')->>'queued'='1' then 1 else 0 end as assert_bulk_dedupe;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000447082',true);
do $$ begin
 perform public.admin_enqueue_shipment_emails('[]');raise exception 'customer enqueued';
exception when insufficient_privilege then null;end $$;
select 1 / case when not exists(select 1 from public.order_shipment_email_jobs) then 1 else 0 end as assert_customer_cannot_read_jobs;
reset role;
select 1 / case when not has_table_privilege('service_role','public.order_shipment_email_jobs','UPDATE')
 and not has_function_privilege('anon','public.admin_enqueue_shipment_emails(jsonb)','EXECUTE')
 then 1 else 0 end as assert_direct_writes_sealed;
set local role service_role;
select claim_token as job_token from public.claim_shipment_email_jobs(25) \gset
select 1 / case when (select count(*) from public.claim_shipment_email_jobs(25))=0 then 1 else 0 end as assert_live_lease_not_claimed_twice;
select 1 / case when public.finish_shipment_email_job('00000000-0000-4000-8000-000000447084',
 '00000000-0000-4000-8000-000000447099','sent',null)='stale' then 1 else 0 end as assert_wrong_token_cannot_finish;
select 1 / case when public.finish_shipment_email_job('00000000-0000-4000-8000-000000447084',
 :'job_token','retry','provider_retryable')='pending' then 1 else 0 end as assert_failed_provider_is_retained;
select 1 / case when (select count(*) from public.claim_shipment_email_jobs(25))=0 then 1 else 0 end as assert_backoff_prevents_hot_loop;
reset role;
update public.order_shipment_email_jobs set available_at=now()-interval '1 second' where shipment_id='00000000-0000-4000-8000-000000447084';
set local role service_role;
select claim_token as retry_token from public.claim_shipment_email_jobs(25) \gset
select 1 / case when public.finish_shipment_email_job('00000000-0000-4000-8000-000000447084',
 :'job_token','sent',null)='stale' then 1 else 0 end as assert_old_worker_cannot_overwrite_retry;
select 1 / case when public.finish_shipment_email_job('00000000-0000-4000-8000-000000447084',
 :'retry_token','sent',null)='completed' then 1 else 0 end as assert_success_finishes_claim;
reset role;
-- A worker crash after provider acceptance is not permission to send again.
update public.order_shipment_email_jobs set status='pending',completed_at=null,available_at=now()
 where shipment_id='00000000-0000-4000-8000-000000447084';
insert into public.email_deliveries(dedupe_key,template,recipient,subject,status,claimed_at)
values('order_shipped:00000000-0000-4000-8000-000000447083:00000000-0000-4000-8000-000000447084',
 'order_shipped','synthetic@example.test','synthetic','pending',now()-interval '20 minutes');
set local role service_role;
select delivery_state as uncertain_state,claim_token as uncertain_token from public.claim_shipment_email_jobs(25) \gset
select 1 / case when :'uncertain_state'='unknown' then 1 else 0 end as assert_stale_delivery_evidence_not_retried;
select public.finish_shipment_email_job('00000000-0000-4000-8000-000000447084',:'uncertain_token','review','delivery_outcome_unknown');
reset role;
-- Bulk imports persist 1000 IDs, but a worker can claim only its bounded batch.
insert into public.orders(id,user_id,status,total,address)
select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000447082','shipping',10000,'{}' from generate_series(1,1000)n;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status)
select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000042201','김포',0,'{}','shipping' from generate_series(1,1000)n;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000447081',true);
select 1 / case when public.admin_enqueue_shipment_emails((select jsonb_agg(jsonb_build_object('orderId',order_id,'shipmentId',id))
 from public.order_shipments where id::text like '30000000-%'))->>'queued'='1000' then 1 else 0 end as assert_thousand_is_durable;
do $$ begin
 perform public.admin_enqueue_shipment_emails('[{"orderId":"00000000-0000-4000-8000-000000447083","shipmentId":"30000000-0000-4000-8000-000000000001"}]');
 raise exception 'foreign order shipment accepted';
exception when check_violation then if sqlerrm<>'shipment_email_unavailable' then raise;end if;end $$;
do $$ begin
 perform public.admin_enqueue_shipment_emails((select jsonb_agg(jsonb_build_object('orderId','00000000-0000-4000-8000-000000447083',
 'shipmentId','00000000-0000-4000-8000-000000447084')) from generate_series(1,1001)));
 raise exception 'unbounded bulk accepted';
exception when invalid_parameter_value then null;end $$;
reset role;
set local role service_role;
select 1 / case when (select count(*) from public.claim_shipment_email_jobs(25))=25 then 1 else 0 end as assert_claim_batch_bounded;
do $$ begin perform public.claim_shipment_email_jobs(26);raise exception 'unbounded claim accepted';
exception when invalid_parameter_value then null;end $$;
reset role;
update public.order_shipment_email_jobs set attempts=8,lease_until=now()-interval '1 second' where status='processing';
set local role service_role;
select 1 / case when (select count(*) from public.claim_shipment_email_jobs(25))=25 then 1 else 0 end as assert_exhausted_leases_do_not_block_backlog;
reset role;
select 1 / case when (select count(*) from public.order_shipment_email_jobs where status='review' and last_error_code='lease_exhausted')=25
 and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='order_shipment_email_jobs'
  and column_name in ('recipient','email','address','body','subject','tracking_number'))
 and not has_function_privilege('authenticated','public.claim_shipment_email_jobs(integer)','EXECUTE')
 and not has_function_privilege('authenticated','public.finish_shipment_email_job(uuid,uuid,text,text)','EXECUTE')
 then 1 else 0 end as assert_exhaustion_visible_and_worker_private;
rollback;
