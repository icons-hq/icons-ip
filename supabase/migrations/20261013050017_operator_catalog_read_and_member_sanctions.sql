-- Product editors can read shipping-region rules; writes remain platform-only.
-- Member sanctions honor configured manager roles while preserving legacy scope.

CREATE OR REPLACE FUNCTION public.admin_list_shipping_region_policies()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not coalesce(public.has_operator_capability('catalog.read',false),false) then raise insufficient_privilege using message='staff required'; end if;
  return jsonb_build_object('policies',(select coalesce(jsonb_agg(private.shipping_region_policy_record(policy)
    order by policy.origin_id,policy.carrier_code,policy.version desc),'[]') from private.shipping_region_policies policy),
    'adoptions',(select coalesce(jsonb_agg(jsonb_build_object('originId',origin_id,'managedFrom',managed_from) order by origin_id),'[]')
      from private.shipping_region_adoptions));
end $function$
;

select private.register_operator_rpc_contract('public.admin_list_shipping_region_policies()'::regprocedure,'catalog.read','read',false);

CREATE OR REPLACE FUNCTION public.admin_shipping_region_expiry_metadata(p_at timestamp with time zone DEFAULT statement_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_at is null or not isfinite(p_at) then raise invalid_parameter_value using message='invalid_warning_time'; end if;
  with candidates as (
    select policy.id,policy.version,policy.starts_at,policy.ends_at,
      origin.id origin_id,origin.name origin_name,origin.default_carrier carrier_code,carrier.label carrier_label
    from public.fulfillment_origins origin
    join public.shipping_carriers carrier on carrier.code=origin.default_carrier and carrier.is_active
    cross join lateral (
      (select p.id,p.version,p.starts_at,p.ends_at from private.shipping_region_policies p
        where p.origin_id=origin.id and p.carrier_code=origin.default_carrier and p.status='active' and p.starts_at<=p_at
        order by p.starts_at desc,p.version desc limit 1)
      union all
      (select p.id,p.version,p.starts_at,p.ends_at from private.shipping_region_policies p
        where p.origin_id=origin.id and p.carrier_code=origin.default_carrier and p.status='active'
          and p.starts_at>p_at and p.ends_at<=p_at+interval '7 days')
    ) policy
    where origin.is_active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',candidate.id,'name',policy.configuration->>'name','version',candidate.version,'status','active',
    'startsAt',candidate.starts_at,'endsAt',candidate.ends_at,'originId',candidate.origin_id,
    'originName',candidate.origin_name,'carrierCode',candidate.carrier_code,'carrierLabel',candidate.carrier_label
  ) order by candidate.ends_at,candidate.id),'[]'::jsonb) into result
  from candidates candidate join private.shipping_region_policies policy on policy.id=candidate.id
  where candidate.ends_at<=p_at+interval '7 days';
  return result;
end $function$
;

select private.register_operator_rpc_contract('public.admin_shipping_region_expiry_metadata(timestamp with time zone)'::regprocedure,'catalog.read','read',false);

CREATE OR REPLACE FUNCTION public.admin_suspend_user(target_profile_id uuid, target_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.user_role;
  actor_suspended_at timestamptz;
  selected_role public.user_role;
  selected_suspended_at timestamptz;
  normalized_reason text := nullif(
    pg_catalog.btrim(target_reason, E' \t\n\r\f\v'),
    ''
  );
  changed_at timestamptz;
begin
  perform private.lock_operator_subjects(array[(select auth.uid()),target_profile_id]);
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select profile.role, profile.suspended_at
    into actor_role, actor_suspended_at
  from public.profiles as profile
  where profile.id = actor_id
  for update;

  if not found
    or actor_role not in ('staff', 'admin')
    or actor_suspended_at is not null
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_profile_id = actor_id then
    raise exception 'cannot_suspend_self' using errcode = '22023';
  end if;

  if normalized_reason is null or pg_catalog.length(normalized_reason) > 200 then
    raise exception 'invalid_suspension_reason' using errcode = '22023';
  end if;

  select profile.role, profile.suspended_at
    into selected_role, selected_suspended_at
  from public.profiles as profile
  where profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  -- A primary manager cannot bypass the peer-revocation rule through sanctions.
  -- Owner transfer or an explicit manager-role change must happen first.
  if exists(select 1 from private.operator_memberships
    where profile_id=target_profile_id and manager_role in ('owner','primary')) then
    raise exception 'operator_manager_change_required' using errcode='42501';
  end if;
  if (private.operator_access_for(actor_id)->>'mode')='legacy'
    and (selected_role='admin' or (actor_role='staff' and selected_role<>'user')) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if selected_suspended_at is not null then
    return jsonb_build_object(
      'profileId', target_profile_id,
      'changed', false,
      'suspendedAt', selected_suspended_at
    );
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.profiles as profile
  set
    suspended_at = changed_at,
    suspension_reason = normalized_reason
  where profile.id = target_profile_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'admin.member.suspended',
    'profile:' || target_profile_id::text,
    jsonb_build_object('from', 'active', 'to', 'suspended')
  );

  return jsonb_build_object(
    'profileId', target_profile_id,
    'changed', true,
    'suspendedAt', changed_at
  );
end;
$function$
;

select private.register_operator_rpc_contract('public.admin_suspend_user(uuid,text)'::regprocedure,'platform.manage','write',false);

CREATE OR REPLACE FUNCTION public.admin_unsuspend_user(target_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.user_role;
  actor_suspended_at timestamptz;
  selected_role public.user_role;
  selected_suspended_at timestamptz;
begin
  perform private.lock_operator_subjects(array[(select auth.uid()),target_profile_id]);
  perform private.require_operator_capability('platform.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select profile.role, profile.suspended_at
    into actor_role, actor_suspended_at
  from public.profiles as profile
  where profile.id = actor_id
  for update;

  if not found
    or actor_role not in ('staff', 'admin')
    or actor_suspended_at is not null
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_profile_id = actor_id then
    raise exception 'cannot_unsuspend_self' using errcode = '22023';
  end if;

  select profile.role, profile.suspended_at
    into selected_role, selected_suspended_at
  from public.profiles as profile
  where profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  -- A primary manager cannot bypass the peer-revocation rule through sanctions.
  -- Owner transfer or an explicit manager-role change must happen first.
  if exists(select 1 from private.operator_memberships
    where profile_id=target_profile_id and manager_role in ('owner','primary')) then
    raise exception 'operator_manager_change_required' using errcode='42501';
  end if;
  if (private.operator_access_for(actor_id)->>'mode')='legacy'
    and (selected_role='admin' or (actor_role='staff' and selected_role<>'user')) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if selected_suspended_at is null then
    return jsonb_build_object(
      'profileId', target_profile_id,
      'changed', false,
      'suspendedAt', null
    );
  end if;

  update public.profiles as profile
  set
    suspended_at = null,
    suspension_reason = null
  where profile.id = target_profile_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'admin.member.unsuspended',
    'profile:' || target_profile_id::text,
    jsonb_build_object('from', 'suspended', 'to', 'active')
  );

  return jsonb_build_object(
    'profileId', target_profile_id,
    'changed', true,
    'suspendedAt', null
  );
end;
$function$
;

select private.register_operator_rpc_contract('public.admin_unsuspend_user(uuid)'::regprocedure,'platform.manage','write',false);
