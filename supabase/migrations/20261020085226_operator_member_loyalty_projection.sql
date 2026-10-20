-- Read the actual loyalty grade through the existing narrow operator projection.
-- Cross-member profiles SELECT remains self-only; never present a fabricated WELCOME grade.
create or replace function public.admin_member_moderation_context(p_profile_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); legacy boolean; actor_role public.user_role;
begin
  if not public.has_operator_capability('platform.manage',false) then
    raise insufficient_privilege using message='operator_capability_required';end if;
  if p_profile_ids is null or cardinality(p_profile_ids)>100 or array_position(p_profile_ids,null) is not null then
    raise invalid_parameter_value using message='invalid_member_moderation_targets';end if;
  legacy:=(private.operator_access_for(actor)->>'mode')='legacy';
  select role into actor_role from public.profiles where id=actor;
  return (select coalesce(jsonb_agg(jsonb_build_object('profileId',profile.id,'managerRole',membership.manager_role,
    'loyaltyGrade',profile.loyalty_grade,
    'canModerate',profile.id<>actor and coalesce(membership.manager_role not in ('owner','primary'),true)
      and (not legacy or (profile.role<>'admin' and (actor_role<>'staff' or profile.role='user')))
  ) order by profile.id),'[]') from public.profiles profile
  left join private.operator_memberships membership on membership.profile_id=profile.id
  where profile.id=any(p_profile_ids));
end $$;
revoke all on function public.admin_member_moderation_context(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_member_moderation_context(uuid[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_member_moderation_context(uuid[])'::regprocedure,'platform.manage','read',false);
notify pgrst,'reload schema';
