-- Keep the existing authenticated writer contract: a missing principal is an
-- authentication error; a present principal without authority is a denial.
create or replace function private.require_operator_capability(p_capability text,p_legacy_admin_only boolean default false)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());
begin
  if actor is null then raise invalid_authorization_specification using message='auth_required';end if;
  return private.require_actor_operator_capability(actor,p_capability,p_legacy_admin_only);
end $$;
revoke all on function private.require_operator_capability(text,boolean) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.require_operator_capability(text,boolean)'::regprocedure);
