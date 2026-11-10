-- DRAFT: explicit shipping charge groups, separate from physical shipments and
-- immutable goods aggregation identities. No existing membership is seeded.
-- This migration is prepared only; local/remote application needs separate approval.
create table private.shipping_charge_groups (
 id uuid primary key, origin_id uuid not null references public.fulfillment_origins(id),
 revision integer not null check(revision>0),version_id uuid not null,is_default boolean not null default false,
 created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 updated_by uuid not null,updated_at timestamptz not null default clock_timestamp()
);
create unique index shipping_charge_groups_default_origin on private.shipping_charge_groups(origin_id) where is_default;
create table private.shipping_charge_group_versions (
 id uuid primary key,group_id uuid not null references private.shipping_charge_groups(id) deferrable initially deferred,
 revision integer not null check(revision>0),policy_values jsonb not null check(jsonb_typeof(policy_values)='object'),
 regional_confirmed_by uuid,regional_confirmed_at timestamptz,
 created_by uuid not null,session_id uuid not null,operation_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(group_id,revision),unique(group_id,id,revision),
 check((regional_confirmed_by is null)=(regional_confirmed_at is null))
);
alter table private.shipping_charge_groups add constraint shipping_charge_groups_current_version
 foreign key(id,version_id,revision) references private.shipping_charge_group_versions(group_id,id,revision) deferrable initially deferred;
create table private.shipping_charge_group_assignments (
 id uuid primary key,owner_good_id text not null unique references public.goods(id) on update cascade,
 group_id uuid references private.shipping_charge_groups(id),revision integer not null check(revision>0),version_id uuid not null,
 updated_by uuid not null,updated_at timestamptz not null default clock_timestamp()
);
create index shipping_charge_group_assignments_group on private.shipping_charge_group_assignments(group_id,owner_good_id) where group_id is not null;
create table private.shipping_charge_group_assignment_versions (
 id uuid primary key,assignment_id uuid not null references private.shipping_charge_group_assignments(id) deferrable initially deferred,
 revision integer not null check(revision>0),owner_good_id_at_write text not null,origin_id uuid not null,
 group_id uuid references private.shipping_charge_groups(id),group_revision integer,
 created_by uuid not null,session_id uuid not null,operation_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(assignment_id,revision),unique(assignment_id,id,revision),
 check((group_id is null)=(group_revision is null)),check(group_revision is null or group_revision>0)
);
alter table private.shipping_charge_group_assignments add constraint shipping_charge_group_assignment_current_version
 foreign key(id,version_id,revision) references private.shipping_charge_group_assignment_versions(assignment_id,id,revision) deferrable initially deferred;
create table private.shipping_charge_group_operations (
 operation_id uuid primary key,actor_id uuid not null,session_id uuid not null,command text not null check(command in('save','assign')),
 group_id uuid,expected_revision integer not null check(expected_revision>=0),request_hash text,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 check(request_hash is null or request_hash~'^[0-9a-f]{64}$'),check((receipt->>'state'='sealed')=(request_hash is null))
);
alter table private.shipping_charge_groups enable row level security;
alter table private.shipping_charge_group_versions enable row level security;
alter table private.shipping_charge_group_assignments enable row level security;
alter table private.shipping_charge_group_assignment_versions enable row level security;
alter table private.shipping_charge_group_operations enable row level security;
revoke all on private.shipping_charge_groups,private.shipping_charge_group_versions,private.shipping_charge_group_assignments,
 private.shipping_charge_group_assignment_versions,private.shipping_charge_group_operations from public,anon,authenticated,service_role;

create function private.guard_shipping_charge_group_history() returns trigger
language plpgsql security definer set search_path='' as $$begin
 raise check_violation using message='shipping_charge_group_history_immutable';
end $$;
create trigger shipping_charge_group_versions_immutable before update or delete on private.shipping_charge_group_versions
 for each row execute function private.guard_shipping_charge_group_history();
create trigger shipping_charge_group_assignment_versions_immutable before update or delete on private.shipping_charge_group_assignment_versions
 for each row execute function private.guard_shipping_charge_group_history();

