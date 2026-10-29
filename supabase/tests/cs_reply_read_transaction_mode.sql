\set ON_ERROR_STOP on
begin;
select 1/case when (select count(*)=2 and bool_and(provolatile='v' and prosecdef) from pg_proc where oid in
 ('public.admin_cs_reply_context(text,uuid)'::regprocedure,'public.admin_cs_reply_operation(uuid,uuid,text,uuid,text,bigint)'::regprocedure))
 and has_function_privilege('authenticated','public.admin_cs_reply_context(text,uuid)','execute')
 and has_function_privilege('authenticated','public.admin_cs_reply_operation(uuid,uuid,text,uuid,text,bigint)','execute')
 and not has_function_privilege('anon','public.admin_cs_reply_context(text,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_cs_reply_operation(uuid,uuid,text,uuid,text,bigint)','execute')
 then 1 else 0 end as postgrest_read_write_transaction_for_authority_locks;
-- PostgREST runs a declared STABLE/IMMUTABLE RPC in a READ ONLY transaction even
-- over POST, so nothing it reaches may take a row lock (the operator capability
-- guard does) or write. Follow schema-qualified calls (every RPC pins
-- search_path='') through any depth: a lock-free guard over a locking reader still
-- fails. Advisory locks are allowed read-only and are not flagged.
do $$declare problem text;begin
 with recursive reach(root,fn) as (
  select p.oid,p.oid from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature) where p.provolatile in('s','i')
  union
  select r.root,q.oid from reach r join pg_proc p on p.oid=r.fn
  cross join lateral regexp_matches(p.prosrc,'(public|private)[.]([a-z_][a-z0-9_]*)[[:space:]]*[(]','g') m
  join pg_namespace n on n.nspname=m[1] join pg_proc q on q.pronamespace=n.oid and q.proname=m[2])
 select string_agg(format('%s -> %s',root,lockers),'; ' order by root) into problem from (
  select r.root::regprocedure::text root,string_agg(distinct r.fn::regprocedure::text,', ') lockers
  from reach r join pg_proc f on f.oid=r.fn
  where f.prosrc ~* '\mfor[[:space:]]+(no[[:space:]]+key[[:space:]]+)?(update|share|key[[:space:]]+share)\M'
   or f.prosrc ~* '\m(insert[[:space:]]+into|delete[[:space:]]+from|lock[[:space:]]+table|nextval|setval)\M'
   or f.prosrc ~* '\mupdate[[:space:]]+[a-z_."]+[[:space:]]+(as[[:space:]]+[a-z_]+[[:space:]]+)?set\M'
  group by r.root) offenders;
 if problem is not null then raise exception 'STABLE operator RPC reaches a row lock or write in PostgREST READ ONLY mode: %',problem;end if;
end $$;
rollback;
