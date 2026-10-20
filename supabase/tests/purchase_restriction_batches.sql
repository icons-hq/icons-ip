\set ON_ERROR_STOP on
begin;
create function pg_temp.restriction_batch_user(n integer) returns uuid language sql immutable as $$ select md5('restriction-batch-customer:'||n)::uuid $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.restriction_batch_user(n),'authenticated','authenticated','restriction-batch-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,110)n;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000063501','authenticated','authenticated','restriction-batch-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000063502','authenticated','authenticated','restriction-batch-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id in ('00000000-0000-4000-8000-000000063501','00000000-0000-4000-8000-000000063502');
insert into public.orders(id,user_id,status,total,address) values
 ('00000000-0000-4000-8000-000000063550',pg_temp.restriction_batch_user(4),'pending',1000,'{}'),
 ('00000000-0000-4000-8000-000000063551',pg_temp.restriction_batch_user(107),'pending',1000,'{}'),
 ('00000000-0000-4000-8000-000000063552',pg_temp.restriction_batch_user(107),'pending',2000,'{}');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063501',true);
select public.admin_register_purchase_restriction('00000000-0000-4000-8000-000000063511',pg_temp.restriction_batch_user(3),'other','기존 제한 근거');
select public.admin_preview_purchase_restriction_batch('00000000-0000-4000-8000-000000063521','customer',array[
 'restriction-batch-1@example.test',pg_temp.restriction_batch_user(1)::text,'restriction-batch-2@example.test','restriction-batch-3@example.test',
 '잘못된 식별자','missing-batch@example.test','restriction-batch-staff@example.test','restriction-batch-4@example.test'], 'business_interference','동일 운영 근거') as preview \gset
select 1/case when :'preview'::jsonb->>'readyCount'='3' and :'preview'::jsonb->'rows'->1->>'status'='duplicate'
 and :'preview'::jsonb->'rows'->1->>'duplicateOf'='1' and :'preview'::jsonb->'rows'->3->>'status'='already_active'
 and :'preview'::jsonb->'rows'->4->>'status'='invalid_input' and :'preview'::jsonb->'rows'->5->>'status'='not_found'
 and :'preview'::jsonb->'rows'->6->>'status'='not_eligible' then 1 else 0 end as preview_classifies_every_row;
reset role;
select 1/case when (select count(*) from public.goods_purchase_restrictions where user_id in(select pg_temp.restriction_batch_user(n) from generate_series(1,110)n))=1
 then 1 else 0 end as preview_does_not_register;
-- Recheck each customer when executing: one became restricted, another became staff.
update public.profiles set role='staff' where id=pg_temp.restriction_batch_user(1);
set local role authenticated;
select public.admin_register_purchase_restriction('00000000-0000-4000-8000-000000063512',pg_temp.restriction_batch_user(2),'other','다른 요청의 제한');
select public.admin_execute_purchase_restriction_batch('00000000-0000-4000-8000-000000063521',true) as result \gset
select 1/case when :'result'::jsonb->>'registeredCount'='1' and :'result'::jsonb->>'skippedCount'='6' and :'result'::jsonb->>'failedCount'='1'
 and :'result'::jsonb->'rows'->0->>'outcome'='failed' and :'result'::jsonb->'rows'->2->>'error'='already_active'
 and :'result'::jsonb->'rows'->7->>'outcome'='registered' then 1 else 0 end as partial_results_preserve_expected_failures;
select 1/case when public.admin_execute_purchase_restriction_batch('00000000-0000-4000-8000-000000063521',true)=:'result'::jsonb
 and public.admin_get_purchase_restriction_batch('00000000-0000-4000-8000-000000063521')=:'result'::jsonb then 1 else 0 end as same_request_replay_and_readback;
reset role;
select 1/case when (select count(*) from public.audit_log where action='admin.purchase_restriction.batch_completed' and target='purchase_restriction_batch:00000000-0000-4000-8000-000000063521')=1
 and (select count(*) from public.goods_purchase_restrictions where user_id=pg_temp.restriction_batch_user(4))=1
 and (select reason_detail from public.goods_purchase_restrictions where user_id=pg_temp.restriction_batch_user(2) and released_at is null)='다른 요청의 제한'
 then 1 else 0 end as no_duplicate_registration_or_overwritten_reason;
update public.orders set address='{"test":"existing order remains editable"}' where id='00000000-0000-4000-8000-000000063550';
select 1/case when (select status='pending' and total=1000 from public.orders where id='00000000-0000-4000-8000-000000063550') then 1 else 0 end as existing_order_is_not_canceled;
do $$begin
 begin insert into public.orders(user_id,total) values(pg_temp.restriction_batch_user(4),1000);raise exception 'new order accepted';exception when check_violation then
  if sqlerrm<>'goods_purchase_restricted' then raise;end if;end;
end$$;
set local role authenticated;
select public.admin_release_purchase_restriction((:'result'::jsonb->'rows'->7->>'restrictionId')::uuid,'합성 해제 근거');
select public.admin_execute_purchase_restriction_batch('00000000-0000-4000-8000-000000063521',true) as released_replay \gset
select 1/case when :'released_replay'::jsonb->>'registeredCount'='1' and :'released_replay'::jsonb->'rows'->7->>'currentState'='released'
 and :'released_replay'::jsonb->'rows'->7->>'releasedAt' is not null then 1 else 0 end as replay_does_not_restrict_released_customer;
select public.admin_preview_purchase_restriction_batch('00000000-0000-4000-8000-000000063522','order',array[
 '00000000-0000-4000-8000-000000063551','00000000-0000-4000-8000-000000063552','00000000-0000-4000-8000-000000063551'], 'repeated_purchase','반복 주문 근거') as order_preview \gset
