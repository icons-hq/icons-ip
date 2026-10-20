-- Explicit manager setup and lifecycle. The global state lock precedes account
-- fences and profile/member locks, matching the capability core contract.
create function private.operator_directory_rows(p_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'nickname',coalesce(nullif(btrim(p.nickname),''),'fan_'||left(p.id::text,6)),
    'maskedEmail',case when nullif(btrim(coalesce(p.email,'')),'') is null then '이메일 없음'
      when strpos(p.email,'@')>1 then left(split_part(p.email,'@',1),1)||'***@'||split_part(p.email,'@',2) else '***' end,
    'role',p.role,'managerRole',m.manager_role,'membershipRevision',coalesce(m.revision,0),
    'createdAt',p.created_at,'suspendedAt',p.suspended_at,'duty',case when m.manager_role='owner' then 'representative' else a.duty end,'dutyRevision',coalesce(a.revision,0)
  ) order by p.created_at desc,p.id desc),'[]'::jsonb)
  from public.profiles p left join private.operator_memberships m on m.profile_id=p.id
  left join public.operator_assignments a on a.profile_id=p.id where p.id=any(p_ids);
$$;
revoke all on function private.operator_directory_rows(uuid[]) from public,anon,authenticated,service_role;

create or replace function public.admin_search_operators(p_query text default '',p_role text default 'operators',p_status text default 'all',p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q text:=btrim(coalesce(p_query,'')); state private.operator_access_state; ids uuid[]; total_count bigint; actor_role text; actor_revision integer; setup_ids uuid[];
begin
  if not private.has_operator_capability((select auth.uid()),'operators.manage',true)
    then raise insufficient_privilege using message='operator_capability_required'; end if;
  if length(q)>100 or p_role is null or p_role not in ('all','operators','unassigned','user','staff','admin','owner','primary','deputy','influencer','agency','logistics')
    or p_status is null or p_status not in ('all','active','suspended') or p_page is null or p_page<1 or p_page>1000000
    or p_page_size is null or p_page_size not in (20,50,100) then raise invalid_parameter_value using message='invalid_operator_filter'; end if;
  select * into strict state from private.operator_access_state where id;
  select manager_role,revision into actor_role,actor_revision from private.operator_memberships where profile_id=(select auth.uid());
  with filtered as materialized (
    select p.id,p.created_at from public.profiles p left join private.operator_memberships m on m.profile_id=p.id
    where (p_role='all' or (p_role='operators' and (m.profile_id is not null or (not state.configured and p.role in ('staff','admin'))))
      or (p_role='unassigned' and m.profile_id is null and (state.configured or p.role='user'))
      or p.role::text=p_role or m.manager_role=p_role)
      and (p_status='all' or (p_status='active' and p.suspended_at is null) or (p_status='suspended' and p.suspended_at is not null))
      and (q='' or strpos(lower(coalesce(p.nickname,'')),lower(q))>0 or strpos(lower(coalesce(p.email,'')),lower(q))>0 or strpos(p.id::text,lower(q))>0)
  ), page_rows as (
    select * from filtered order by created_at desc,id desc limit p_page_size offset (p_page-1)*p_page_size
  ) select (select count(*) from filtered),coalesce((select array_agg(id) from page_rows),'{}'::uuid[]) into total_count,ids;
  if not state.configured then select coalesce(array_agg(id),'{}'::uuid[]) into setup_ids from public.profiles where role in ('staff','admin'); end if;
  return jsonb_build_object('mode',case when state.configured then 'configured' else 'legacy' end,'revision',state.revision,
    'actorManagerRole',actor_role,'actorMembershipRevision',coalesce(actor_revision,0),'total',total_count,'rows',private.operator_directory_rows(ids),
    'setupCandidates',private.operator_directory_rows(coalesce(setup_ids,'{}'::uuid[])));
end $$;
revoke all on function public.admin_search_operators(text,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_operators(text,text,text,integer,integer) to authenticated;

create function private.operator_lifecycle_replay(p_actor uuid,p_operation_id uuid,p_action text,p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare previous public.audit_log;
begin
  select * into previous from public.audit_log where id=p_operation_id;
  if not found then return null; end if;
  if previous.actor_id=p_actor and previous.action=p_action and previous.diff->'request'=p_request then return previous.diff->'result'; end if;
  raise unique_violation using message='operation_conflict';
end $$;
revoke all on function private.operator_lifecycle_replay(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.admin_activate_operator_access(p_assignments jsonb,p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); state private.operator_access_state; ids uuid[]; mapping_ids uuid[];
  item jsonb; target uuid; role_name text; request jsonb; result jsonb; owner_id uuid; assigned_count integer;
begin
  if actor is null then raise insufficient_privilege using message='operator_capability_required'; end if;
  if p_operation_id is null or p_expected_revision is null or p_expected_revision<1 or jsonb_typeof(p_assignments) is distinct from 'array'
    then raise invalid_parameter_value using message='operator_setup_incomplete'; end if;
  if jsonb_array_length(p_assignments)=0 or jsonb_array_length(p_assignments)>10000 then raise invalid_parameter_value using message='operator_setup_incomplete'; end if;
  for item in select value from jsonb_array_elements(p_assignments) loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'profileId') is distinct from 'string'
      or item->>'profileId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not item ? 'managerRole' or (item->'managerRole'<>'null'::jsonb and item->>'managerRole' not in ('owner','primary','deputy','influencer','agency','logistics'))
      or item-array['profileId','managerRole']::text[]<>'{}'::jsonb then raise invalid_parameter_value using message='operator_setup_incomplete'; end if;
  end loop;
  select array_agg((value->>'profileId')::uuid order by (value->>'profileId')::uuid),
    jsonb_build_object('assignments',jsonb_agg(jsonb_build_object('profileId',(value->>'profileId')::uuid,'managerRole',value->'managerRole') order by (value->>'profileId')::uuid),'expectedRevision',p_expected_revision)
    into mapping_ids,request from jsonb_array_elements(p_assignments);
  if cardinality(mapping_ids)<>(select count(distinct value) from unnest(mapping_ids) value) then raise invalid_parameter_value using message='operator_setup_incomplete'; end if;
  select * into strict state from private.operator_access_state where id for update;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into ids from public.profiles where role in ('staff','admin');
  perform private.lock_operator_subjects(ids||mapping_ids||array[actor]);
  perform private.require_actor_operator_capability(actor,'operators.manage',true);
  result:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.operator.access_activated',request);
  if result is not null then return result; end if;
  if state.configured or state.revision<>p_expected_revision then raise sqlstate 'PT409' using message='operator_access_changed'; end if;
  if not exists(select 1 from public.profiles where id=actor and role='admin' and suspended_at is null)
    then raise insufficient_privilege using message='operator_capability_required'; end if;
  if mapping_ids is distinct from ids or exists(select 1 from private.operator_memberships where not(profile_id=any(ids)))
    then raise invalid_parameter_value using message='operator_setup_incomplete'; end if;
  if (select count(*) from jsonb_array_elements(p_assignments) where value->>'managerRole'='owner')<>1 then raise invalid_parameter_value using message='operator_owner_required'; end if;
  select (value->>'profileId')::uuid into owner_id from jsonb_array_elements(p_assignments) where value->>'managerRole'='owner';
  if not exists(select 1 from public.profiles where id=owner_id and role='admin' and suspended_at is null)
    or exists(select 1 from private.account_action_fences where subject_user_id=owner_id)
    then raise invalid_parameter_value using message='operator_owner_required'; end if;
  if not exists(select 1 from jsonb_array_elements(p_assignments) where (value->>'profileId')::uuid=actor and value->>'managerRole' in ('owner','primary'))
    then raise invalid_parameter_value using message='operator_actor_mapping_required'; end if;
  select count(*) into assigned_count from jsonb_array_elements(p_assignments) where value->>'managerRole' is not null;
  if assigned_count>1001 then raise invalid_parameter_value using message='operator_limit'; end if;
  if exists(select 1 from jsonb_array_elements(p_assignments) a join public.profiles p on p.id=(a.value->>'profileId')::uuid
      where a.value->>'managerRole' is not null and (p.suspended_at is not null or exists(select 1 from private.account_action_fences f where f.subject_user_id=p.id)))
    then raise invalid_parameter_value using message='operator_suspended_target'; end if;
  -- Clear any pre-activation explicit assignments only within the mapped set.
  delete from private.operator_memberships where profile_id=any(ids);
  for item in select value from jsonb_array_elements(p_assignments) loop
    target:=(item->>'profileId')::uuid; role_name:=item->>'managerRole';
    if role_name is null then update public.profiles set role='user' where id=target;
    else insert into private.operator_memberships(profile_id,manager_role,updated_by) values(target,role_name,actor); end if;
  end loop;
  update private.operator_access_state set configured=true,revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id returning * into state;
  result:=jsonb_build_object('revision',state.revision,'accessRevision',state.revision,'ownerId',owner_id,'assignedCount',assigned_count);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.operator.access_activated','operators',jsonb_build_object('request',request,'result',result));
  return result;
end $$;
revoke all on function public.admin_activate_operator_access(jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_activate_operator_access(jsonb,bigint,uuid) to authenticated;

create function public.admin_change_operator_role(p_profile_id uuid,p_manager_role text,p_expected_revision integer,p_expected_access_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); state private.operator_access_state; previous private.operator_memberships; actor_role text; request jsonb; result jsonb; next_revision integer;
begin
  if actor is null then raise insufficient_privilege using message='operator_capability_required'; end if;
  if p_profile_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_access_revision is null or p_expected_access_revision<1
    or (p_manager_role is not null and p_manager_role not in ('primary','deputy','influencer','agency','logistics'))
    then raise invalid_parameter_value using message='invalid_operator_role'; end if;
  select * into strict state from private.operator_access_state where id for update;
  perform private.lock_operator_subjects(array[actor,p_profile_id]);
  perform private.require_actor_operator_capability(actor,'operators.manage',true);
  request:=jsonb_build_object('profileId',p_profile_id,'managerRole',p_manager_role,'expectedRevision',p_expected_revision,'expectedAccessRevision',p_expected_access_revision);
  result:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.operator.role_changed',request);
  if result is not null then return result; end if;
  if not state.configured then raise invalid_parameter_value using message='operator_setup_required'; end if;
  if state.revision<>p_expected_access_revision then raise sqlstate 'PT409' using message='operator_access_changed'; end if;
  if p_profile_id=actor then raise insufficient_privilege using message='operator_self_change_denied'; end if;
  select * into previous from private.operator_memberships where profile_id=p_profile_id for update;
  if not found or previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='operator_membership_changed'; end if;
  if previous.manager_role='owner' then raise insufficient_privilege using message='operator_owner_change_denied'; end if;
  select manager_role into actor_role from private.operator_memberships where profile_id=actor;
  if actor_role='primary' and previous.manager_role='primary' and p_manager_role is null then raise insufficient_privilege using message='operator_primary_revoke_denied'; end if;
  if p_manager_role is not null and (not exists(select 1 from public.profiles where id=p_profile_id and role in ('staff','admin') and suspended_at is null)
    or exists(select 1 from private.account_action_fences where subject_user_id=p_profile_id)) then raise invalid_parameter_value using message='operator_suspended_target'; end if;
  if p_manager_role is null then
    delete from private.operator_memberships where profile_id=p_profile_id;
    update public.profiles set role='user' where id=p_profile_id;
    next_revision:=0;
  else
    update private.operator_memberships set manager_role=p_manager_role,revision=revision+1,updated_at=clock_timestamp(),updated_by=actor
      where profile_id=p_profile_id returning revision into next_revision;
  end if;
  update private.operator_access_state set revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id returning * into state;
  result:=jsonb_build_object('revision',next_revision,'accessRevision',state.revision,'profileId',p_profile_id,'managerRole',p_manager_role);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.operator.role_changed','profile:'||p_profile_id::text,
    jsonb_build_object('before',to_jsonb(previous),'request',request,'result',result));
  return result;
end $$;
revoke all on function public.admin_change_operator_role(uuid,text,integer,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_change_operator_role(uuid,text,integer,bigint,uuid) to authenticated;

create function public.admin_transfer_operator_owner(p_profile_id uuid,p_expected_owner_revision integer,p_expected_target_revision integer,p_expected_access_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); state private.operator_access_state; previous_owner private.operator_memberships; target private.operator_memberships; request jsonb; result jsonb; next_revision integer;
begin
  if actor is null then raise insufficient_privilege using message='operator_capability_required'; end if;
  if p_profile_id is null or p_operation_id is null or p_expected_owner_revision is null or p_expected_owner_revision<1 or p_expected_target_revision is null or p_expected_target_revision<1 or p_expected_access_revision is null or p_expected_access_revision<1
    then raise invalid_parameter_value using message='invalid_operator_transfer'; end if;
  select * into strict state from private.operator_access_state where id for update;
  perform private.lock_operator_subjects(array[actor,p_profile_id]);
  -- The former owner becomes primary. Allow only its exact completed operation
  -- to be read again after the transfer capability has been removed.
  perform private.require_actor_operator_capability(actor,'operators.manage',true);
  request:=jsonb_build_object('profileId',p_profile_id,'expectedOwnerRevision',p_expected_owner_revision,'expectedTargetRevision',p_expected_target_revision,'expectedAccessRevision',p_expected_access_revision);
  result:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.operator.owner_transferred',request);
  if result is not null then return result; end if;
  perform private.require_actor_operator_capability(actor,'operators.transfer',false);
  if not state.configured then raise invalid_parameter_value using message='operator_setup_required'; end if;
  if state.revision<>p_expected_access_revision then raise sqlstate 'PT409' using message='operator_access_changed'; end if;
  if actor=p_profile_id then raise insufficient_privilege using message='operator_self_change_denied'; end if;
  select * into previous_owner from private.operator_memberships where profile_id=actor for update;
  select * into target from private.operator_memberships where profile_id=p_profile_id for update;
  if previous_owner.manager_role is distinct from 'owner' then raise insufficient_privilege using message='operator_capability_required'; end if;
  if previous_owner.revision<>p_expected_owner_revision or target.revision is distinct from p_expected_target_revision then raise sqlstate 'PT409' using message='operator_membership_changed'; end if;
  if target.manager_role<>'primary' then raise invalid_parameter_value using message='operator_primary_target_required'; end if;
  if not exists(select 1 from public.profiles where id=p_profile_id and role in ('staff','admin') and suspended_at is null)
    or exists(select 1 from private.account_action_fences where subject_user_id=p_profile_id) then raise invalid_parameter_value using message='operator_suspended_target'; end if;
  update private.operator_memberships set manager_role='primary',revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where profile_id=actor;
  update private.operator_memberships set manager_role='owner',revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where profile_id=p_profile_id returning revision into next_revision;
  update private.operator_access_state set revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id returning * into state;
  result:=jsonb_build_object('revision',next_revision,'accessRevision',state.revision,'ownerId',p_profile_id,'previousOwnerId',actor);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.operator.owner_transferred','operators',
    jsonb_build_object('request',request,'result',result));
  return result;
end $$;
revoke all on function public.admin_transfer_operator_owner(uuid,integer,integer,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_transfer_operator_owner(uuid,integer,integer,bigint,uuid) to authenticated;

create or replace function public.admin_set_operator_duty(p_profile_id uuid,p_duty text,p_expected_revision integer,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); state private.operator_access_state; previous public.operator_assignments; saved public.operator_assignments; existing public.audit_log; result jsonb;
begin
  if actor is null or p_profile_id is null then raise insufficient_privilege using message='operator_capability_required'; end if;
  if p_duty is null or p_duty not in ('sales','marketing','cs','design_content','logistics','accounting','management','other')
    or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null then raise invalid_parameter_value using message='invalid_operator_duty'; end if;
  select * into strict state from private.operator_access_state where id for update;
  perform private.lock_operator_subjects(array[actor,p_profile_id]);
  perform private.require_actor_operator_capability(actor,'operators.manage',true);
  select * into existing from public.audit_log where id=p_operation_id;
  if found then
    if existing.actor_id=actor and existing.action='admin.operator.duty_updated' and existing.target='profile:'||p_profile_id::text
      and existing.diff->>'after'=p_duty and (existing.diff->>'expectedRevision')::integer=p_expected_revision then return existing.diff->'result'; end if;
    raise unique_violation using message='operation_conflict';
  end if;
  if exists(select 1 from private.operator_memberships where profile_id=p_profile_id and manager_role='owner') then raise insufficient_privilege using message='operator_owner_change_denied'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_profile_id and p.role in ('staff','admin') and
    (not state.configured or exists(select 1 from private.operator_memberships m where m.profile_id=p.id))) then raise invalid_parameter_value using message='operator_required'; end if;
  select * into previous from public.operator_assignments where profile_id=p_profile_id for update;
  if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='operator_duty_changed'; end if;
  insert into public.operator_assignments(profile_id,duty) values(p_profile_id,p_duty)
    on conflict(profile_id) do update set duty=excluded.duty,revision=operator_assignments.revision+1,updated_at=clock_timestamp() returning * into saved;
  result:=jsonb_build_object('revision',saved.revision,'duty',saved.duty);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.operator.duty_updated','profile:'||p_profile_id::text,
    jsonb_build_object('before',previous.duty,'after',p_duty,'expectedRevision',p_expected_revision,'result',result));
  return result;
end $$;
revoke all on function public.admin_set_operator_duty(uuid,text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_operator_duty(uuid,text,integer,uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_search_operators(text,text,text,integer,integer)','operators.manage','manual',true);
select private.register_operator_rpc_contract('public.admin_set_operator_duty(uuid,text,integer,uuid)','operators.manage','manual',true);
select private.register_operator_rpc_contract('public.admin_activate_operator_access(jsonb,bigint,uuid)','operators.manage','manual',true);
select private.register_operator_rpc_contract('public.admin_change_operator_role(uuid,text,integer,bigint,uuid)','operators.manage','manual',true);
select private.register_operator_rpc_contract('public.admin_transfer_operator_owner(uuid,integer,integer,bigint,uuid)','operators.transfer','manual',false);
notify pgrst,'reload schema';
