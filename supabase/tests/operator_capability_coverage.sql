\set ON_ERROR_STOP on
begin;
do $$ declare problem text; contracts integer; policies integer; internals integer;
begin
 if to_regclass('private.operator_legacy_fixture_control') is not null
  or exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass and tgname='test_operator_legacy_fixture') then
  raise exception 'Legacy fixture helper must be absent from capability coverage tests';end if;
 select string_agg(c.signature,', ' order by c.signature) into problem
 from private.operator_rpc_contracts c left join pg_proc p on p.oid=to_regprocedure(c.signature)
 where p.oid is null or md5(p.prosrc)<>c.body_md5;
 if problem is not null then raise exception 'Operator RPC contract drift: %',problem;end if;
 select string_agg(p.oid::regprocedure::text,', ' order by p.oid::regprocedure::text) into problem
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f'
  and p.proname not in ('is_staff','has_operator_capability')
  and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))
  and (left(p.proname,6)='admin_' or p.prosrc ~ '(is_staff|has_operator_capability|require_operator_capability|require_actor_operator_capability)[[:space:]]*[(]'
    or p.prosrc ~ 'profile[.]role[[:space:]]*(in|=)[[:space:]]*.*admin')
  and not exists(select 1 from private.operator_rpc_contracts c where to_regprocedure(c.signature)=p.oid);
 if problem is not null then raise exception 'Unclassified privileged RPC: %',problem;end if;
 select string_agg(c.signature,', ' order by c.signature) into problem
 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
 where (c.guard_kind='retired' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
  or (c.guard_kind in ('service_start','service_finish') and
    (not has_function_privilege('service_role',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')))
  or (c.guard_kind in ('read','write','manual') and has_function_privilege('anon',p.oid,'execute'));
 if problem is not null then raise exception 'Operator RPC ACL drift: %',problem;end if;
 select string_agg(c.signature,', ' order by c.signature) into problem
 from private.operator_internal_contracts c left join pg_proc p on p.oid=to_regprocedure(c.signature)
 where p.oid is null or c.definition_md5<>md5(concat_ws('|',p.prosrc,p.prolang::text,p.provolatile::text,
  p.prosecdef::text,p.proisstrict::text,p.proparallel::text,coalesce(p.proconfig::text,''),
  coalesce(p.proacl::text,''),p.proowner::text,p.prorettype::text,p.proretset::text,
  p.proargtypes::text,coalesce(p.proallargtypes::text,''),coalesce(p.proargmodes::text,''),
  coalesce(p.proargnames::text,''),coalesce(p.proargdefaults::text,'')));
 if problem is not null then raise exception 'Operator internal contract drift: %',problem;end if;
 select string_agg(c.signature,', ' order by c.signature) into problem from private.operator_rpc_contracts c
 where not exists(select 1 from private.operator_internal_contracts i where to_regprocedure(i.signature)=to_regprocedure(c.signature));
 if problem is not null then raise exception 'Operator RPC execution metadata not covered: %',problem;end if;
 select string_agg(p.oid::regprocedure::text,', ') into problem from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.prokind='f' and (
  p.proname ~ '^(operator_|guard_operator_|enforce_operator_|can_finish_operator_|lock_operator_|register_operator_|customer_segment_|marketing_|store_analytics_|pg_settlement_)'
  or p.proname in ('has_operator_capability','require_operator_capability','require_actor_operator_capability',
   'require_purchase_restriction_staff','require_inquiry_template_staff','require_seller_claim_staff',
   'assert_store_credit_admin','can_manage_goods_purchase_costs','guard_goods_import_cost_confidentiality',
   'normalize_operator_invitation','insert_operator_invitation','cancel_operator_invites_on_authority_loss','normalize_customer_segment_rule','normalize_marketing_content','process_marketing_run'))
  and not exists(select 1 from private.operator_internal_contracts i where to_regprocedure(i.signature)=p.oid);
 if problem is not null then raise exception 'Unclassified operator authorization helper: %',problem;end if;
 select string_agg(format('%I.%I.%I',c.schema_name,c.table_name,c.policy_name),', ') into problem
 from private.operator_policy_contracts c left join pg_policy p
  on p.polrelid=to_regclass(format('%I.%I',c.schema_name,c.table_name)) and p.polname=c.policy_name
 where p.oid is null or c.definition_md5<>md5(concat_ws('|',p.polcmd::text,p.polpermissive::text,p.polroles::text,coalesce(p.polqual::text,''),coalesce(p.polwithcheck::text,'')));
 if problem is not null then raise exception 'Operator RLS contract drift: %',problem;end if;
 select string_agg(format('%I.%I.%I',schemaname,tablename,policyname),', ') into problem
 from pg_policies where schemaname in ('public','storage')
  and (coalesce(qual,'')||coalesce(with_check,'')) ~ '(is_staff|is_admin)[[:space:]]*[(]';
 if problem is not null then raise exception 'Unconverted operator RLS identity branch: %',problem;end if;
 select string_agg(format('%I.%I.%I',p.schemaname,p.tablename,p.policyname),', ') into problem
 from pg_policies p where p.schemaname in ('public','storage')
  and (coalesce(p.qual,'')||coalesce(p.with_check,'')) ~ '(has_operator_capability|can_stage_admin_artwork)[[:space:]]*[(]'
  and not exists(select 1 from private.operator_policy_contracts c where c.schema_name=p.schemaname and c.table_name=p.tablename and c.policy_name=p.policyname);
 if problem is not null then raise exception 'Unclassified operator RLS policy: %',problem;end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind in ('r','p') and (c.relname like 'store_analytics_%' or c.relname like 'pg_settlement_%' or c.relname in
  ('operator_access_state','operator_memberships','operator_legacy_cohort','operator_rpc_contracts','operator_policy_contracts','operator_internal_contracts','operator_cancellation_authorizations','operator_invitations','customer_segments','customer_segment_estimates','customer_segment_favorites','marketing_campaigns','marketing_runs','marketing_recipients'))
  and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'select,insert,update,delete') or has_table_privilege('authenticated',c.oid,'select,insert,update,delete') or has_table_privilege('service_role',c.oid,'select,insert,update,delete'))) then
  raise exception 'Operator authority tables exposed';end if;
 select count(*) into contracts from private.operator_rpc_contracts;
 select count(*) into policies from private.operator_policy_contracts;
 select count(*) into internals from private.operator_internal_contracts;
 if contracts<288 or policies<85 or internals<15 then raise exception 'Incomplete operator coverage: RPC %, policies %, internal %',contracts,policies,internals;end if;
 raise notice 'Operator coverage: % RPC contracts, % RLS policies, % internal helpers',contracts,policies,internals;
end $$;
rollback;
