-- Coverage receipts detect a later migration that silently drops a gate, alters
-- a policy, or exposes an internal helper. Raw policy nodes avoid search_path-
-- dependent deparsing differences between CLI, PostgREST and CI sessions.
create table private.operator_internal_contracts (
  signature text primary key,
  definition_md5 text not null check(definition_md5 ~ '^[0-9a-f]{32}$')
);
alter table private.operator_internal_contracts enable row level security;
revoke all on private.operator_internal_contracts from public,anon,authenticated,service_role;

create function private.register_operator_internal_contract(p_function regprocedure)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  insert into private.operator_internal_contracts(signature,definition_md5)
  select p.oid::regprocedure::text,md5(concat_ws('|',p.prosrc,p.prolang::text,p.provolatile::text,
    p.prosecdef::text,p.proisstrict::text,p.proparallel::text,coalesce(p.proconfig::text,''),
    coalesce(p.proacl::text,''),p.proowner::text,p.prorettype::text,p.proretset::text,
    p.proargtypes::text,coalesce(p.proallargtypes::text,''),coalesce(p.proargmodes::text,''),
    coalesce(p.proargnames::text,''),coalesce(p.proargdefaults::text,'')))
  from pg_proc p where p.oid=p_function::oid
  on conflict(signature) do update set definition_md5=excluded.definition_md5;
  if not found then raise undefined_function using message='operator_internal_contract_function_missing';end if;
end $$;
revoke all on function private.register_operator_internal_contract(regprocedure) from public,anon,authenticated,service_role;

create function private.register_operator_policy_contract(p_table regclass,p_policy text,p_capability text)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  if not(p_capability=any(private.operator_role_capabilities('owner'))) then
    raise invalid_parameter_value using message='operator_policy_capability_invalid';end if;
  insert into private.operator_policy_contracts(schema_name,table_name,policy_name,capability,definition_md5)
  select n.nspname,c.relname,p.polname,p_capability,
    md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(p.polqual::text,''),coalesce(p.polwithcheck::text,'')))
  from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
  where p.polrelid=p_table::oid and p.polname=p_policy
  on conflict(schema_name,table_name,policy_name) do update set capability=excluded.capability,definition_md5=excluded.definition_md5;
  if not found then raise undefined_object using message='operator_policy_contract_policy_missing';end if;
end $$;
revoke all on function private.register_operator_policy_contract(regclass,text,text) from public,anon,authenticated,service_role;

do $$ declare contract record; helper record;
begin
  for contract in select * from private.operator_policy_contracts loop
    perform private.register_operator_policy_contract(format('%I.%I',contract.schema_name,contract.table_name)::regclass,contract.policy_name,contract.capability);
  end loop;
  -- Its existing predicate delegates to the now capability-aware upload claim
  -- helper. Include the policy itself so removing that delegation also fails CI.
  perform private.register_operator_policy_contract('storage.objects'::regclass,'admin_artwork_staging_insert','catalog.manage');
  for helper in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.prokind='f' and (
      p.proname ~ '^(operator_|guard_operator_|enforce_operator_|can_finish_operator_|lock_operator_|register_operator_)'
      or p.proname in ('has_operator_capability','require_operator_capability','require_actor_operator_capability',
        'require_purchase_restriction_staff','require_inquiry_template_staff','require_seller_claim_staff',
        'assert_store_credit_admin','can_manage_goods_purchase_costs','guard_goods_import_cost_confidentiality',
        'normalize_operator_invitation','insert_operator_invitation','cancel_operator_invites_on_authority_loss')
    )
  loop perform private.register_operator_internal_contract(helper.signature); end loop;
  perform private.register_operator_internal_contract('public.has_operator_capability(text,boolean)'::regprocedure);
  perform private.register_operator_internal_contract('public.claim_email_intent_dispatch(uuid,text)'::regprocedure);
end $$;
