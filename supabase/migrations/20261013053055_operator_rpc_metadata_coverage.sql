-- RPC authorization receipts cover execution metadata as well as body text.
-- Register after final owner/ACL/attributes are set, including future migrations.
create or replace function private.register_operator_rpc_contract(p_function regprocedure,p_capability text,p_guard_kind text,p_legacy_admin_only boolean default false)
returns void language plpgsql volatile security definer set search_path='' as $$
declare function_name text;function_body text;
begin
  select p.oid::regprocedure::text,p.prosrc into function_name,function_body from pg_proc p where p.oid=p_function::oid;
  if not found then raise undefined_function using message='operator_rpc_contract_function_missing';end if;
  insert into private.operator_rpc_contracts(signature,capability,guard_kind,legacy_admin_only,body_md5)
  values(function_name,p_capability,p_guard_kind,p_legacy_admin_only,md5(function_body))
  on conflict(signature) do update set capability=excluded.capability,guard_kind=excluded.guard_kind,
    legacy_admin_only=excluded.legacy_admin_only,body_md5=excluded.body_md5;
  perform private.register_operator_internal_contract(p_function);
end $$;
revoke all on function private.register_operator_rpc_contract(regprocedure,text,text,boolean) from public,anon,authenticated,service_role;
do $$ declare contract record;
begin
  for contract in select signature from private.operator_rpc_contracts loop
    perform private.register_operator_internal_contract(contract.signature::regprocedure);
  end loop;
  perform private.register_operator_internal_contract('private.register_operator_rpc_contract(regprocedure,text,text,boolean)'::regprocedure);
end $$;
