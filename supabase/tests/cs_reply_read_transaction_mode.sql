\set ON_ERROR_STOP on
begin;
select 1/case when (select count(*)=2 and bool_and(provolatile='v' and prosecdef) from pg_proc where oid in
 ('public.admin_cs_reply_context(text,uuid)'::regprocedure,'public.admin_cs_reply_operation(uuid,uuid,text,uuid,text,bigint)'::regprocedure))
 and has_function_privilege('authenticated','public.admin_cs_reply_context(text,uuid)','execute')
 and has_function_privilege('authenticated','public.admin_cs_reply_operation(uuid,uuid,text,uuid,text,bigint)','execute')
 and not has_function_privilege('anon','public.admin_cs_reply_context(text,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_cs_reply_operation(uuid,uuid,text,uuid,text,bigint)','execute')
 then 1 else 0 end as postgrest_read_write_transaction_for_authority_locks;
-- A declared STABLE/IMMUTABLE RPC cannot acquire an account/role row fence in
-- PostgREST's READ ONLY mode. Keep this narrow to the cs.manage contract.
select 1/case when not exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
 where c.capability='cs.manage' and p.provolatile in('s','i') and p.prosrc ~ 'private\.(require_operator_capability|require_actor_operator_capability|lock_operator_subjects|lock_account_action_subject)')
 then 1 else 0 end as no_stable_cs_rpc_with_authority_row_locks;
rollback;
