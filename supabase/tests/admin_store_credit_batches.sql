\set ON_ERROR_STOP on
begin;
-- Synthetic amounts and accounts only; this whole contract test rolls back.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('00000000-0000-4000-8000-00000006230'||n)::uuid,'authenticated','authenticated','batch-'||n||'@example.test','{}','{}',now(),now() from generate_series(1,6) n;
update public.profiles set email='batch-'||right(id::text,1)||'@example.test',nickname='batch_'||right(id::text,1),role=case when right(id::text,1) in ('1','6') then 'admin'::public.user_role when right(id::text,1)='2' then 'staff'::public.user_role else 'user'::public.user_role end
where id::text like '00000000-0000-4000-8000-00000006230%';
update public.profiles set suspended_at=now(),suspension_reason='합성 제한' where id='00000000-0000-4000-8000-000000062305';
update private.store_credit_policy set enabled=true,earn_kind='fixed',earn_value=0,earn_max_per_order=0,max_balance=100000,validity_days=30,min_use=1,max_use=100000,restore_grace_days=3,refund_earned_credit_mode='offset_future_credits',evidence='합성 검증 정책';
insert into private.store_credit_lots(id,user_id,root_lot_id,source_kind,issued_amount,available_amount,spent_amount,debt_amount,expires_at) values
 ('71000000-0000-4000-8000-000000062301','00000000-0000-4000-8000-000000062303','71000000-0000-4000-8000-000000062301','admin',100,100,0,0,now()-interval '1 day'),
 ('71000000-0000-4000-8000-000000062302','00000000-0000-4000-8000-000000062303','71000000-0000-4000-8000-000000062302','admin',500,0,500,300,now()+interval '2 days');
select (now()+interval '7 days')::text as expiry \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000062301',true);
select 1/case when jsonb_array_length(public.admin_find_store_credit_customers('batch_'))=6 and public.admin_find_store_credit_customers('batch-3@example.test')#>>'{0,maskedEmail}'='b***@example.test' then 1 else 0 end as bounded_masked_customer_search;
select 1/case when public.admin_preview_store_credit_batch('72000000-0000-4000-8000-000000062301',array['batch-3@example.test','00000000-0000-4000-8000-000000062303','missing@example.test','batch-5@example.test'],1000,:'expiry','합성 검증','promotion')->>'invalidCount'='3' then 1 else 0 end as rejects_duplicate_identity_missing_and_suspended;
select public.admin_preview_store_credit_batch('72000000-0000-4000-8000-000000062302',array['batch-3@example.test','batch-4@example.test'],1000,:'expiry','합성 지급','promotion');
select 1/case when public.admin_get_store_credit_batch('72000000-0000-4000-8000-000000062302')->>'gross'='2000'
 and public.admin_get_store_credit_batch('72000000-0000-4000-8000-000000062302')->>'offset'='300'
 and public.admin_get_store_credit_batch('72000000-0000-4000-8000-000000062302')->>'net'='1700' then 1 else 0 end as gross_offset_and_available_are_distinct;
reset role;
select 1/case when (select available_amount from private.store_credit_lots where id='71000000-0000-4000-8000-000000062301')=100
 and (select count(*) from public.store_credit_ledger where user_id='00000000-0000-4000-8000-000000062303')=0
 then 1 else 0 end as preview_does_not_write_expiry_or_ledger;
set local role authenticated;
select 1/case when public.admin_execute_store_credit_batch('72000000-0000-4000-8000-000000062302')->>'status'='completed'
 and public.admin_execute_store_credit_batch('72000000-0000-4000-8000-000000062302')->>'completedCount'='2' then 1 else 0 end as execute_and_replay_complete;
select 1/case when public.admin_get_store_credit_history('00000000-0000-4000-8000-000000062303')->>'available'='700'
 and public.admin_get_store_credit_history('00000000-0000-4000-8000-000000062304')->>'available'='1000'
 and public.admin_search_store_credit_console(p_query:='합성 지급')->>'total'='1'
 and public.admin_search_store_credit_console(p_mode:='ledger',p_query:='72000000-0000-4000-8000-000000062302',p_kind:='adjustment_credit')->>'total'='2'
 then 1 else 0 end as balances_and_history_do_not_double_count_children;
select 1/case when public.admin_export_store_credit_console('ledger','72000000-0000-4000-8000-000000062302',null,null,'adjustment_credit')->>'total'='2'
 then 1 else 0 end as export_uses_exact_search_conditions;
do $$begin
 begin perform public.admin_preview_store_credit_batch('72000000-0000-4000-8000-000000062302',array['batch-3@example.test'],10,now()+interval '2 days','내용 변경','general');raise exception 'changed replay accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.admin_preview_store_credit_batch('72000000-0000-4000-8000-000000062309',array_fill('batch-3@example.test'::text,array[1001]),10,now()+interval '2 days','초과 대상','general');raise exception '1001 targets accepted';exception when invalid_parameter_value then null;end;
 begin perform public.admin_search_store_credit_console(p_page_size:=null);raise exception 'unbounded null page accepted';exception when invalid_parameter_value then null;end;
