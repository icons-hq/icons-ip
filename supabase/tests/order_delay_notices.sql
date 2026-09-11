\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000494001','authenticated','authenticated','delay-staff@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000494002','authenticated','authenticated','delay-buyer@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000494003','authenticated','authenticated','delay-other@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000494001';
-- Synthetic transaction only: no #191 readiness or global gate is changed.
update private.order_delay_notice_delivery_control set enabled=true where singleton;
insert into public.orders(id,user_id,status,total,address,confirmed_at) values
 ('00000000-0000-4000-8000-000000494011','00000000-0000-4000-8000-000000494002','confirmed',10000,'{"recipientName":"구매자가 아닌 수취인"}',now()-interval '5 days'),
 ('00000000-0000-4000-8000-000000494012','00000000-0000-4000-8000-000000494002','shipping',20000,'{}',now()-interval '5 days'),
 ('00000000-0000-4000-8000-000000494013','00000000-0000-4000-8000-000000494003','pending',30000,'{}',null);
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status) values
 ('00000000-0000-4000-8000-000000494021','00000000-0000-4000-8000-000000494011','00000000-0000-4000-8000-000000042201','김포',0,'{}','ready'),
 ('00000000-0000-4000-8000-000000494022','00000000-0000-4000-8000-000000494011','00000000-0000-4000-8000-000000042202','남양주',0,'{}','ready'),
 ('00000000-0000-4000-8000-000000494023','00000000-0000-4000-8000-000000494012','00000000-0000-4000-8000-000000042201','김포',0,'{}','ready'),
 ('00000000-0000-4000-8000-000000494024','00000000-0000-4000-8000-000000494012','00000000-0000-4000-8000-000000042202','남양주',0,'{}','shipping'),
 ('00000000-0000-4000-8000-000000494025','00000000-0000-4000-8000-000000494013','00000000-0000-4000-8000-000000042201','김포',0,'{}','ready');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000494001',true);
select public.admin_upsert_order_dispatch_delay('00000000-0000-4000-8000-000000494011','외부 노출 금지 내부 메모',null);
select public.admin_prepare_order_delay_notice('00000000-0000-4000-8000-000000494031',
 array['00000000-0000-4000-8000-000000494021','00000000-0000-4000-8000-000000494022','00000000-0000-4000-8000-000000494023']::uuid[],
 '발송 지연 안내','확인되는 대로 다시 안내드리겠습니다.',null) as prepared \gset
select 1/case when jsonb_array_length(:'prepared'::jsonb->'targets')=2
 and :'prepared' not like '%외부 노출 금지%'
 and :'prepared' like '%delay-buyer@example.test%'
 and :'prepared' like '%확인 중%' then 1 else 0 end as assert_order_scoped_customer_copy;
select public.admin_request_order_delay_notice('00000000-0000-4000-8000-000000494031') as requested \gset
select public.admin_request_order_delay_notice('00000000-0000-4000-8000-000000494031') as replayed \gset
select 1/case when :'requested'=:'replayed'
 and (:'requested'::jsonb->'targets'->0->>'inAppStatus')='sent'
 and (:'requested'::jsonb->'targets'->0->>'emailStatus')='queued' then 1 else 0 end as assert_atomic_request_and_replay;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000494002',true);
select 1/case when (select count(*) from public.notifications where source_type='order_delay_notice')=2
 and not exists(select 1 from public.notifications where source_type='order_delay_notice' and body like '%내부 메모%') then 1 else 0 end as assert_actual_buyer_inbox_only;
do $$begin perform public.admin_get_order_delay_notice('00000000-0000-4000-8000-000000494031');raise exception 'customer accessed admin notice';exception when insufficient_privilege then null;end$$;
reset role;
select 1/case when not has_table_privilege('authenticated','private.order_delay_notice_targets','SELECT')
 and not has_table_privilege('service_role','private.order_delay_notice_targets','UPDATE')
 and not has_function_privilege('anon','public.admin_request_order_delay_notice(uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.claim_order_delay_email_jobs(integer)','EXECUTE') then 1 else 0 end as assert_private_and_minimal_grants;
set local role service_role;
select value->>'id' as job_id,value->>'claimToken' as job_claim from jsonb_array_elements(public.claim_order_delay_email_jobs(1)) \gset
select 1/case when jsonb_array_length(public.claim_order_delay_email_jobs(25))=1 then 1 else 0 end as assert_lease_not_claimed_twice;
select 1/case when public.finish_order_delay_email_job(:'job_id','00000000-0000-4000-8000-000000494099','sent',null,false)=false then 1 else 0 end as assert_wrong_worker_rejected;
select public.finish_order_delay_email_job(:'job_id',:'job_claim','failed','provider_not_configured',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000494001',true);
select public.admin_retry_order_delay_notice('00000000-0000-4000-8000-000000494031');
select 1/case when public.admin_get_order_delay_notice('00000000-0000-4000-8000-000000494031')->'targets' @> '[{"emailStatus":"queued","inAppStatus":"sent"}]' then 1 else 0 end as assert_only_failed_email_requeued;
-- Preview and submit are distinct; recipient changes invalidate the whole submitted batch.
select public.admin_prepare_order_delay_notice('00000000-0000-4000-8000-000000494032',array['00000000-0000-4000-8000-000000494021']::uuid[],'별도 안내','고객에게 입력한 내용',null);
reset role;
update public.profiles set email='changed@example.test' where id='00000000-0000-4000-8000-000000494002';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000494001',true);
do $$begin perform public.admin_request_order_delay_notice('00000000-0000-4000-8000-000000494032');raise exception 'stale recipient sent';exception when check_violation then if sqlerrm<>'delay_notice_stale' then raise;end if;end$$;
do $$begin perform public.admin_prepare_order_delay_notice('00000000-0000-4000-8000-000000494033',array['00000000-0000-4000-8000-000000494025']::uuid[],'입금 대기','잘못된 주문',null);raise exception 'pending order accepted';exception when check_violation then if sqlerrm<>'delay_notice_ineligible' then raise;end if;end$$;
do $$begin perform public.admin_prepare_order_delay_notice('00000000-0000-4000-8000-000000494033',array['00000000-0000-4000-8000-000000494024']::uuid[],'출고 완료','잘못된 배송 건',null);raise exception 'shipped target accepted';exception when check_violation then if sqlerrm<>'delay_notice_ineligible' then raise;end if;end$$;
reset role;
select 1/case when (select status from public.orders where id='00000000-0000-4000-8000-000000494012')='shipping'
 and (select total from public.orders where id='00000000-0000-4000-8000-000000494013')=30000 then 1 else 0 end as assert_order_money_state_unchanged;
rollback;