create function private.require_shipping_charge_group_identity(p_actor uuid,p_session uuid) returns void
language plpgsql volatile security invoker set search_path='' as $$begin
 perform private.require_operator_capability('catalog.manage',false);
 if p_actor is null or p_actor is distinct from auth.uid() or p_session is null
  or auth.jwt()->>'session_id' is distinct from p_session::text then
  raise insufficient_privilege using message='shipping_charge_group_auth_changed';end if;
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise insufficient_privilege using message='shipping_charge_group_auth_changed';end if;
end $$;
create function private.shipping_charge_group_context(p_request jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$declare result jsonb;begin
 if jsonb_typeof(p_request) is distinct from 'object'
  or not p_request ?& array['operationId','command','groupId','expectedRevision','expectedActorId','expectedSessionId']
  or not private.shipping_settings_uuid(p_request->'operationId') or not private.shipping_settings_uuid(p_request->'expectedActorId')
  or not private.shipping_settings_uuid(p_request->'expectedSessionId') or coalesce(p_request->>'command','') not in('save','assign')
  or not (private.shipping_settings_uuid(p_request->'groupId') or (p_request->>'command'='assign' and p_request->'groupId'='null'::jsonb))
  or not private.transaction_uint(p_request->'expectedRevision',0,case when p_request->>'command'='save' then 2147483646 else 2147483647 end)
  or (p_request->>'command'='assign' and ((p_request->'groupId'='null'::jsonb) is distinct from (p_request->>'expectedRevision'='0'))) then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_operation';end if;
 select jsonb_object_agg(key,value) into result from jsonb_each(p_request)
 where key=any(array['operationId','command','groupId','expectedRevision','expectedActorId','expectedSessionId']);
 return result;
end $$;
create function private.shipping_charge_group_prior(p_context jsonb,p_hash text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare previous private.shipping_charge_group_operations;begin
 select * into previous from private.shipping_charge_group_operations where operation_id=(p_context->>'operationId')::uuid;
 if not found then return null;end if;
 if previous.actor_id is distinct from (p_context->>'expectedActorId')::uuid or previous.session_id is distinct from (p_context->>'expectedSessionId')::uuid
  or previous.command is distinct from p_context->>'command' or previous.group_id is distinct from (p_context->>'groupId')::uuid
  or previous.expected_revision is distinct from (p_context->>'expectedRevision')::integer
  or (p_hash is not null and previous.receipt->>'state'<>'sealed' and previous.request_hash is distinct from p_hash) then
  raise sqlstate 'PT409' using message='shipping_charge_group_operation_conflict';end if;
 return previous.receipt;
end $$;
create function private.shipping_charge_group_receipt(p_context jsonb,p_state text,p_group jsonb default null,p_default jsonb default null,p_goods jsonb default '[]') returns jsonb
language sql volatile set search_path='' as $$
 select jsonb_build_object('state',p_state,'operationId',p_context->'operationId','command',p_context->'command','groupId',p_context->'groupId',
  'expectedRevision',p_context->'expectedRevision','actorId',p_context->'expectedActorId','sessionId',p_context->'expectedSessionId',
  'group',p_group,'changedDefaultGroup',p_default,'appliedCount',jsonb_array_length(p_goods),'goods',p_goods,'recordedAt',clock_timestamp());
$$;
create function private.record_shipping_charge_group_operation(p_context jsonb,p_hash text,p_receipt jsonb) returns void
language sql volatile security definer set search_path='' as $$
 insert into private.shipping_charge_group_operations(operation_id,actor_id,session_id,command,group_id,expected_revision,request_hash,receipt)
 values((p_context->>'operationId')::uuid,(p_context->>'expectedActorId')::uuid,(p_context->>'expectedSessionId')::uuid,p_context->>'command',
  (p_context->>'groupId')::uuid,(p_context->>'expectedRevision')::integer,p_hash,p_receipt);
$$;
create function private.shipping_charge_group_document(p_group_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select v.policy_values||jsonb_build_object('id',g.id,'originId',g.origin_id,'revision',g.revision,'versionId',g.version_id,
  'assignedCount',(select count(*) from private.shipping_charge_group_assignments a where a.group_id=g.id),
  'createdAt',g.created_at,'updatedAt',g.updated_at)
 from private.shipping_charge_groups g join private.shipping_charge_group_versions v on v.id=g.version_id where g.id=p_group_id;
$$;
create function private.shipping_charge_group_summary(p_group_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',g.id,'originId',g.origin_id,'revision',g.revision,'name',v.policy_values->'name','enabled',v.policy_values->'enabled',
  'archived',v.policy_values->'archived','calculationMode',v.policy_values->'calculationMode','regionalMode',v.policy_values#>'{regional,mode}')
 from private.shipping_charge_groups g join private.shipping_charge_group_versions v on v.id=g.version_id where g.id=p_group_id;
$$;
create function private.shipping_charge_group_origin(p_origin_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',o.id,'name',o.name,'updatedAt',o.updated_at,'defaultCarrier',o.default_carrier,'isActive',o.is_active,
  'defaultGroupId',d.id,'defaultGroupRevision',coalesce(d.revision,0))
 from public.fulfillment_origins o left join private.shipping_charge_groups d on d.origin_id=o.id and d.is_default where o.id=p_origin_id;
$$;
create function private.shipping_charge_group_good_guard(p_good public.goods) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.shipping_settings_good_guard(p_good)||jsonb_build_object('originId',owner.origin_id,
  'assignmentRevision',coalesce(a.revision,0),'assignmentVersionId',a.version_id,'groupId',a.group_id,'groupRevision',g.revision)
 from public.goods owner left join private.shipping_charge_group_assignments a on a.owner_good_id=owner.id
 left join private.shipping_charge_groups g on g.id=a.group_id where owner.id=private.goods_aggregation_owner(p_good.id);
$$;

create function private.shipping_charge_group_region_adapter(p_origin_id uuid,p_name text,p_policy jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$begin
 if not private.transaction_json_keys(p_policy,array['carrierCode','startsAt','endsAt','openEnded','sourceEvidence','unlistedDisposition','noRulesConfirmed','rules']) then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_region';end if;
 return private.normalize_shipping_region_policy(p_policy||jsonb_build_object('originId',p_origin_id,'name',p_name,
  'feeUnit','per_shipment','chargePolicyGoods',true,'waivePolicyThreshold',false,'chargeFreeGoods',true,'chargeIndividualGoods',true));
end $$;
create function private.normalize_shipping_charge_group_values(p_origin_id uuid,p_values jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$declare regional jsonb;policy jsonb;begin
 if not private.transaction_json_keys(p_values,array['name','enabled','archived','isDefault','calculationMode','regional'])
  or jsonb_typeof(p_values->'name') is distinct from 'string' or char_length(p_values->>'name') not between 1 and 80
  or p_values->>'name' is distinct from private.shipping_region_text(p_values->>'name') or p_values->>'name'~'[[:cntrl:]]'
  or jsonb_typeof(p_values->'enabled') is distinct from 'boolean' or jsonb_typeof(p_values->'archived') is distinct from 'boolean'
  or jsonb_typeof(p_values->'isDefault') is distinct from 'boolean' or coalesce(p_values->>'calculationMode','') not in('min','max')
  or ((p_values->>'archived')::boolean and (p_values->>'enabled')::boolean)
  or ((p_values->>'isDefault')::boolean and (not(p_values->>'enabled')::boolean or (p_values->>'archived')::boolean)) then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_values';end if;
 regional:=p_values->'regional';
 if not private.transaction_json_keys(regional,array['mode','policy']) or coalesce(regional->>'mode','') not in('inherit','override')
  or ((regional->>'mode'='inherit') is distinct from (regional->'policy'='null'::jsonb)) then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_region';end if;
 if regional->>'mode'='override' then
  policy:=private.shipping_charge_group_region_adapter(p_origin_id,p_values->>'name',regional->'policy');
  if (p_values->>'enabled')::boolean then perform private.assert_shipping_region_policy_complete(policy);end if;
  policy:=policy-array['originId','name','feeUnit','chargePolicyGoods','waivePolicyThreshold','chargeFreeGoods','chargeIndividualGoods'];
  regional:=jsonb_build_object('mode','override','policy',policy);
 end if;
 return jsonb_set(p_values,'{regional}',regional);
end $$;
create function private.shipping_charge_group_assignment_blocker(p_good public.goods,p_group_id uuid,p_clear boolean default false) returns text
language plpgsql stable security definer set search_path='' as $$declare origin public.fulfillment_origins;group_values jsonb;group_origin uuid;delivery jsonb;begin
 if private.goods_aggregation_owner(p_good.id)<>p_good.id then return 'goods_aggregation_policy_owned_by_source';end if;
 select * into origin from public.fulfillment_origins where id=p_good.origin_id;
 if (not p_clear and (not found or not origin.is_active)) or (p_clear and p_good.origin_id is not null and not found)
  or (p_clear and p_good.origin_id is null and exists(select 1 from private.shipping_charge_group_assignments where owner_good_id=p_good.id and group_id is not null)) then return 'shipping_charge_group_origin_unavailable';end if;
 if not coalesce((select enabled from private.goods_transaction_runtime where singleton),false) then return 'checkout_contract_upgrade_required';end if;
 if p_group_id is not null then
  select v.policy_values,g.origin_id into group_values,group_origin from private.shipping_charge_groups g
   join private.shipping_charge_group_versions v on v.id=g.version_id where g.id=p_group_id;
  if not found or not(group_values->>'enabled')::boolean or (group_values->>'archived')::boolean then return 'shipping_charge_group_unavailable';end if;
  if group_origin<>p_good.origin_id then return 'shipping_charge_group_origin_mismatch';end if;
 end if;
 delivery:=private.shipping_settings_delivery_input(p_good.id);
 if not p_clear and delivery->>'status'='active' and delivery->>'paymentMode'<>'prepaid' and not exists(
  select 1 from private.shipping_collect_contracts c join private.shipping_collect_contract_versions v on v.id=c.version_id
  where c.origin_id=p_good.origin_id and v.status='active') then return 'collect_contract_not_ready';end if;
 return null;
end $$;
create function private.shipping_charge_group_good_row(p_good public.goods,p_target_group_id uuid,p_clear boolean default false) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.shipping_charge_group_good_guard(p_good)||jsonb_build_object('name',p_good.name,'code',p_good.code,
  'editable',private.goods_aggregation_owner(p_good.id)=p_good.id,'blocker',private.shipping_charge_group_assignment_blocker(p_good,p_target_group_id,p_clear),
  'effectiveCount',jsonb_array_length(private.shipping_settings_good_guard(p_good)->'familyGoodIds'));
$$;
create function private.write_shipping_charge_group_version(p_group_id uuid,p_origin_id uuid,p_values jsonb,p_actor uuid,p_session uuid,p_operation uuid,
 p_confirmed_by uuid,p_confirmed_at timestamptz) returns void
language plpgsql volatile security definer set search_path='' as $$declare previous private.shipping_charge_groups;version_id uuid:=gen_random_uuid();revision integer;begin
 select * into previous from private.shipping_charge_groups where id=p_group_id;
 if found and previous.origin_id<>p_origin_id then raise check_violation using message='shipping_charge_group_origin_immutable';end if;
 revision:=coalesce(previous.revision,0)+1;
 insert into private.shipping_charge_groups(id,origin_id,revision,version_id,is_default,created_by,updated_by)
 values(p_group_id,p_origin_id,revision,version_id,(p_values->>'isDefault')::boolean,p_actor,p_actor)
 on conflict(id) do update set revision=excluded.revision,version_id=excluded.version_id,is_default=excluded.is_default,
  updated_by=p_actor,updated_at=greatest(clock_timestamp(),private.shipping_charge_groups.updated_at+interval '1 microsecond');
 insert into private.shipping_charge_group_versions(id,group_id,revision,policy_values,regional_confirmed_by,regional_confirmed_at,created_by,session_id,operation_id)
 values(version_id,p_group_id,revision,p_values,p_confirmed_by,p_confirmed_at,p_actor,p_session,p_operation);
end $$;

create function public.admin_read_shipping_charge_group_operation(p_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare context jsonb;begin
 context:=private.shipping_charge_group_context(p_context);
 if context is distinct from p_context then raise invalid_parameter_value using message='invalid_shipping_charge_group_operation';end if;
 perform private.require_shipping_charge_group_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 return private.shipping_charge_group_prior(context);
end $$;
create function public.admin_seal_shipping_charge_group_operation(p_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare context jsonb;receipt jsonb;begin
 context:=private.shipping_charge_group_context(p_context);
 if context is distinct from p_context then raise invalid_parameter_value using message='invalid_shipping_charge_group_operation';end if;
 perform private.require_shipping_charge_group_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 perform pg_advisory_xact_lock(hashtextextended('shipping-charge-group-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_charge_group_prior(context);if receipt is not null then return receipt;end if;
 receipt:=private.shipping_charge_group_receipt(context,'sealed');perform private.record_shipping_charge_group_operation(context,null,receipt);
 insert into public.audit_log(id,actor_id,action,target,diff) values((context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,
  'catalog.shipping_charge_group.operation_sealed','shipping_charge_groups:'||coalesce(context->>'groupId','clear'),jsonb_build_object('context',context));
 return receipt;
end $$;
create function public.admin_save_shipping_charge_group(p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare context jsonb;request_hash text;receipt jsonb;origin public.fulfillment_origins;previous private.shipping_charge_groups;
 previous_version private.shipping_charge_group_versions;default_group private.shipping_charge_groups;default_version private.shipping_charge_group_versions;
 policy_values jsonb;region_changed boolean;requires_confirmation boolean;confirmed_by uuid;confirmed_at timestamptz;default_result jsonb;before_document jsonb;
begin
 context:=private.shipping_charge_group_context(p_request);
 perform private.require_shipping_charge_group_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 if not private.transaction_json_keys(p_request,array['operationId','command','groupId','expectedRevision','expectedActorId','expectedSessionId',
  'originId','originUpdatedAt','expectedDefaultGroupId','expectedDefaultGroupRevision','values','attestRegional']) or context->>'command'<>'save'
  or not private.shipping_settings_uuid(p_request->'originId') or not private.transaction_instant_valid(p_request->'originUpdatedAt')
  or not (p_request->'expectedDefaultGroupId'='null'::jsonb or private.shipping_settings_uuid(p_request->'expectedDefaultGroupId'))
  or not private.transaction_uint(p_request->'expectedDefaultGroupRevision',0,2147483646)
  or ((p_request->'expectedDefaultGroupId'='null'::jsonb) is distinct from (p_request->>'expectedDefaultGroupRevision'='0'))
  or jsonb_typeof(p_request->'attestRegional') is distinct from 'boolean' then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_save';end if;
 request_hash:=encode(extensions.digest(p_request::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('shipping-charge-group-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_charge_group_prior(context,request_hash);if receipt is not null then return receipt;end if;
 -- Origin serializes first-default creation and all default changes. No member
 -- product locks are acquired here; checkout acquires origin before group rows.
 select * into origin from public.fulfillment_origins where id=(p_request->>'originId')::uuid for update nowait;
 if not found then raise check_violation using message='shipping_charge_group_origin_unavailable';end if;
 if origin.updated_at is distinct from (p_request->>'originUpdatedAt')::timestamptz then raise sqlstate 'PT409' using message='shipping_charge_group_origin_changed';end if;
 perform 1 from private.shipping_charge_groups where origin_id=origin.id or id=(context->>'groupId')::uuid order by id for update nowait;
 select * into previous from private.shipping_charge_groups where id=(context->>'groupId')::uuid;
 if (found and previous.revision<>(context->>'expectedRevision')::integer) or (not found and context->>'expectedRevision'<>'0') then
  raise sqlstate 'PT409' using message='shipping_charge_group_changed';end if;
 if previous.id is not null and previous.origin_id<>origin.id then raise check_violation using message='shipping_charge_group_origin_immutable';end if;
 select * into default_group from private.shipping_charge_groups where origin_id=origin.id and is_default;
 if default_group.id is distinct from (p_request->>'expectedDefaultGroupId')::uuid
  or coalesce(default_group.revision,0)<>(p_request->>'expectedDefaultGroupRevision')::integer then
  raise sqlstate 'PT409' using message='shipping_charge_group_default_changed';end if;
 select * into previous_version from private.shipping_charge_group_versions where id=previous.version_id;
 policy_values:=private.normalize_shipping_charge_group_values(origin.id,p_request->'values');
 if (policy_values->>'enabled')::boolean and not origin.is_active then raise check_violation using message='shipping_charge_group_origin_unavailable';end if;
 if (not(policy_values->>'enabled')::boolean or (policy_values->>'archived')::boolean)
  and exists(select 1 from private.shipping_charge_group_assignments where group_id=previous.id) then
  raise check_violation using message='shipping_charge_group_has_assignments';end if;
 region_changed:=case when previous.id is null then policy_values#>>'{regional,mode}'='override'
  else previous_version.policy_values->'regional' is distinct from policy_values->'regional' end;
 requires_confirmation:=region_changed or (policy_values#>>'{regional,mode}'='override' and (policy_values->>'enabled')::boolean
  and not coalesce((previous_version.policy_values->>'enabled')::boolean,false));
 if requires_confirmation then
  perform private.require_operator_capability('platform.manage',true);
  if not(p_request->>'attestRegional')::boolean then raise check_violation using message='shipping_charge_group_region_confirmation_required';end if;
 end if;
 confirmed_by:=previous_version.regional_confirmed_by;confirmed_at:=previous_version.regional_confirmed_at;
 if policy_values#>>'{regional,mode}'='inherit' then confirmed_by:=null;confirmed_at:=null;
 elsif requires_confirmation then confirmed_by:=(context->>'expectedActorId')::uuid;confirmed_at:=clock_timestamp();end if;
 if policy_values#>>'{regional,mode}'='override' and (policy_values->>'enabled')::boolean then
  perform 1 from public.shipping_carriers where code=policy_values#>>'{regional,policy,carrierCode}' for share nowait;
  if confirmed_by is null or not exists(select 1 from public.shipping_carriers where code=policy_values#>>'{regional,policy,carrierCode}' and is_active)
   or policy_values#>>'{regional,policy,carrierCode}' is distinct from origin.default_carrier then
   raise check_violation using message='shipping_charge_group_region_unavailable';end if;
 end if;
 if (policy_values->>'enabled')::boolean then
  perform 1 from private.goods_transaction_runtime where singleton and enabled for share nowait;
  if not found then raise check_violation using message='checkout_contract_upgrade_required';end if;
 end if;
 before_document:=private.shipping_charge_group_document(previous.id);
 if (policy_values->>'isDefault')::boolean and default_group.id is not null and default_group.id<>(context->>'groupId')::uuid then
  select * into default_version from private.shipping_charge_group_versions where id=default_group.version_id;
  perform private.write_shipping_charge_group_version(default_group.id,origin.id,jsonb_set(default_version.policy_values,'{isDefault}','false'),
   (context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid,(context->>'operationId')::uuid,
   default_version.regional_confirmed_by,default_version.regional_confirmed_at);
  default_result:=private.shipping_charge_group_document(default_group.id);
 end if;
 if previous.id is null or previous_version.policy_values is distinct from policy_values then
  perform private.write_shipping_charge_group_version((context->>'groupId')::uuid,origin.id,policy_values,
   (context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid,(context->>'operationId')::uuid,confirmed_by,confirmed_at);
 end if;
 receipt:=private.shipping_charge_group_receipt(context,'saved',private.shipping_charge_group_document((context->>'groupId')::uuid),default_result);
 insert into public.audit_log(id,actor_id,action,target,diff) values((context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,
  'catalog.shipping_charge_group.saved','shipping_charge_groups:'||(context->>'groupId'),
  jsonb_build_object('context',context,'before',before_document,'after',receipt->'group','changedDefaultGroup',default_result,
   'regionalChanged',region_changed,'regionalConfirmed',requires_confirmation));
 perform private.record_shipping_charge_group_operation(context,request_hash,receipt);return receipt;
exception when lock_not_available then raise sqlstate 'PT409' using message='shipping_charge_group_retry';
end $$;

create function public.admin_list_shipping_charge_groups(p_origin_id uuid,p_query text,p_status text,p_page integer,p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare result jsonb;origins jsonb;total integer;begin
 perform private.require_shipping_charge_group_identity(p_expected_actor_id,p_expected_session_id);
 if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 1000000
  or p_status is null or p_status not in('all','active','inactive','archived') then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_search';end if;
 select coalesce(jsonb_agg(private.shipping_charge_group_origin(id) order by id),'[]') into origins
 from public.fulfillment_origins where p_origin_id is null or id=p_origin_id;
 select count(*) into total from private.shipping_charge_groups g join private.shipping_charge_group_versions v on v.id=g.version_id
 where (p_origin_id is null or g.origin_id=p_origin_id) and position(lower(btrim(p_query)) in lower(v.policy_values->>'name'))>0
  and (p_status='all' or (p_status='archived' and (v.policy_values->>'archived')::boolean)
   or (p_status='active' and (v.policy_values->>'enabled')::boolean and not(v.policy_values->>'archived')::boolean)
   or (p_status='inactive' and not(v.policy_values->>'enabled')::boolean and not(v.policy_values->>'archived')::boolean));
 select coalesce(jsonb_agg(private.shipping_charge_group_document(id) order by updated_at desc,id),'[]') into result from(
  select g.id,g.updated_at from private.shipping_charge_groups g join private.shipping_charge_group_versions v on v.id=g.version_id
  where (p_origin_id is null or g.origin_id=p_origin_id) and position(lower(btrim(p_query)) in lower(v.policy_values->>'name'))>0
   and (p_status='all' or (p_status='archived' and (v.policy_values->>'archived')::boolean)
    or (p_status='active' and (v.policy_values->>'enabled')::boolean and not(v.policy_values->>'archived')::boolean)
    or (p_status='inactive' and not(v.policy_values->>'enabled')::boolean and not(v.policy_values->>'archived')::boolean))
  order by g.updated_at desc,g.id limit 20 offset (p_page-1)*20) page;
 return jsonb_build_object('actorId',p_expected_actor_id,'sessionId',p_expected_session_id,
  'runtimeEnabled',coalesce((select enabled from private.goods_transaction_runtime where singleton),false),
  'canManageRegional',public.has_operator_capability('platform.manage',true),'page',p_page,'pageSize',20,'total',total,'groups',result,'origins',origins);
end $$;
create function public.admin_get_shipping_charge_group(p_group_id uuid,p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare document jsonb;begin
 perform private.require_shipping_charge_group_identity(p_expected_actor_id,p_expected_session_id);
 document:=private.shipping_charge_group_document(p_group_id);
 if document is null then raise no_data_found using message='shipping_charge_group_unavailable';end if;
 return jsonb_build_object('actorId',p_expected_actor_id,'sessionId',p_expected_session_id,
  'runtimeEnabled',coalesce((select enabled from private.goods_transaction_runtime where singleton),false),
  'canManageRegional',public.has_operator_capability('platform.manage',true),'group',document,'origin',private.shipping_charge_group_origin((document->>'originId')::uuid));
end $$;
create function public.admin_get_good_shipping_charge_group(p_good_id text,p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare good public.goods;guard jsonb;begin
 perform private.require_shipping_charge_group_identity(p_expected_actor_id,p_expected_session_id);
 select * into good from public.goods where id=p_good_id and archived_at is null;
 if not found then raise no_data_found using message='shipping_charge_group_goods_unavailable';end if;
 guard:=private.shipping_charge_group_good_guard(good);
 return jsonb_build_object('actorId',p_expected_actor_id,'sessionId',p_expected_session_id,
  'runtimeEnabled',coalesce((select enabled from private.goods_transaction_runtime where singleton),false),
  'canManageRegional',public.has_operator_capability('platform.manage',true),
  'good',private.shipping_charge_group_good_row(good,(guard->>'groupId')::uuid),
  'group',private.shipping_charge_group_document((guard->>'groupId')::uuid),'origin',private.shipping_charge_group_origin((guard->>'originId')::uuid));
end $$;
create function public.admin_search_goods_for_shipping_charge_group(p_query text,p_origin_id uuid,p_group_id uuid,p_page integer,p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare total integer;result jsonb;begin
 perform private.require_shipping_charge_group_identity(p_expected_actor_id,p_expected_session_id);
 if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 1000000 then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_search';end if;
 select count(*) into total from public.goods g join public.goods owner on owner.id=private.goods_aggregation_owner(g.id)
 left join private.shipping_charge_group_assignments a on a.owner_good_id=owner.id
 where g.archived_at is null and (p_origin_id is null or owner.origin_id=p_origin_id) and (p_group_id is null or a.group_id=p_group_id)
  and position(lower(btrim(p_query)) in lower(g.id||' '||g.name||' '||coalesce(g.code,'')))>0;
 select coalesce(jsonb_agg(private.shipping_charge_group_good_row(g,a.group_id) order by g.updated_at desc,g.id),'[]') into result
 from (select g.id from public.goods g join public.goods owner on owner.id=private.goods_aggregation_owner(g.id)
  left join private.shipping_charge_group_assignments a on a.owner_good_id=owner.id
  where g.archived_at is null and (p_origin_id is null or owner.origin_id=p_origin_id) and (p_group_id is null or a.group_id=p_group_id)
   and position(lower(btrim(p_query)) in lower(g.id||' '||g.name||' '||coalesce(g.code,'')))>0
  order by g.updated_at desc,g.id limit 20 offset (p_page-1)*20) page join public.goods g on g.id=page.id
 left join private.shipping_charge_group_assignments a on a.owner_good_id=private.goods_aggregation_owner(g.id);
 return jsonb_build_object('actorId',p_expected_actor_id,'sessionId',p_expected_session_id,'page',p_page,'pageSize',20,'total',total,'goods',result);
end $$;
create function public.admin_preview_shipping_charge_group_assignment(p_group_id uuid,p_good_ids text[],p_expected_actor_id uuid,p_expected_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare group_document jsonb;good public.goods;row jsonb;rows jsonb:='[]';origins jsonb;allowed boolean:=true;begin
 perform private.require_shipping_charge_group_identity(p_expected_actor_id,p_expected_session_id);
 if p_good_ids is null or cardinality(p_good_ids) not between 1 and 100 or array_position(p_good_ids,null) is not null
  or exists(select 1 from unnest(p_good_ids) id where not private.shipping_settings_good_id(to_jsonb(id)))
  or (select count(distinct id) from unnest(p_good_ids) id)<>cardinality(p_good_ids) then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_targets';end if;
 group_document:=private.shipping_charge_group_document(p_group_id);
 if p_group_id is not null and group_document is null then raise no_data_found using message='shipping_charge_group_unavailable';end if;
 if (select count(*) from public.goods where id=any(p_good_ids) and archived_at is null)<>cardinality(p_good_ids) then
  raise no_data_found using message='shipping_charge_group_goods_unavailable';end if;
 for good in select * from public.goods where id=any(p_good_ids) order by id loop
  row:=private.shipping_charge_group_good_row(good,p_group_id,p_group_id is null);allowed:=allowed and row->>'blocker' is null;
  rows:=rows||jsonb_build_array(row||jsonb_build_object('beforeGroup',private.shipping_charge_group_summary((row->>'groupId')::uuid),
   'afterGroup',private.shipping_charge_group_summary(p_group_id)));
 end loop;
 select coalesce(jsonb_agg(private.shipping_charge_group_origin(id) order by id),'[]') into origins
 from public.fulfillment_origins where id in(select (value->>'originId')::uuid from jsonb_array_elements(rows));
 return jsonb_build_object('actorId',p_expected_actor_id,'sessionId',p_expected_session_id,'group',group_document,'canAssign',allowed,
  'runtimeEnabled',coalesce((select enabled from private.goods_transaction_runtime where singleton),false),
  'canManageRegional',public.has_operator_capability('platform.manage',true),'origins',origins,'goods',rows);
end $$;

create function private.assert_shipping_charge_group_owner_assignment(p_good_id text) returns void
language plpgsql stable security definer set search_path='' as $$declare owner public.goods;assignment private.shipping_charge_group_assignments;group_row private.shipping_charge_groups;begin
 select * into owner from public.goods where id=p_good_id;
 if not found then return;end if;
 select * into assignment from private.shipping_charge_group_assignments where owner_good_id=p_good_id;
 if not found then return;end if;
 if private.goods_aggregation_owner(p_good_id)<>p_good_id then raise check_violation using message='goods_aggregation_policy_owned_by_source';end if;
 if assignment.group_id is not null then
  select * into group_row from private.shipping_charge_groups where id=assignment.group_id;
  if not found or owner.origin_id is distinct from group_row.origin_id then raise check_violation using message='shipping_charge_group_origin_mismatch';end if;
 end if;
end $$;
create function private.guard_shipping_charge_group_good_origin() returns trigger
language plpgsql security definer set search_path='' as $$begin
 perform private.assert_shipping_charge_group_owner_assignment(new.id);return null;
end $$;
create constraint trigger shipping_charge_group_good_origin_guard after update on public.goods
 deferrable initially deferred for each row when(old.origin_id is distinct from new.origin_id or old.id is distinct from new.id)
 execute function private.guard_shipping_charge_group_good_origin();

create function private.apply_shipping_charge_group_assignment_locked(p_good_id text,p_group_id uuid,p_expected_group_revision integer,
 p_expected_assignment_revision integer,p_expected_assignment_version_id uuid,p_expected_family_good_ids text[],
 p_expected_final_good_updated_at timestamptz,p_expected_origin_updated_at timestamptz,p_operation_id uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare good public.goods;origin public.fulfillment_origins;previous private.shipping_charge_group_assignments;group_row private.shipping_charge_groups;
 version_id uuid:=gen_random_uuid();assignment_id uuid;revision integer;blocker text;guard jsonb;
begin
 perform private.require_shipping_charge_group_identity(p_actor,p_session);
 if p_good_id is null or p_operation_id is null or p_expected_group_revision is null or p_expected_group_revision<0
  or ((p_group_id is null) is distinct from (p_expected_group_revision=0))
  or p_expected_assignment_revision is null or p_expected_assignment_revision<0
  or ((p_expected_assignment_revision=0) is distinct from (p_expected_assignment_version_id is null))
  or p_expected_family_good_ids is null or cardinality(p_expected_family_good_ids) not between 1 and 100
  or array_position(p_expected_family_good_ids,null) is not null or p_expected_final_good_updated_at is null or not isfinite(p_expected_final_good_updated_at)
  or (p_expected_origin_updated_at is not null and not isfinite(p_expected_origin_updated_at)) then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_assignment';end if;
 select * into good from public.goods where id=p_good_id and archived_at is null for update nowait;
 if not found then raise no_data_found using message='shipping_charge_group_goods_unavailable';end if;
 guard:=private.shipping_charge_group_good_guard(good);
 if good.updated_at is distinct from p_expected_final_good_updated_at
  or guard->'familyGoodIds' is distinct from to_jsonb(p_expected_family_good_ids) then
  raise sqlstate 'PT409' using message='shipping_charge_group_goods_changed';end if;
 if private.goods_aggregation_owner(good.id)<>good.id then raise check_violation using message='goods_aggregation_policy_owned_by_source';end if;
 select * into previous from private.shipping_charge_group_assignments where owner_good_id=good.id;
 if coalesce(previous.revision,0)<>p_expected_assignment_revision or previous.version_id is distinct from p_expected_assignment_version_id then
  raise sqlstate 'PT409' using message='shipping_charge_group_assignment_changed';end if;
 if good.origin_id is null and p_group_id is null and previous.group_id is null then
  if p_expected_origin_updated_at is not null then raise sqlstate 'PT409' using message='shipping_charge_group_origin_changed';end if;
  perform 1 from private.goods_transaction_runtime where singleton and enabled for share nowait;
  if not found then raise check_violation using message='checkout_contract_upgrade_required';end if;
  return guard;
 end if;
 select * into origin from public.fulfillment_origins where id=good.origin_id for share nowait;
 if not found or (p_group_id is not null and not origin.is_active) then raise check_violation using message='shipping_charge_group_origin_unavailable';end if;
 if origin.updated_at is distinct from p_expected_origin_updated_at then raise sqlstate 'PT409' using message='shipping_charge_group_origin_changed';end if;
 select * into group_row from private.shipping_charge_groups where id=p_group_id for share nowait;
 if p_group_id is not null and (not found or group_row.revision<>p_expected_group_revision) then
  raise sqlstate 'PT409' using message='shipping_charge_group_changed';end if;
 perform 1 from private.goods_transaction_runtime where singleton for share nowait;
 perform 1 from private.shipping_collect_contracts where origin_id=origin.id for share nowait;
 blocker:=private.shipping_charge_group_assignment_blocker(good,p_group_id,p_group_id is null);
 if blocker is not null then raise check_violation using message=blocker;end if;
 if previous.group_id is not distinct from p_group_id then return guard;end if;
 assignment_id:=coalesce(previous.id,gen_random_uuid());revision:=coalesce(previous.revision,0)+1;
 insert into private.shipping_charge_group_assignments(id,owner_good_id,group_id,revision,version_id,updated_by)
 values(assignment_id,good.id,p_group_id,revision,version_id,p_actor)
 on conflict(owner_good_id) do update set group_id=excluded.group_id,revision=excluded.revision,version_id=excluded.version_id,
  updated_by=p_actor,updated_at=greatest(clock_timestamp(),private.shipping_charge_group_assignments.updated_at+interval '1 microsecond');
 insert into private.shipping_charge_group_assignment_versions(id,assignment_id,revision,owner_good_id_at_write,origin_id,group_id,group_revision,created_by,session_id,operation_id)
 values(version_id,assignment_id,revision,good.id,origin.id,p_group_id,case when p_group_id is null then null else p_expected_group_revision end,p_actor,p_session,p_operation_id);
 -- Only templates which explicitly owned group assignment detach. A legacy or
 -- preserve directive still owns its original fields. The caller can attach its
 -- newly-applied template after this helper returns.
 if good.shipping_settings_snapshot#>>'{settings,chargeGroup,mode}' in('assign','clear')
  and good.shipping_settings_snapshot#>>'{appliedChargeGroup,groupId}' is distinct from p_group_id::text then
  update public.goods set updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond'),
   shipping_settings_template_id=null,shipping_settings_template_revision=null,shipping_settings_snapshot=null where id=good.id returning * into good;
 else
  update public.goods set updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=good.id returning * into good;
 end if;
 perform private.assert_shipping_charge_group_owner_assignment(good.id);
 return private.shipping_charge_group_good_guard(good);
exception when lock_not_available then raise sqlstate 'PT409' using message='shipping_charge_group_retry';
end $$;

create function private.validate_shipping_charge_group_assignment(p_request jsonb) returns void
language plpgsql immutable set search_path='' as $$declare row jsonb;begin
 if not private.transaction_json_keys(p_request,array['operationId','command','groupId','expectedRevision','expectedActorId','expectedSessionId','origins','goods'])
  or p_request->>'command'<>'assign' or jsonb_typeof(p_request->'goods') is distinct from 'array'
  or jsonb_typeof(p_request->'origins') is distinct from 'array' or octet_length(p_request::text)>2097152 then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_assignment';end if;
 if jsonb_array_length(p_request->'goods') not between 1 and 100 or jsonb_array_length(p_request->'origins') not between 0 and 100 then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_targets';end if;
 for row in select value from jsonb_array_elements(p_request->'goods') loop
  if not private.transaction_json_keys(row,array['id','updatedAt','ownerGoodId','ownerUpdatedAt','familyGoodIds','transactionRevision','deliveryVersionId',
   'originId','assignmentRevision','assignmentVersionId','groupId','groupRevision'])
   or not private.shipping_settings_good_id(row->'id') or not private.shipping_settings_good_id(row->'ownerGoodId')
   or not private.transaction_instant_valid(row->'updatedAt') or not private.transaction_instant_valid(row->'ownerUpdatedAt')
   or not private.transaction_uint(row->'transactionRevision',0,2147483646) or not private.transaction_uint(row->'assignmentRevision',0,2147483646)
   or not (private.shipping_settings_uuid(row->'originId') or (p_request->'groupId'='null'::jsonb and row->'originId'='null'::jsonb and row->'groupId'='null'::jsonb))
   or not (row->'deliveryVersionId'='null'::jsonb or private.shipping_settings_uuid(row->'deliveryVersionId'))
   or not (row->'assignmentVersionId'='null'::jsonb or private.shipping_settings_uuid(row->'assignmentVersionId'))
   or ((row->'assignmentVersionId'='null'::jsonb) is distinct from (row->>'assignmentRevision'='0'))
   or not (row->'groupId'='null'::jsonb or private.shipping_settings_uuid(row->'groupId'))
   or not (row->'groupRevision'='null'::jsonb or private.transaction_uint(row->'groupRevision',1,2147483647))
   or ((row->'groupId'='null'::jsonb) is distinct from (row->'groupRevision'='null'::jsonb))
   or jsonb_typeof(row->'familyGoodIds') is distinct from 'array' then
   raise invalid_parameter_value using message='invalid_shipping_charge_group_assignment';end if;
  if jsonb_array_length(row->'familyGoodIds') not between 1 and 100 or exists(select 1 from jsonb_array_elements(row->'familyGoodIds') id
   where not private.shipping_settings_good_id(id)) then raise invalid_parameter_value using message='invalid_shipping_charge_group_assignment';end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_request->'goods'))<>jsonb_array_length(p_request->'goods') then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_targets';end if;
 for row in select value from jsonb_array_elements(p_request->'origins') loop
  if not private.transaction_json_keys(row,array['id','name','updatedAt','defaultCarrier','isActive','defaultGroupId','defaultGroupRevision'])
   or not private.shipping_settings_uuid(row->'id') or not private.transaction_instant_valid(row->'updatedAt')
   or jsonb_typeof(row->'name') is distinct from 'string' or char_length(row->>'name')>500
   or jsonb_typeof(row->'defaultCarrier') not in('string','null') or jsonb_typeof(row->'isActive') is distinct from 'boolean'
   or not (row->'defaultGroupId'='null'::jsonb or private.shipping_settings_uuid(row->'defaultGroupId'))
   or not private.transaction_uint(row->'defaultGroupRevision',0,2147483646)
   or ((row->'defaultGroupId'='null'::jsonb) is distinct from (row->>'defaultGroupRevision'='0')) then
   raise invalid_parameter_value using message='invalid_shipping_charge_group_assignment';end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_request->'origins'))<>jsonb_array_length(p_request->'origins')
  or exists(select value->>'originId' from jsonb_array_elements(p_request->'goods') where value->>'originId' is not null except select value->>'id' from jsonb_array_elements(p_request->'origins'))
  or exists(select value->>'id' from jsonb_array_elements(p_request->'origins') except select value->>'originId' from jsonb_array_elements(p_request->'goods') where value->>'originId' is not null) then
  raise invalid_parameter_value using message='invalid_shipping_charge_group_assignment';end if;
end $$;
create function public.admin_assign_shipping_charge_group(p_request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare context jsonb;request_hash text;receipt jsonb;ids text[];target text;good public.goods;origin public.fulfillment_origins;
 row jsonb;actual jsonb;expected_origin jsonb;results jsonb:='[]';group_row private.shipping_charge_groups;
begin
 context:=private.shipping_charge_group_context(p_request);
 perform private.require_shipping_charge_group_identity((context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
 perform private.validate_shipping_charge_group_assignment(p_request);
 p_request:=jsonb_set(jsonb_set(p_request,'{goods}',(select jsonb_agg(value order by value->>'id') from jsonb_array_elements(p_request->'goods'))),
  '{origins}',(select coalesce(jsonb_agg(value order by value->>'id'),'[]') from jsonb_array_elements(p_request->'origins')));
 request_hash:=encode(extensions.digest(p_request::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('shipping-charge-group-operation:'||(context->>'operationId'),0));
 receipt:=private.shipping_charge_group_prior(context,request_hash);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));
 select array_agg(value->>'id' order by value->>'id') into ids from jsonb_array_elements(p_request->'goods');
 foreach target in array ids loop
  if not pg_try_advisory_xact_lock(hashtextextended('admin_good:'||target,0)) then raise sqlstate 'PT409' using message='shipping_charge_group_retry';end if;
 end loop;
 perform 1 from public.goods where id=any(ids) order by id for update nowait;
 if (select count(*) from public.goods where id=any(ids) and archived_at is null)<>cardinality(ids) then
  raise no_data_found using message='shipping_charge_group_goods_unavailable';end if;
 perform 1 from private.goods_transaction_configs where good_id=any(ids) order by good_id for share nowait;
 perform 1 from public.fulfillment_origins where id in(select (value->>'id')::uuid from jsonb_array_elements(p_request->'origins')) order by id for share nowait;
 for expected_origin in select value from jsonb_array_elements(p_request->'origins') loop
  if private.shipping_charge_group_origin((expected_origin->>'id')::uuid) is distinct from expected_origin then
   raise sqlstate 'PT409' using message='shipping_charge_group_origin_changed';end if;
 end loop;
 select * into group_row from private.shipping_charge_groups where id=(context->>'groupId')::uuid for share nowait;
 if context->>'groupId' is not null and (not found or group_row.revision<>(context->>'expectedRevision')::integer) then
  raise sqlstate 'PT409' using message='shipping_charge_group_changed';end if;
 perform 1 from private.shipping_charge_group_assignments where owner_good_id=any(ids) order by owner_good_id for update nowait;
 for good in select * from public.goods where id=any(ids) order by id loop
  select value into row from jsonb_array_elements(p_request->'goods') where value->>'id'=good.id;
  actual:=private.shipping_charge_group_good_guard(good);
  -- Compare timestamps as instants; preserve their microseconds in the DTO.
  if (actual-array['updatedAt','ownerUpdatedAt']) is distinct from (row-array['updatedAt','ownerUpdatedAt'])
   or (actual->>'updatedAt')::timestamptz is distinct from (row->>'updatedAt')::timestamptz
   or (actual->>'ownerUpdatedAt')::timestamptz is distinct from (row->>'ownerUpdatedAt')::timestamptz then
   raise sqlstate 'PT409' using message='shipping_charge_group_goods_changed';end if;
 end loop;
 for good in select * from public.goods where id=any(ids) order by id loop
  select value into row from jsonb_array_elements(p_request->'goods') where value->>'id'=good.id;
  select * into origin from public.fulfillment_origins where id=good.origin_id;
  actual:=private.apply_shipping_charge_group_assignment_locked(good.id,(context->>'groupId')::uuid,(context->>'expectedRevision')::integer,
   (row->>'assignmentRevision')::integer,(row->>'assignmentVersionId')::uuid,
   array(select jsonb_array_elements_text(row->'familyGoodIds')),good.updated_at,origin.updated_at,
   (context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,(context->>'expectedSessionId')::uuid);
  results:=results||jsonb_build_array(actual);
 end loop;
 receipt:=private.shipping_charge_group_receipt(context,'assigned',private.shipping_charge_group_document((context->>'groupId')::uuid),null,results);
 insert into public.audit_log(id,actor_id,action,target,diff) values((context->>'operationId')::uuid,(context->>'expectedActorId')::uuid,
  'catalog.shipping_charge_group.assigned','shipping_charge_groups:'||coalesce(context->>'groupId','clear'),
  jsonb_build_object('context',context,'before',p_request->'goods','after',results));
 perform private.record_shipping_charge_group_operation(context,request_hash,receipt);return receipt;
exception when lock_not_available then raise sqlstate 'PT409' using message='shipping_charge_group_retry';
end $$;

-- Keep the old origin matcher untouched. This pure group-policy matcher uses
-- the same postcode and address-boundary rules, with no origin lookup/fallback.
create function private.shipping_charge_group_region_match(p_policy jsonb,p_destination jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare destination jsonb:=private.shipping_region_destination(p_destination);rule jsonb;matched jsonb;postal_count integer:=0;matched_count integer:=0;status text;fee bigint;
begin
 if destination is null then return jsonb_build_object('status','address_required','fee',null,'ruleId',null);end if;
 for rule in select value from jsonb_array_elements(p_policy->'rules')
  where value->>'postalFrom'<=destination->>'postalCode' and destination->>'postalCode'<=value->>'postalTo' loop
  postal_count:=postal_count+1;
  if rule->>'addressPrefix'='' or destination->>'address1'=rule->>'addressPrefix'
   or starts_with(destination->>'address1',(rule->>'addressPrefix')||' ') then matched_count:=matched_count+1;matched:=rule;end if;
 end loop;
 if matched_count>1 or (postal_count>0 and matched_count=0) then status:='manual_review';matched:=null;
 elsif matched_count=1 then status:=matched->>'disposition';else status:=p_policy->>'unlistedDisposition';end if;
 if status='standard' then fee:=0;
 elsif status='surcharge' then
  if not private.transaction_uint(matched->'amount',0,1000000) then raise check_violation using message='shipping_charge_group_region_unavailable';end if;
  fee:=(matched->>'amount')::bigint;
 elsif coalesce(status,'') not in('manual_review','unavailable') then status:='manual_review';end if;
 return jsonb_build_object('status',status,'fee',fee,'ruleId',matched->'id','regionLabel',matched->'regionLabel',
  'destinationPostalCode',destination->>'postalCode','matchedAddressPrefix',nullif(matched->>'addressPrefix',''));
end $$;
create function private.shipping_charge_group_public_details(p_raw_group jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('version',1,'unassignedBaseFee',p_raw_group#>'{chargeGroupContract,unassignedBaseFee}',
  'originRegionalFee',p_raw_group#>'{chargeGroupContract,originRegionalFee}',
  'originRegionFeeUnit',p_raw_group#>'{chargeGroupContract,originRegionFeeUnit}',
  'groups',coalesce((select jsonb_agg(jsonb_build_object('groupId',g->'groupId','revision',g->'revision','mode',g->'mode',
   'quantity',g->'quantity','subtotal',g->'subtotal','baseFee',g->'baseFee','regionalFee',g->'regionalFee','regionMode',g->'regionMode',
   'goodIds',(select jsonb_agg(t->'goodId' order by t->>'goodId') from jsonb_array_elements(p_raw_group->'deliveryTerms') t
    where t->>'chargeGroupId'=g->>'groupId')) order by g->>'groupId')
   from jsonb_array_elements(p_raw_group#>'{chargeGroupContract,groups}') g),'[]'));
$$;
create function private.shipping_charge_group_display(p_raw_group jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('originId',p_raw_group->'originId','prepaidFee',p_raw_group->'prepaidFee','collectFee',p_raw_group->'collectFee',
  'fullFee',p_raw_group->'fullFee','components',p_raw_group->'components','collector',p_raw_group->'collector')
  ||case when p_raw_group ? 'chargeDetails' then jsonb_build_object('chargeDetails',p_raw_group->'chargeDetails') else '{}'::jsonb end;
$$;

create function private.shipping_charge_group_safe_details(p_details jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$declare item jsonb;begin
 if not private.transaction_json_keys(p_details,array['version','unassignedBaseFee','originRegionalFee','originRegionFeeUnit','groups'])
  or p_details->'version'<>'1'::jsonb or not private.transaction_uint(p_details->'unassignedBaseFee',0,9007199254740991)
  or not private.transaction_uint(p_details->'originRegionalFee',0,9007199254740991)
  or not (p_details->'originRegionFeeUnit'='null'::jsonb or p_details->>'originRegionFeeUnit' in('per_shipment','per_good'))
  or jsonb_typeof(p_details->'groups') is distinct from 'array' then raise check_violation using message='shipping_charge_group_public_contract_invalid';end if;
 if jsonb_array_length(p_details->'groups') not between 1 and 19239 then raise check_violation using message='shipping_charge_group_public_contract_invalid';end if;
 for item in select value from jsonb_array_elements(p_details->'groups') loop
  if not private.transaction_json_keys(item,array['groupId','revision','mode','quantity','subtotal','baseFee','regionalFee','regionMode','goodIds'])
   or not private.shipping_settings_uuid(item->'groupId') or not private.transaction_uint(item->'revision',1,2147483647)
   or coalesce(item->>'mode','') not in('min','max') or not private.transaction_uint(item->'quantity',1,9007199254740991)
   or not private.transaction_uint(item->'subtotal',0,9007199254740991) or not private.transaction_uint(item->'baseFee',0,9007199254740991)
   or not private.transaction_uint(item->'regionalFee',0,9007199254740991) or coalesce(item->>'regionMode','') not in('inherit','override')
   or (item->>'regionMode'='inherit' and item->>'regionalFee'<>'0') or jsonb_typeof(item->'goodIds') is distinct from 'array' then
   raise check_violation using message='shipping_charge_group_public_contract_invalid';end if;
 end loop;
 return p_details;
end $$;

create function private.shipping_charge_group_effective_lines(p_owner_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare grouped jsonb:='[]';input record;delivery private.goods_delivery_versions;assignment private.shipping_charge_group_assignments;
 group_row private.shipping_charge_groups;group_version private.shipping_charge_group_versions;origin public.fulfillment_origins;fee numeric;line jsonb;
begin
 for input in select good_id,origin_id,sum(qty::numeric) qty,sum(qty::numeric*unit_price) subtotal,max(fee_type) fee_type,max(individual_fee) individual_fee
  from jsonb_to_recordset(p_owner_lines) l(good_id text,origin_id uuid,qty integer,unit_price bigint,fee_type text,individual_fee bigint)
  group by good_id,origin_id order by good_id loop
  if input.qty not between 1 and 9007199254740991 or input.subtotal not between 0 and 9007199254740991 then
   raise numeric_value_out_of_range using message='transaction_amount_overflow';end if;
  select * into origin from public.fulfillment_origins where id=input.origin_id and is_active;
  if not found then raise check_violation using message='fulfillment_origin_inactive';end if;
  select d.* into delivery from private.goods_transaction_configs c join private.goods_delivery_versions d on d.id=c.delivery_version_id
   where c.good_id=input.good_id and d.status='active';
  fee:=case when delivery.quantity_terms is not null then private.goods_quantity_delivery_fee(input.qty,delivery.quantity_terms)
   when input.fee_type='individual' then input.individual_fee else 0 end;
  select * into assignment from private.shipping_charge_group_assignments where owner_good_id=input.good_id;
  group_row:=null;group_version:=null;
  if assignment.group_id is not null then
   select * into group_row from private.shipping_charge_groups where id=assignment.group_id;
   select * into group_version from private.shipping_charge_group_versions where id=group_row.version_id;
   if group_row.id is null or group_row.origin_id is distinct from input.origin_id
    or not coalesce((group_version.policy_values->>'enabled')::boolean,false) or coalesce((group_version.policy_values->>'archived')::boolean,true) then
    raise check_violation using message='shipping_charge_group_unavailable';end if;
  end if;
  line:=jsonb_build_object('goodId',input.good_id,'originId',input.origin_id,'qty',input.qty,'subtotal',input.subtotal,
   'feeType',case when delivery.quantity_terms is not null then 'individual' else input.fee_type end,'individualFee',fee,'configuredPaymentMode',coalesce(delivery.payment_mode,'prepaid'),
   'deliveryPolicyId',delivery.id,'deliveryPolicyRevision',delivery.revision,'quantityTerms',delivery.quantity_terms,
   'chargeGroupId',assignment.group_id,'assignmentVersionId',assignment.version_id,'assignmentRevision',coalesce(assignment.revision,0),
   'groupVersionId',group_row.version_id,'groupRevision',group_row.revision,'regionMode',coalesce(group_version.policy_values#>>'{regional,mode}','inherit'));
  grouped:=grouped||jsonb_build_array(line);
 end loop;
 return grouped;
end $$;

-- Read-only basic-charge synthesis shared by full checkout and shipping-savings
-- comparisons. Input is the output of shipping_charge_group_effective_lines.
create function private.calculate_shipping_charge_group_base(p_effective_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare grouped jsonb:=p_effective_lines;all_shipping_lines jsonb;unassigned_lines jsonb;unassigned_quote jsonb;
 raw_group jsonb;group_lines jsonb;policy_subtotal numeric;policy_rows jsonb;allocation jsonb;base_allocations jsonb:='{}';line jsonb;
 group_row private.shipping_charge_groups;group_version private.shipping_charge_group_versions;origin public.fulfillment_origins;
 group_quantity numeric;group_subtotal numeric;group_fee numeric;candidate numeric;zero_candidate boolean;weights jsonb;
 region_result jsonb;group_regional_fee numeric;region_policy jsonb;group_contract jsonb;group_contracts jsonb:='[]';total_fee numeric;
begin
 select coalesce(jsonb_agg(jsonb_build_object('origin_id',value->'originId','good_id',value->'goodId','qty',1,'unit_price',value->'subtotal',
  'fee_type',value->'feeType','individual_fee',value->'individualFee') order by value->>'goodId'),'[]') into all_shipping_lines from jsonb_array_elements(grouped);
 -- Unassigned goods retain the old basic policy aggregation within their own
 -- subset. The all-unassigned fast path never reaches this function.
 select coalesce(jsonb_agg(s order by s->>'good_id'),'[]') into unassigned_lines from jsonb_array_elements(all_shipping_lines) s
 where exists(select 1 from jsonb_array_elements(grouped) g where g->>'goodId'=s->>'good_id' and g->>'chargeGroupId' is null);
 unassigned_quote:=private.calculate_goods_shipping(unassigned_lines);
 for raw_group in select value from jsonb_array_elements(unassigned_quote->'groups') loop
  select coalesce(jsonb_agg(value order by value->>'goodId'),'[]') into group_lines from jsonb_array_elements(grouped)
   where value->>'originId'=raw_group->>'originId' and value->>'chargeGroupId' is null;
  select coalesce(sum((value->>'subtotal')::numeric),0) into policy_subtotal from jsonb_array_elements(group_lines) where value->>'feeType'='policy';
  select coalesce(jsonb_agg(jsonb_build_object('id',value->>'goodId','weight',case when policy_subtotal>0 then (value->>'subtotal')::numeric else (value->>'qty')::numeric end)),'[]')
   into policy_rows from jsonb_array_elements(group_lines) where value->>'feeType'='policy';
  allocation:=case when jsonb_array_length(policy_rows)>0 then private.allocate_transaction_amount((raw_group->>'policyFee')::numeric,policy_rows) else '{}'::jsonb end;
  for line in select value from jsonb_array_elements(group_lines) loop
   base_allocations:=base_allocations||jsonb_build_object(line->>'goodId',case when line->>'feeType'='policy' then (allocation->>(line->>'goodId'))::numeric else (line->>'individualFee')::numeric end);
  end loop;
 end loop;
 -- Evaluate every purchased member's effective policy at the same group Q/S.
 for group_row in select g.* from private.shipping_charge_groups g where g.id in(select (value->>'chargeGroupId')::uuid from jsonb_array_elements(grouped)) order by g.id loop
  select * into group_version from private.shipping_charge_group_versions where id=group_row.version_id;
  select * into origin from public.fulfillment_origins where id=group_row.origin_id;
  select jsonb_agg(value order by value->>'goodId'),sum((value->>'qty')::numeric),sum((value->>'subtotal')::numeric)
   into group_lines,group_quantity,group_subtotal from jsonb_array_elements(grouped) where value->>'chargeGroupId'=group_row.id::text;
  if group_quantity>9007199254740991 or group_subtotal>9007199254740991 then raise numeric_value_out_of_range using message='transaction_amount_overflow';end if;
  group_fee:=null;zero_candidate:=false;
  for line in select value from jsonb_array_elements(group_lines) loop
   candidate:=case when line->'quantityTerms'<>'null'::jsonb then private.goods_quantity_delivery_fee(group_quantity,line->'quantityTerms')
    when line->>'feeType'='free' then 0 when line->>'feeType'='individual' then (line->>'individualFee')::numeric
    when line->>'feeType'='policy' then case when group_subtotal=0 or (origin.free_threshold is not null and group_subtotal>=origin.free_threshold) then 0 else origin.base_fee end end;
   if candidate is null or candidate<0 then raise check_violation using message='shipping_charge_group_fee_unresolved';end if;
   zero_candidate:=zero_candidate or candidate=0;
   group_fee:=case when group_fee is null then candidate when group_version.policy_values->>'calculationMode'='min' then least(group_fee,candidate) else greatest(group_fee,candidate) end;
  end loop;
  if zero_candidate then group_fee:=0;end if;
  select jsonb_agg(jsonb_build_object('id',value->>'goodId','weight',case when group_subtotal>0 then (value->>'subtotal')::numeric else (value->>'qty')::numeric end))
   into weights from jsonb_array_elements(group_lines);
  allocation:=private.allocate_transaction_amount(group_fee,weights);base_allocations:=base_allocations||allocation;
  region_result:=null;group_regional_fee:=0;region_policy:=null;
  group_contract:=jsonb_build_object('groupId',group_row.id,'originId',group_row.origin_id,'revision',group_row.revision,'versionId',group_row.version_id,
   'mode',group_version.policy_values->>'calculationMode','quantity',group_quantity,'subtotal',group_subtotal,'baseFee',group_fee,
   'freeReason',case when zero_candidate then 'zero_candidate' end,'regionalFee',group_regional_fee,
   'regionMode',group_version.policy_values#>>'{regional,mode}','regionalFeeUnit',case when group_version.policy_values#>>'{regional,mode}'='override' then 'per_charge_group' end,
   'versionSnapshot',to_jsonb(group_version),'regionResult',region_result,
   'members',(select jsonb_agg(jsonb_build_object('ownerGoodId',value->>'goodId','assignmentVersionId',value->'assignmentVersionId',
    'assignmentRevision',value->'assignmentRevision') order by value->>'goodId') from jsonb_array_elements(group_lines)));
  group_contracts:=group_contracts||jsonb_build_array(group_contract);
 end loop;
 select coalesce(sum(value::numeric),0) into total_fee from jsonb_each_text(base_allocations);
 if total_fee>9007199254740991 then raise numeric_value_out_of_range using message='transaction_amount_overflow';end if;
 return jsonb_build_object('baseAllocations',base_allocations,'unassignedQuote',unassigned_quote,'groups',group_contracts,'totalFee',total_fee);
end $$;

create function private.calculate_shipping_charge_group_shipping(p_lines jsonb,p_destination jsonb,p_choices jsonb,p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare grouped jsonb:='[]';payment_lines jsonb:='[]';base_result jsonb;input record;delivery private.goods_delivery_versions;assignment private.shipping_charge_group_assignments;
 group_row private.shipping_charge_groups;group_version private.shipping_charge_group_versions;origin public.fulfillment_origins;
 payment_mode text;fee numeric;group_quantity numeric;group_subtotal numeric;candidate numeric;group_fee numeric;zero_candidate boolean;
 group_lines jsonb;line jsonb;weights jsonb;allocation jsonb;base_allocations jsonb:='{}';regional_allocations jsonb:='{}';
 all_shipping_lines jsonb:='[]';unassigned_lines jsonb;inherited_lines jsonb;unassigned_quote jsonb;inherited_quote jsonb;raw_region jsonb;
 policy private.shipping_region_policies;policy_rows jsonb;policy_subtotal numeric;eligible_rows jsonb;eligible boolean;basis_sum numeric;basis_subtotal numeric;basis text;
 group_contracts jsonb:='[]';group_contract jsonb;region_policy jsonb;region_result jsonb;group_regional_fee numeric;group_change timestamptz;next_change timestamptz;
 raw_groups jsonb:='[]';display_groups jsonb:='[]';raw_group jsonb;origin_lines jsonb;origin_groups jsonb;components jsonb;component jsonb;terms jsonb;delivery_terms jsonb;
 origin_unassigned_base numeric;origin_regional_fee numeric;origin_region_unit text;prepaid numeric;collect numeric;prepaid_total numeric:=0;collect_total numeric:=0;
 contract private.shipping_collect_contract_versions;collector jsonb;contract_id uuid;region_source jsonb;full_fee numeric;
begin
 if p_at is null or not isfinite(p_at) then raise invalid_parameter_value using message='shipping_quote_time_invalid';end if;
 -- The caller already collapsed families to their owner. Quantities and S are
 -- sums of actual selections, never display siblings or unrelated goods.
 grouped:=private.shipping_charge_group_effective_lines(p_lines);
 for line in select value from jsonb_array_elements(grouped) loop
  payment_mode:=case when line->>'configuredPaymentMode'='buyer_choice' then coalesce(p_choices->>(line->>'goodId'),'prepaid') else line->>'configuredPaymentMode' end;
  if payment_mode not in('prepaid','collect') or (p_choices ? (line->>'goodId') and line->>'configuredPaymentMode'<>'buyer_choice'
   and p_choices->>(line->>'goodId')<>line->>'configuredPaymentMode') then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','delivery_choice_required','goodId',line->>'goodId')));end if;
  payment_lines:=payment_lines||jsonb_build_array((line-'configuredPaymentMode')||jsonb_build_object('paymentMode',payment_mode));
  regional_allocations:=regional_allocations||jsonb_build_object(line->>'goodId',0);
 end loop;
 grouped:=payment_lines;
 select coalesce(jsonb_agg(jsonb_build_object('origin_id',value->'originId','good_id',value->'goodId','qty',1,'unit_price',value->'subtotal',
  'fee_type',value->'feeType','individual_fee',value->'individualFee') order by value->>'goodId'),'[]') into all_shipping_lines from jsonb_array_elements(grouped);
 base_result:=private.calculate_shipping_charge_group_base(grouped);
 base_allocations:=base_result->'baseAllocations';unassigned_quote:=base_result->'unassignedQuote';
 for group_contract in select value from jsonb_array_elements(base_result->'groups') loop
  select * into group_row from private.shipping_charge_groups where id=(group_contract->>'groupId')::uuid;
  select * into group_version from private.shipping_charge_group_versions where id=group_row.version_id;
  select * into origin from public.fulfillment_origins where id=group_row.origin_id;
  select jsonb_agg(value order by value->>'goodId') into group_lines from jsonb_array_elements(grouped) where value->>'chargeGroupId'=group_row.id::text;
  group_subtotal:=(group_contract->>'subtotal')::numeric;
  select jsonb_agg(jsonb_build_object('id',value->>'goodId','weight',case when group_subtotal>0 then (value->>'subtotal')::numeric else (value->>'qty')::numeric end))
   into weights from jsonb_array_elements(group_lines);
  region_result:=null;group_regional_fee:=0;region_policy:=null;
  if group_version.policy_values#>>'{regional,mode}'='override' then
   region_policy:=group_version.policy_values#>'{regional,policy}';
   if group_version.regional_confirmed_by is null or region_policy->>'startsAt' is null
    or (region_policy->>'startsAt')::timestamptz>p_at
    or (region_policy->>'endsAt' is not null and p_at>=(region_policy->>'endsAt')::timestamptz)
    or region_policy->>'carrierCode' is distinct from origin.default_carrier
    or not exists(select 1 from public.shipping_carriers where code=region_policy->>'carrierCode' and is_active) then
    return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','shipping_unresolved','goodId',null)));end if;
   group_change:=(region_policy->>'endsAt')::timestamptz;next_change:=least(next_change,group_change);
   region_result:=private.shipping_charge_group_region_match(region_policy,p_destination);
   if region_result->>'fee' is null then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','shipping_unresolved','goodId',null)));end if;
   group_regional_fee:=(region_result->>'fee')::numeric;
   -- Group override uses S/Q directly, not a rounded basic-fee allocation.
   regional_allocations:=regional_allocations||private.allocate_transaction_amount(group_regional_fee,weights);
  end if;
  group_contract:=group_contract||jsonb_build_object('regionalFee',group_regional_fee,'regionResult',region_result);
  group_contracts:=group_contracts||jsonb_build_array(group_contract);
 end loop;
 -- Origin regional policy sees only inherited/unassigned effective members.
 -- Its own policy subtotal excludes all explicit group overrides.
 select coalesce(jsonb_agg(s order by s->>'good_id'),'[]') into inherited_lines from jsonb_array_elements(all_shipping_lines) s
 where exists(select 1 from jsonb_array_elements(grouped) g where g->>'goodId'=s->>'good_id' and g->>'regionMode'='inherit');
 inherited_quote:=private.apply_shipping_region_quote(private.calculate_goods_shipping(inherited_lines),inherited_lines,p_destination,p_at);
 if not(inherited_quote->>'checkoutAllowed')::boolean then
  return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','shipping_unresolved','goodId',null)));end if;
 next_change:=least(next_change,(inherited_quote->>'nextChangeAt')::timestamptz);
 for raw_region in select value from jsonb_array_elements(inherited_quote->'groups') loop
  policy:=null;if raw_region->>'policyId' is not null then select * into policy from private.shipping_region_policies where id=(raw_region->>'policyId')::uuid;end if;
  eligible_rows:='[]';
  for line in select value from jsonb_array_elements(grouped) where value->>'originId'=raw_region->>'originId' and value->>'regionMode'='inherit' loop
   eligible:=policy.id is not null and raw_region->>'regionStatus'='surcharge' and case line->>'feeType'
    when 'policy' then (policy.configuration->>'chargePolicyGoods')::boolean and not((policy.configuration->>'waivePolicyThreshold')::boolean
     and raw_region->>'freeThreshold' is not null and (raw_region->>'policySubtotal')::numeric>=(raw_region->>'freeThreshold')::numeric)
    when 'free' then (policy.configuration->>'chargeFreeGoods')::boolean else (policy.configuration->>'chargeIndividualGoods')::boolean end;
   if eligible then eligible_rows:=eligible_rows||jsonb_build_array(line);end if;
  end loop;
  if jsonb_array_length(eligible_rows)>0 then
   if raw_region->>'feeUnit'='per_good' then
    select jsonb_object_agg(value->>'goodId',(raw_region->>'regionalContractFee')::numeric) into allocation from jsonb_array_elements(eligible_rows);
   else
    select sum((base_allocations->>(value->>'goodId'))::numeric),sum((value->>'subtotal')::numeric) into basis_sum,basis_subtotal from jsonb_array_elements(eligible_rows);
    basis:=case when basis_sum>0 then 'base' when basis_subtotal>0 then 'subtotal' else 'qty' end;
    select jsonb_agg(jsonb_build_object('id',value->>'goodId','weight',case when basis='base' then (base_allocations->>(value->>'goodId'))::numeric else (value->>basis)::numeric end))
     into weights from jsonb_array_elements(eligible_rows);
    allocation:=private.allocate_transaction_amount((raw_region->>'regionalFee')::numeric,weights);
   end if;
   regional_allocations:=regional_allocations||allocation;
  end if;
 end loop;
 -- One output row per physical origin, with one component per effective owner.
 -- The unchanged family expander then splits those components to actual goods.
 for origin in select * from public.fulfillment_origins where id in(select (value->>'originId')::uuid from jsonb_array_elements(grouped)) order by code,id loop
  select jsonb_agg(value order by value->>'goodId') into origin_lines from jsonb_array_elements(grouped) where value->>'originId'=origin.id::text;
  select coalesce(jsonb_agg(value order by value->>'groupId'),'[]') into origin_groups from jsonb_array_elements(group_contracts) where value->>'originId'=origin.id::text;
  select coalesce(sum((base_allocations->>(value->>'goodId'))::numeric),0) into origin_unassigned_base from jsonb_array_elements(origin_lines) where value->>'chargeGroupId' is null;
  select value into raw_region from jsonb_array_elements(inherited_quote->'groups') where value->>'originId'=origin.id::text;
  origin_regional_fee:=coalesce((raw_region->>'regionalFee')::numeric,0);origin_region_unit:=raw_region->>'feeUnit';
  policy:=null;if raw_region->>'policyId' is not null then select * into policy from private.shipping_region_policies where id=(raw_region->>'policyId')::uuid;end if;
  components:='[]';delivery_terms:='[]';prepaid:=0;collect:=0;contract:=null;collector:=null;contract_id:=null;
  for line in select value from jsonb_array_elements(origin_lines) loop
   fee:=(base_allocations->>(line->>'goodId'))::numeric+(regional_allocations->>(line->>'goodId'))::numeric;
   component:=jsonb_build_object('goodId',line->>'goodId','paymentMode',line->>'paymentMode','baseFee',(base_allocations->>(line->>'goodId'))::numeric,
    'regionalFee',(regional_allocations->>(line->>'goodId'))::numeric,'totalFee',fee,'deliveryPolicyId',line->'deliveryPolicyId');
   components:=components||jsonb_build_array(component);
   select value into group_contract from jsonb_array_elements(origin_groups) where value->>'groupId'=line->>'chargeGroupId';
   region_source:=case when line->>'regionMode'='override' then jsonb_build_object('scope','group','feeUnit','per_charge_group',
     'groupVersionId',line->'groupVersionId','result',group_contract->'regionResult')
    else jsonb_build_object('scope','origin','policyId',raw_region->'policyId','policyVersion',raw_region->'policyVersion',
     'feeUnit',raw_region->'feeUnit','regionStatus',raw_region->'regionStatus','ruleId',raw_region->'ruleId','contractFee',raw_region->'regionalContractFee') end;
   terms:=line||jsonb_build_object('chargeGroupBasis',case when group_contract is null then null else group_contract-array['versionSnapshot','members','regionResult'] end,'regionalSource',region_source);
   delivery_terms:=delivery_terms||jsonb_build_array(terms);
   if line->>'paymentMode'='collect' then collect:=collect+fee;else prepaid:=prepaid+fee;end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(origin_lines) where value->>'paymentMode'='collect') then
   select v.* into contract from private.shipping_collect_contracts c join private.shipping_collect_contract_versions v on v.id=c.version_id
    where c.origin_id=origin.id and v.status='active';
   if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','collect_not_ready','goodId',null)));end if;
   contract_id:=contract.id;collector:=jsonb_build_object('name',contract.contract_values->>'collectorName','method',contract.contract_values->>'collectionMethod',
    'refundContact',contract.contract_values->>'refundContact','instructions',contract.contract_values->>'customerInstructions');
  end if;
  full_fee:=origin_unassigned_base+origin_regional_fee+(select coalesce(sum((value->>'baseFee')::numeric+(value->>'regionalFee')::numeric),0) from jsonb_array_elements(origin_groups));
  if prepaid+collect<>full_fee then raise check_violation using message='transaction_shipping_allocation_mismatch';end if;
  prepaid_total:=prepaid_total+prepaid;collect_total:=collect_total+collect;
  if prepaid_total+collect_total>9007199254740991 then raise numeric_value_out_of_range using message='transaction_amount_overflow';end if;
  raw_group:=jsonb_build_object('originId',origin.id,'originCode',origin.code,'originName',origin.name,'calculationVersion',2,
   'totalFee',prepaid,'prepaidFee',prepaid,'collectFee',collect,'fullFee',full_fee,'components',components,'collector',collector,
   'collectContractId',contract_id,'collectContractSnapshot',to_jsonb(contract),'deliveryTerms',delivery_terms,
   'chargeGroupContract',jsonb_build_object('version',1,'unassignedBaseFee',origin_unassigned_base,'originRegionalFee',origin_regional_fee,
    'originRegionFeeUnit',origin_region_unit,'originRegionPolicy',to_jsonb(policy),'originRegionResult',raw_region,'groups',origin_groups));
  raw_group:=raw_group||jsonb_build_object('chargeDetails',private.shipping_charge_group_public_details(raw_group));
  raw_groups:=raw_groups||jsonb_build_array(raw_group);display_groups:=display_groups||jsonb_build_array(private.shipping_charge_group_display(raw_group));
 end loop;
 return jsonb_build_object('state','calculated','prepaidFee',prepaid_total,'collectFee',collect_total,'rawGroups',raw_groups,'displayGroups',display_groups,'nextChangeAt',next_change);
exception when check_violation then
 if sqlerrm='shipping_charge_group_unavailable' then
  return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','shipping_unresolved','goodId',null)));end if;
 raise;
end $$;

-- Preserve the exact previous calculator as the no-assignment delegate. An
-- unrelated origin in a mixed cart also uses this exact implementation.
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.calculate_goods_transaction_shipping_families_base(jsonb,jsonb,jsonb,timestamptz)'::regprocedure);
 if strpos(definition,'private.apply_shipping_region_quote')=0 or strpos(definition,'transaction_shipping_allocation_mismatch')=0 then
  raise check_violation using message='shipping_charge_group_legacy_calculator_changed';end if;
 definition:=replace(definition,'FUNCTION private.calculate_goods_transaction_shipping_families_base(',
  'FUNCTION private.calculate_shipping_charge_groups_legacy(');execute definition;
end $$;
create or replace function private.calculate_goods_transaction_shipping_families_base(p_lines jsonb,p_destination jsonb,p_choices jsonb,p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare assigned_origins uuid[];assigned_lines jsonb;legacy_lines jsonb;assigned jsonb;legacy jsonb;raw_groups jsonb;display_groups jsonb;prepaid numeric;collect numeric;
begin
 select array_agg(distinct (l->>'origin_id')::uuid) into assigned_origins from jsonb_array_elements(p_lines) l
 join private.shipping_charge_group_assignments a on a.owner_good_id=l->>'good_id' and a.group_id is not null;
 if assigned_origins is null then return private.calculate_shipping_charge_groups_legacy(p_lines,p_destination,p_choices,p_at);end if;
 select jsonb_agg(value order by position) into assigned_lines from jsonb_array_elements(p_lines) with ordinality l(value,position)
  where (value->>'origin_id')::uuid=any(assigned_origins);
 select coalesce(jsonb_agg(value order by position),'[]') into legacy_lines from jsonb_array_elements(p_lines) with ordinality l(value,position)
  where not((value->>'origin_id')::uuid=any(assigned_origins));
 assigned:=private.calculate_shipping_charge_group_shipping(assigned_lines,p_destination,p_choices,p_at);
 if assigned->>'state'='blocked' then return assigned;end if;
 if jsonb_array_length(legacy_lines)=0 then return assigned;end if;
 legacy:=private.calculate_shipping_charge_groups_legacy(legacy_lines,p_destination,p_choices,p_at);
 if legacy->>'state'='blocked' then return legacy;end if;
 select jsonb_agg(value order by value->>'originCode',value->>'originId'),
  jsonb_agg(private.shipping_charge_group_display(value) order by value->>'originCode',value->>'originId')
 into raw_groups,display_groups from jsonb_array_elements((assigned->'rawGroups')||(legacy->'rawGroups'));
 prepaid:=(assigned->>'prepaidFee')::numeric+(legacy->>'prepaidFee')::numeric;
 collect:=(assigned->>'collectFee')::numeric+(legacy->>'collectFee')::numeric;
 if prepaid+collect>9007199254740991 then raise numeric_value_out_of_range using message='transaction_amount_overflow';end if;
 return jsonb_build_object('state','calculated','prepaidFee',prepaid,'collectFee',collect,'rawGroups',raw_groups,'displayGroups',display_groups,
  'nextChangeAt',least((assigned->>'nextChangeAt')::timestamptz,(legacy->>'nextChangeAt')::timestamptz));
end $$;

-- Group summaries must be rebuilt after the family expander has replaced owner
-- components with actual selected goods. Unselected owner IDs stay private.
do $$declare definition text;needle text;replacement text;begin
 definition:=pg_get_functiondef('private.calculate_goods_transaction_shipping(jsonb,jsonb,jsonb,timestamptz)'::regprocedure);
 needle:='raw_groups:=raw_groups||jsonb_build_array(raw_group||jsonb_build_object(''components'',components,''deliveryTerms'',delivery_terms));';
 replacement:='raw_group:=raw_group||jsonb_build_object(''components'',components,''deliveryTerms'',delivery_terms);'
  ||E'\n  if raw_group ? ''chargeDetails'' then raw_group:=raw_group||jsonb_build_object(''chargeDetails'',private.shipping_charge_group_public_details(raw_group));end if;'
  ||E'\n  raw_groups:=raw_groups||jsonb_build_array(raw_group);';
 if strpos(definition,needle)=0 then raise check_violation using message='shipping_charge_group_family_expander_changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:='display_groups:=display_groups||jsonb_build_array(jsonb_build_object(''originId'',raw_group->''originId'',''prepaidFee'',raw_group->''prepaidFee'','
  ||E'\n   ''collectFee'',raw_group->''collectFee'',''fullFee'',raw_group->''fullFee'',''components'',components,''collector'',raw_group->''collector''));';
 if strpos(definition,needle)=0 then raise check_violation using message='shipping_charge_group_family_display_changed';end if;
 definition:=replace(definition,needle,'display_groups:=display_groups||jsonb_build_array(private.shipping_charge_group_display(raw_group));');execute definition;
end $$;

-- Parent product locks also serialize first assignment, when no head exists.
-- Origin locks precede group heads in both checkout and group administration.
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.lock_goods_transaction_catalog(uuid,jsonb,uuid)'::regprocedure);
 needle:='if p_user_coupon_id is not null then';
 if strpos(definition,needle)=0 then raise check_violation using message='shipping_charge_group_checkout_locks_changed';end if;
 definition:=replace(definition,needle,
  E'perform 1 from private.shipping_charge_group_assignments a where a.owner_good_id in(select private.goods_aggregation_owner(value->>''goodId'') from jsonb_array_elements(p_selection)) order by a.owner_good_id for share;\n'
  ||E' perform 1 from private.shipping_charge_groups g where g.id in(select a.group_id from private.shipping_charge_group_assignments a where a.owner_good_id in(select private.goods_aggregation_owner(value->>''goodId'') from jsonb_array_elements(p_selection))) order by g.id for share;\n '
  ||needle);execute definition;
end $$;

-- A marker is an explicit new shape. Normal orders and gifts both use an
-- allowlist; no new internal snapshot can leak through a subtraction list.
create or replace function private.goods_transaction_public_shipping(p_source_kind text,p_raw_groups jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(case when value ? 'chargeDetails' then jsonb_build_object('calculationVersion',2,'originId',value->'originId',
  'originName',value->'originName','totalFee',value->'totalFee','prepaidFee',value->'prepaidFee','collectFee',value->'collectFee','fullFee',value->'fullFee',
  'components',value->'components','collector',value->'collector','chargeDetails',private.shipping_charge_group_safe_details(value->'chargeDetails'))
 when p_source_kind='gift' then jsonb_build_object('calculationVersion',2,'originId',value->'originId',
  'originName',value->'originName','totalFee',value->'totalFee','prepaidFee',value->'prepaidFee','collectFee',value->'collectFee','fullFee',value->'fullFee',
  'components',value->'components','collector',value->'collector')
 else value-array['collectContractSnapshot','collectContractId','deliveryTerms'] end order by value->>'originId'),'[]')
 from jsonb_array_elements(p_raw_groups);
$$;

-- New legacy orders may not ignore an explicit charge-group assignment. The
-- old successful checkout-key branch stays before every present-day guard.
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.guard_order_transaction_terms()'::regprocedure);
 needle:='elsif exists(select 1 from private.goods_aggregation_members where good_id=new.good_id) then';
 if strpos(definition,needle)=0 then raise check_violation using message='shipping_charge_group_legacy_item_guard_changed';end if;
 definition:=replace(definition,needle,
  E'elsif exists(select 1 from private.shipping_charge_group_assignments where owner_good_id=private.goods_aggregation_owner(new.good_id) and group_id is not null) then\n'
  ||E'  raise check_violation using message=''checkout_contract_upgrade_required'';\n '||needle);execute definition;
 definition:=pg_get_functiondef('public.place_order(jsonb,uuid,public.order_payment_method)'::regprocedure);
 needle:='order_key:=private.place_order_before_shipments(p_address,p_checkout_key,p_payment_method);';
 if strpos(definition,needle)=0 then raise check_violation using message='shipping_charge_group_legacy_place_guard_changed';end if;
 definition:=replace(definition,needle,
  E'if not exists(select 1 from public.orders where user_id=auth.uid() and checkout_key=p_checkout_key) and exists(select 1 from public.cart_items c join private.shipping_charge_group_assignments a on a.owner_good_id=private.goods_aggregation_owner(c.good_id) and a.group_id is not null where c.user_id=auth.uid()) then\n'
  ||E'   raise check_violation using message=''checkout_contract_upgrade_required'';end if;\n  '||needle);execute definition;
 definition:=pg_get_functiondef('private.goods_transaction_base_shipping_quote(jsonb,jsonb,timestamptz)'::regprocedure);
 needle:='AS $function$declare lines jsonb;begin';
 if strpos(definition,needle)=0 then raise check_violation using message='shipping_charge_group_legacy_quote_guard_changed';end if;
 definition:=replace(definition,needle||E'\n',needle||E'\n if exists(select 1 from jsonb_to_recordset(p_items) i("goodId" text) join private.shipping_charge_group_assignments a on a.owner_good_id=private.goods_aggregation_owner(i."goodId") and a.group_id is not null) then raise check_violation using message=''checkout_contract_upgrade_required'';end if;\n');execute definition;
end $$;

-- Retain safe versioned charge evidence after account deletion without adding
-- collector copy, address rules, or operator evidence to retained user data.
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.subscription_retention_display(jsonb,timestamptz)'::regprocedure);
 if strpos(definition,'collectorTermsHash')=0 then raise check_violation using message='shipping_charge_group_retention_shape_changed';end if;
 definition:=replace(definition,'FUNCTION private.subscription_retention_display(',
  'FUNCTION private.subscription_retention_display_before_shipping_charge_groups(');execute definition;
end $$;
create or replace function private.subscription_retention_display(p_display jsonb,p_recorded_at timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare result jsonb;shipping jsonb;begin
 result:=private.subscription_retention_display_before_shipping_charge_groups(p_display,p_recorded_at);
 if not exists(select 1 from jsonb_array_elements(p_display->'shipping') where value ? 'chargeDetails') then return result;end if;
 select jsonb_agg(retained.value||case when source.value ? 'chargeDetails'
  then jsonb_build_object('chargeDetails',private.shipping_charge_group_safe_details(source.value->'chargeDetails')) else '{}'::jsonb end order by retained.position)
 into shipping from jsonb_array_elements(result->'shipping') with ordinality retained(value,position)
 join jsonb_array_elements(p_display->'shipping') with ordinality source(value,position) on source.position=retained.position;
 return jsonb_set(result,'{shipping}',shipping);
end $$;



create function private.shipping_charge_group_public_offer(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',g.id,'revision',g.revision,'calculationMode',v.policy_values->>'calculationMode',
  'regionalMode',v.policy_values#>>'{regional,mode}','available',(v.policy_values->>'enabled')::boolean and not(v.policy_values->>'archived')::boolean
   and o.is_active and coalesce((select enabled from private.goods_transaction_runtime where singleton),false),
  'inherited',a.owner_good_id<>p_good_id)
 from private.shipping_charge_group_assignments a join private.shipping_charge_groups g on g.id=a.group_id
 join private.shipping_charge_group_versions v on v.id=g.version_id join public.fulfillment_origins o on o.id=g.origin_id
 where a.owner_good_id=private.goods_aggregation_owner(p_good_id);
$$;
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.get_goods_transaction_offers(text[])'::regprocedure);
 needle:='order by g.id),''[]'') into result';
 if strpos(definition,needle)=0 then raise check_violation using message='shipping_charge_group_public_offer_changed';end if;
 definition:=replace(definition,needle,
  E'||case when private.shipping_charge_group_public_offer(g.id) is null then ''{}''::jsonb else jsonb_build_object(''chargeGroup'',private.shipping_charge_group_public_offer(g.id)) end\n  '||needle);execute definition;
end $$;

-- Seal every new function before publishing the schema. Existing entrypoint
-- owners/ACLs stay unchanged; refresh only their canonical current fingerprints.
do $$declare fn regprocedure;item regclass;begin
 foreach item in array array['private.shipping_charge_groups'::regclass,'private.shipping_charge_group_versions'::regclass,
  'private.shipping_charge_group_assignments'::regclass,'private.shipping_charge_group_assignment_versions'::regclass,
  'private.shipping_charge_group_operations'::regclass] loop
  execute format('revoke all on %s from public,anon,authenticated,service_role',item);
  execute format('grant select,insert,update,delete on %s to postgres',item);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any(array[
  'guard_shipping_charge_group_history','require_shipping_charge_group_identity','shipping_charge_group_context','shipping_charge_group_prior',
  'shipping_charge_group_receipt','record_shipping_charge_group_operation','shipping_charge_group_document','shipping_charge_group_summary',
  'shipping_charge_group_origin','shipping_charge_group_good_guard','shipping_charge_group_region_adapter','normalize_shipping_charge_group_values',
  'shipping_charge_group_assignment_blocker','shipping_charge_group_good_row','write_shipping_charge_group_version',
  'assert_shipping_charge_group_owner_assignment','guard_shipping_charge_group_good_origin','apply_shipping_charge_group_assignment_locked',
  'validate_shipping_charge_group_assignment','shipping_charge_group_region_match','shipping_charge_group_public_details','shipping_charge_group_display',
  'shipping_charge_group_safe_details','shipping_charge_group_effective_lines','calculate_shipping_charge_group_base','calculate_shipping_charge_group_shipping',
  'calculate_shipping_charge_groups_legacy','shipping_charge_group_public_offer','subscription_retention_display_before_shipping_charge_groups']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to postgres',fn);perform private.register_operator_internal_contract(fn);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
  'admin_read_shipping_charge_group_operation','admin_seal_shipping_charge_group_operation','admin_save_shipping_charge_group',
  'admin_list_shipping_charge_groups','admin_get_shipping_charge_group','admin_get_good_shipping_charge_group',
  'admin_search_goods_for_shipping_charge_group','admin_preview_shipping_charge_group_assignment','admin_assign_shipping_charge_group']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);execute format('grant execute on function %s to authenticated',fn);
  perform private.register_operator_internal_contract(fn);
  perform private.register_operator_rpc_contract(fn,'catalog.manage',case when fn::text like '%admin_save_%' or fn::text like '%admin_seal_%'
   or fn::text like '%admin_assign_%' then 'write' else 'read' end,false);
 end loop;
 foreach fn in array array[
  'private.calculate_goods_transaction_shipping_families_base(jsonb,jsonb,jsonb,timestamptz)'::regprocedure,
  'private.calculate_goods_transaction_shipping(jsonb,jsonb,jsonb,timestamptz)'::regprocedure,
  'private.lock_goods_transaction_catalog(uuid,jsonb,uuid)'::regprocedure,
  'private.goods_transaction_public_shipping(text,jsonb)'::regprocedure,
  'private.guard_order_transaction_terms()'::regprocedure,
  'public.place_order(jsonb,uuid,public.order_payment_method)'::regprocedure,
  'private.goods_transaction_base_shipping_quote(jsonb,jsonb,timestamptz)'::regprocedure,
  'public.get_goods_transaction_offers(text[])'::regprocedure,
  'private.subscription_retention_display(jsonb,timestamptz)'::regprocedure] loop
  perform private.register_operator_internal_contract(fn);
 end loop;
end $$;
notify pgrst,'reload schema';
