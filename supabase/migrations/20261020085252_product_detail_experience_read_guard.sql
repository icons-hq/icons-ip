-- PostgREST runs STABLE RPCs in a read-only transaction. Reads inspect current
-- authority without row locks; mutating RPCs keep the actor-lock guard.
create or replace function public.admin_get_product_detail_experiences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.has_operator_capability(auth.uid(),'store.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';end if;
 select jsonb_build_object('values',jsonb_object_agg(section,values),'revisions',jsonb_object_agg(section,revision)) into result
 from private.product_detail_experience_settings;
 return result;
end $$;
revoke all on function public.admin_get_product_detail_experiences() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_product_detail_experiences() to authenticated;
select private.register_operator_rpc_contract('public.admin_get_product_detail_experiences()','store.manage','read',false);
notify pgrst,'reload schema';