select 1/case when :'order_preview'::jsonb->>'readyCount'='1' and :'order_preview'::jsonb->'rows'->0->>'evidenceOrderId'='00000000-0000-4000-8000-000000063551'
 and :'order_preview'::jsonb->'rows'->1->>'status'='duplicate' and :'order_preview'::jsonb->'rows'->2->>'duplicateOf'='1' then 1 else 0 end as order_lookup_keeps_evidence_and_deduplicates_customer;
select public.admin_execute_purchase_restriction_batch('00000000-0000-4000-8000-000000063522',true);
select public.admin_preview_purchase_restriction_batch('00000000-0000-4000-8000-000000063523','customer',
 (select array_agg('restriction-batch-'||n||'@example.test' order by n) from generate_series(5,104)n),'other','100명 일괄 등록') as hundred_preview \gset
select 1/case when :'hundred_preview'::jsonb->>'readyCount'='100' then 1 else 0 end as hundred_targets_preview;
select public.admin_execute_purchase_restriction_batch('00000000-0000-4000-8000-000000063523',true) as hundred_result \gset
select 1/case when :'hundred_result'::jsonb->>'registeredCount'='100' and :'hundred_result'::jsonb->>'failedCount'='0' then 1 else 0 end as hundred_targets_registered;
do $$begin
 begin perform public.admin_preview_purchase_restriction_batch('00000000-0000-4000-8000-000000063529','customer',
 (select array_agg('restriction-batch-'||n||'@example.test') from generate_series(1,101)n),'other','상한 초과');raise exception '101 inputs accepted';exception when invalid_parameter_value then null;end;
 begin perform public.admin_preview_purchase_restriction_batch('00000000-0000-4000-8000-000000063521','customer',array['restriction-batch-1@example.test'],'other','변경 입력');raise exception 'changed idempotency payload accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.admin_execute_purchase_restriction_batch('00000000-0000-4000-8000-000000063523',false);raise exception 'missing confirmation accepted';exception when invalid_parameter_value then null;end;
end$$;
select public.admin_preview_purchase_restriction_batch('00000000-0000-4000-8000-000000063524','customer',array['restriction-batch-108@example.test'],'other','만료 검증');
reset role;
update private.purchase_restriction_batches set created_at=clock_timestamp()-interval '16 minutes' where id='00000000-0000-4000-8000-000000063524';
set local role authenticated;
do $$begin
 begin perform public.admin_execute_purchase_restriction_batch('00000000-0000-4000-8000-000000063524',true);raise exception 'expired preview accepted';exception when sqlstate 'PT409' then null;end;
end$$;
select 1/case when public.admin_get_purchase_restriction_batch('00000000-0000-4000-8000-000000063524')->>'status'='expired' then 1 else 0 end as expiry_visible_in_readback;
-- An unexpected exception must not commit a prefix of the ready targets.
select public.admin_preview_purchase_restriction_batch('00000000-0000-4000-8000-000000063525','customer',array['restriction-batch-105@example.test','restriction-batch-106@example.test'],'other','예외 전체 롤백 검증');
reset role;
create function pg_temp.fail_unexpected_restriction() returns trigger language plpgsql as $$begin
 if new.user_id=pg_temp.restriction_batch_user(106) then raise exception 'forced_unexpected_batch_failure';end if;return new;end$$;
create trigger restriction_batch_test_failure before insert on public.goods_purchase_restrictions for each row execute function pg_temp.fail_unexpected_restriction();
set local role authenticated;
do $$begin
 begin perform public.admin_execute_purchase_restriction_batch('00000000-0000-4000-8000-000000063525',true);raise exception 'unexpected exception swallowed';exception when raise_exception then
  if sqlerrm<>'forced_unexpected_batch_failure' then raise;end if;end;
end$$;
reset role;
drop trigger restriction_batch_test_failure on public.goods_purchase_restrictions;
select 1/case when not exists(select 1 from public.goods_purchase_restrictions where user_id in(pg_temp.restriction_batch_user(105),pg_temp.restriction_batch_user(106)))
 and (select result is null from private.purchase_restriction_batches where id='00000000-0000-4000-8000-000000063525')
 then 1 else 0 end as unexpected_error_rolls_back_all_new_restrictions;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063502',true);
do $$begin
 begin perform public.admin_execute_purchase_restriction_batch('00000000-0000-4000-8000-000000063525',true);raise exception 'different actor executed';exception when insufficient_privilege then null;end;
end$$;
select 1/case when public.admin_get_purchase_restriction_batch('00000000-0000-4000-8000-000000063525')->>'canExecute'='false' then 1 else 0 end as other_operator_readonly;
select set_config('request.jwt.claim.sub',pg_temp.restriction_batch_user(110)::text,true);
do $$begin
 begin perform public.admin_get_purchase_restriction_batch('00000000-0000-4000-8000-000000063521');raise exception 'member reads batch';exception when insufficient_privilege then null;end;
 begin perform public.admin_preview_purchase_restriction_batch('00000000-0000-4000-8000-000000063529','customer',array['restriction-batch-1@example.test'],'other','무권한');raise exception 'member previews';exception when insufficient_privilege then null;end;
 begin perform public.admin_execute_purchase_restriction_batch('00000000-0000-4000-8000-000000063521',true);raise exception 'member executes';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 1/case when not has_table_privilege('authenticated','private.purchase_restriction_batches','select')
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in('admin_get_purchase_restriction_batch','admin_preview_purchase_restriction_batch','admin_execute_purchase_restriction_batch')
 and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or not has_function_privilege('authenticated',p.oid,'execute')))
 then 1 else 0 end as private_storage_and_rpc_grants;
rollback;