end$$;
select public.admin_preview_store_credit_batch('72000000-0000-4000-8000-000000062303',array['batch-3@example.test','batch-4@example.test'],1000,:'expiry','충돌 시 전액 롤백','general');
select public.admin_adjust_store_credit('73000000-0000-4000-8000-000000062301','00000000-0000-4000-8000-000000062304',1,:'expiry','다른 작업',1000);
select 1/case when public.admin_execute_store_credit_batch('72000000-0000-4000-8000-000000062303')->>'status'='failed'
 and public.admin_execute_store_credit_batch('72000000-0000-4000-8000-000000062303')->>'completedCount'='0'
 and public.admin_get_store_credit_history('00000000-0000-4000-8000-000000062303')->>'available'='700'
 and public.admin_get_store_credit_history('00000000-0000-4000-8000-000000062304')->>'available'='1001'
 then 1 else 0 end as balance_conflict_rolls_back_every_grant_and_replays_failure;
select public.admin_preview_store_credit_batch('72000000-0000-4000-8000-000000062304',array['batch-3@example.test'],1000,:'expiry','정책 충돌','general');
reset role;
update private.store_credit_policy set version=version+1;
set local role authenticated;
select 1/case when public.admin_execute_store_credit_batch('72000000-0000-4000-8000-000000062304')->>'error'='store_credit_preview_stale' then 1 else 0 end as policy_version_conflict;
select public.admin_preview_store_credit_batch('72000000-0000-4000-8000-000000062305',array['batch-3@example.test'],1000,:'expiry','만료 확인','general');
reset role;
update private.store_credit_batches set created_at=now()-interval '16 minutes' where id='72000000-0000-4000-8000-000000062305';
set local role authenticated;
select 1/case when public.admin_execute_store_credit_batch('72000000-0000-4000-8000-000000062305')->>'error'='store_credit_preview_stale' then 1 else 0 end as stale_preview_rejected;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000062306',true);
do $$begin begin perform public.admin_execute_store_credit_batch('72000000-0000-4000-8000-000000062302');raise exception 'another admin executes';exception when insufficient_privilege then null;end;end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000062302',true);
do $$begin
 begin perform public.admin_find_store_credit_customers('batch');raise exception 'staff searches';exception when insufficient_privilege then null;end;
 begin perform public.admin_preview_store_credit_batch('72000000-0000-4000-8000-000000062309',array['batch-3@example.test'],10,now()+interval '2 days','스태프 거절','general');raise exception 'staff previews';exception when insufficient_privilege then null;end;
 begin perform public.admin_execute_store_credit_batch('72000000-0000-4000-8000-000000062302');raise exception 'staff executes';exception when insufficient_privilege then null;end;
 begin perform public.admin_get_store_credit_batch('72000000-0000-4000-8000-000000062302');raise exception 'staff reads';exception when insufficient_privilege then null;end;
 begin perform public.admin_search_store_credit_console();raise exception 'staff sees ledger';exception when insufficient_privilege then null;end;
 begin perform public.admin_export_store_credit_console('ledger');raise exception 'staff exports ledger';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 1/case when (select count(*) from public.audit_log where action='admin.store_credit.batch_completed' and target='store_credit_batch:72000000-0000-4000-8000-000000062302')=1
 and (select count(*) from public.audit_log where action='admin.store_credit.batch_failed' and target='store_credit_batch:72000000-0000-4000-8000-000000062303')=1
 and not has_table_privilege('authenticated','private.store_credit_batches','select')
 and not has_table_privilege('service_role','private.store_credit_batch_recipients','insert')
 and (select count(*) from public.audit_log where action='admin.store_credit.exported' and actor_id='00000000-0000-4000-8000-000000062301')=1
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in('admin_find_store_credit_customers','admin_preview_store_credit_batch','admin_execute_store_credit_batch','admin_get_store_credit_batch','admin_search_store_credit_console','admin_export_store_credit_console','store_credit_preview_balance')
 and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or(n.nspname='private' and has_function_privilege('authenticated',p.oid,'execute'))))
 then 1 else 0 end as exactly_once_audit_and_sealed_privileges;
insert into public.store_credit_ledger(user_id,kind,amount,reason)
select '00000000-0000-4000-8000-000000062303','adjustment_credit',1,'합성 export limit only' from generate_series(1,10001);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000062301',true);
do $$begin
 begin perform public.admin_export_store_credit_console('ledger','합성 export limit only');raise exception 'truncated large export accepted';
 exception when check_violation then if sqlerrm<>'store_credit_export_limit' then raise;end if;end;
end$$;
reset role;
select 1/case when (select count(*) from public.audit_log where action='admin.store_credit.exported' and actor_id='00000000-0000-4000-8000-000000062301')=1 then 1 else 0 end as rejected_export_does_not_record_success;
-- Exercise the real 1,000-customer limit, not only a parser boundary.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select md5('credit-batch-fixture-'||n)::uuid,'authenticated','authenticated','batch-limit-'||n||'@example.test','{}','{}',now(),now() from generate_series(1,1000) n;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000062301',true);
set local role authenticated;
select 1/case when public.admin_preview_store_credit_batch('72000000-0000-4000-8000-000000062308',array(select md5('credit-batch-fixture-'||n)::uuid::text from generate_series(1,1000) n),1,:'expiry','1,000명 경계','general')->>'count'='1000'
 and public.admin_execute_store_credit_batch('72000000-0000-4000-8000-000000062308')->>'completedCount'='1000'
 then 1 else 0 end as thousand_recipients_atomic_grant;
rollback;
