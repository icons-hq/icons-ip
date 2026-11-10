begin;
-- PostgREST runs STABLE RPCs in a read-only transaction. The read capability
-- predicate rechecks current access without the mutation guard's row locks.
do $$declare source text; anchor text:='perform private.require_operator_capability(''stats.read'',false);';
begin
 source:=pg_get_functiondef('public.admin_customer_demographic_report(text,text,date,date)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'customer_demographic_guard_source_changed'; end if;
 execute replace(source,anchor,'if not public.has_operator_capability(''stats.read'',false) then raise insufficient_privilege using message=''operator_capability_required''; end if;');
end $$;
select private.register_operator_rpc_contract('public.admin_customer_demographic_report(text,text,date,date)'::regprocedure,'stats.read','read',false);
commit;
