-- Align the review helpful admin reader with its existing admin reader owner.
-- No private helper/table ACL or owner changes. Existing migration 344 is immutable.
-- Canonical deparsing must retain schema names of composite argument types.
set local search_path='';
do $review_helpful_owner_fix$
declare
 target regprocedure:='public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)'::regprocedure;
 predecessor regprocedure:='public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)'::regprocedure;
 expected_owner oid;current_owner oid;entry record;
begin
 for entry in select * from (values
  (predecessor::oid,'3458f0cc7ade2faa75c56d858e02408bcb5b9ff3488cb348dc158abdfddb8d30'),
  (target::oid,'3332292f02cb0e561035047fbd3cc891a5a2609ff9f910e795046bff4f306ea4'),
  ('private.review_best_state(public.reviews)'::regprocedure::oid,'6d4fa29aeda555a3faa49b83cf7557e2735270395401931369cd73ac97315c87'),
  ('private.review_best_problem(public.reviews)'::regprocedure::oid,'b1b3c33e3701f035e53c615b536e2bef6edf6a3eeb2695cf632e90dd8ff00129')
 ) expected(function_oid,source_sha) loop
  if encode(extensions.digest(convert_to(pg_get_functiondef(entry.function_oid),'UTF8'),'sha256'),'hex')<>entry.source_sha then
   raise exception 'review_helpful_owner_source_contract_changed: %',entry.function_oid::regprocedure;end if;
 end loop;
 select proowner into expected_owner from pg_proc where oid=predecessor;
 select proowner into current_owner from pg_proc where oid=target;
 if current_owner not in ('postgres'::regrole::oid,expected_owner)
  or not has_function_privilege('authenticated',target,'EXECUTE')
  or not has_function_privilege('postgres',target,'EXECUTE')
  or has_function_privilege('anon',target,'EXECUTE')
  or has_function_privilege('service_role',target,'EXECUTE')
  or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=target and (a.grantee=0 or a.grantee not in(p.proowner,'postgres'::regrole::oid,'authenticated'::regrole::oid))) then
  raise exception 'review_helpful_owner_unexpected_acl';end if;
 if not has_function_privilege(expected_owner,'private.review_best_state(public.reviews)'::regprocedure,'EXECUTE')
  or not has_function_privilege(expected_owner,'private.review_best_problem(public.reviews)'::regprocedure,'EXECUTE')
  or not has_table_privilege(expected_owner,'private.review_helpful_votes'::regclass,'SELECT') then
  raise exception 'review_helpful_predecessor_owner_cannot_read_dependencies';end if;
 if current_owner<>expected_owner then
  execute format('alter function %s owner to %I',target,pg_get_userbyid(expected_owner));
  -- ALTER OWNER rewrites the former owner ACL entry. Keep the explicitly
  -- supported postgres execution role as well as the retained authenticated role.
  execute format('grant execute on function %s to postgres',target);
  perform private.register_operator_internal_contract(target);
 end if;
 if (select proowner from pg_proc where oid=target)<>expected_owner
  or not has_function_privilege('authenticated',target,'EXECUTE')
  or not has_function_privilege('postgres',target,'EXECUTE')
  or has_function_privilege('anon',target,'EXECUTE')
  or has_function_privilege('service_role',target,'EXECUTE') then
  raise exception 'review_helpful_owner_postcondition_failed';end if;
end $review_helpful_owner_fix$;
notify pgrst,'reload schema';
