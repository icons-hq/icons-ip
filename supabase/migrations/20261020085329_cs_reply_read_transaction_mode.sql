-- PostgREST executes STABLE RPCs in READ ONLY transactions even for POST.
-- These reads acquire the existing account/role fence (SELECT FOR SHARE), so
-- they require a VOLATILE POST transaction without changing any reply content.
alter function public.admin_cs_reply_context(text,uuid) volatile;
alter function public.admin_cs_reply_operation(uuid,uuid,text,uuid,text,bigint) volatile;
select private.register_operator_rpc_contract('public.admin_cs_reply_context(text,uuid)'::regprocedure,'cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_cs_reply_operation(uuid,uuid,text,uuid,text,bigint)'::regprocedure,'cs.manage','read',false);
notify pgrst,'reload schema';
