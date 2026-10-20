-- Store manager authority is independent of profiles.role and duty labels.
-- Existing operators are a fixed migration-time cohort; new raw staff accounts
-- never receive the compatibility policy by omission of a manager assignment.
create table private.operator_access_state (
  id boolean primary key default true check (id),
  configured boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into private.operator_access_state(id) values(true);

create table private.operator_memberships (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  manager_role text not null check(manager_role in ('owner','primary','deputy','influencer','agency','logistics')),
  revision integer not null default 1 check(revision > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.profiles(id) on delete set null
);
create unique index operator_memberships_single_owner
  on private.operator_memberships(manager_role) where manager_role='owner';

create table private.operator_legacy_cohort (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  legacy_role public.user_role not null check(legacy_role in ('staff','admin')),
  captured_at timestamptz not null default clock_timestamp()
);
insert into private.operator_legacy_cohort(profile_id,legacy_role)
  select id,role from public.profiles where role in ('staff','admin');

create table private.operator_rpc_contracts (
  signature text primary key,
  capability text not null check(capability in ('home','catalog.read','catalog.manage','catalog.announcements',
    'sales.read','sales.manage','sales.restrictions','cs.manage','store.manage','seller.read','seller.manage',
    'marketing.manage','stats.read','promotion.manage','operators.manage','operators.transfer','platform.manage')),
  guard_kind text not null check(guard_kind in ('read','write','mixed','service_start','service_finish','manual','retired')),
  legacy_admin_only boolean not null default false,
  body_md5 text not null check(body_md5 ~ '^[0-9a-f]{32}$')
);
create table private.operator_policy_contracts (
  schema_name text not null,
  table_name text not null,
  policy_name text not null,
  capability text not null,
  definition_md5 text not null check(definition_md5 ~ '^[0-9a-f]{32}$'),
  primary key(schema_name,table_name,policy_name)
);
alter table private.operator_access_state enable row level security;
alter table private.operator_memberships enable row level security;
alter table private.operator_legacy_cohort enable row level security;
alter table private.operator_rpc_contracts enable row level security;
alter table private.operator_policy_contracts enable row level security;
revoke all on private.operator_access_state,private.operator_memberships,private.operator_legacy_cohort,
  private.operator_rpc_contracts,private.operator_policy_contracts from public,anon,authenticated,service_role;

create function private.operator_role_capabilities(p_role text)
returns text[] language sql immutable set search_path='' as $$
  select case p_role
    when 'owner' then array['home','catalog.read','catalog.manage','catalog.announcements','sales.read','sales.manage',
      'sales.restrictions','cs.manage','store.manage','seller.read','seller.manage','marketing.manage','stats.read',
      'promotion.manage','operators.manage','operators.transfer','platform.manage']
    when 'primary' then array['home','catalog.read','catalog.manage','catalog.announcements','sales.read','sales.manage',
      'sales.restrictions','cs.manage','store.manage','seller.read','seller.manage','marketing.manage','stats.read',
      'promotion.manage','operators.manage','platform.manage']
    when 'deputy' then array['home','catalog.read','catalog.manage','catalog.announcements','cs.manage','store.manage','seller.read','promotion.manage']
    when 'influencer' then array['home','catalog.read','catalog.manage','catalog.announcements','cs.manage','store.manage','seller.read','promotion.manage','sales.read','sales.restrictions','stats.read']
    when 'agency' then array['home','catalog.read','catalog.manage','catalog.announcements','cs.manage','store.manage','seller.read','promotion.manage','stats.read']
    when 'logistics' then array['home','catalog.announcements']
    else array[]::text[] end;
$$;
revoke all on function private.operator_role_capabilities(text) from public,anon,authenticated,service_role;

create function private.operator_access_for(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  state private.operator_access_state;
  actor public.profiles;
  membership private.operator_memberships;
  access_mode text := 'none';
  caps text[] := '{}';
begin
  select * into state from private.operator_access_state where id;
  select * into actor from public.profiles where id=p_actor;
  if found and actor.role in ('staff','admin') and actor.suspended_at is null
    and not exists(select 1 from private.account_action_fences where subject_user_id=p_actor) then
    select * into membership from private.operator_memberships where profile_id=p_actor;
    if found then
      access_mode := 'configured';
      caps := private.operator_role_capabilities(membership.manager_role);
    elsif not state.configured and exists(select 1 from private.operator_legacy_cohort where profile_id=p_actor) then
      access_mode := 'legacy';
      caps := private.operator_role_capabilities('primary');
      if actor.role <> 'admin' then caps := array_remove(caps,'operators.manage'); end if;
    end if;
  end if;
  return jsonb_build_object('mode',access_mode,'managerRole',membership.manager_role,
    'capabilities',to_jsonb(caps),'revision',coalesce(state.revision,1),
    'setupRequired',not coalesce(state.configured,false));
end $$;
revoke all on function private.operator_access_for(uuid) from public,anon,authenticated,service_role;

create function private.has_operator_capability(p_actor uuid,p_capability text,p_legacy_admin_only boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare access jsonb;
begin
  access := private.operator_access_for(p_actor);
  if not coalesce(access->'capabilities' ? p_capability,false) then return false; end if;
  if access->>'mode'='legacy' and p_legacy_admin_only then
    return exists(select 1 from public.profiles where id=p_actor and role='admin' and suspended_at is null);
  end if;
  return true;
end $$;
revoke all on function private.has_operator_capability(uuid,text,boolean) from public,anon,authenticated,service_role;

-- Public self-only predicate is intentionally callable by RLS consumers.
create function public.has_operator_capability(p_capability text,p_legacy_admin_only boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select private.has_operator_capability((select auth.uid()),p_capability,p_legacy_admin_only);
$$;
revoke all on function public.has_operator_capability(text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.has_operator_capability(text,boolean) to anon,authenticated,service_role;

create function private.lock_operator_subjects(p_profile_ids uuid[])
returns void language plpgsql volatile security definer set search_path='' as $$
declare subject uuid;
begin
  for subject in select distinct id from unnest(p_profile_ids) as ids(id) where id is not null order by id loop
    perform private.lock_account_action_subject(subject);
  end loop;
  perform 1 from public.profiles where id=any(p_profile_ids) order by id for share;
  perform 1 from private.operator_memberships where profile_id=any(p_profile_ids) order by profile_id for share;
end $$;
revoke all on function private.lock_operator_subjects(uuid[]) from public,anon,authenticated,service_role;

create function private.require_actor_operator_capability(p_actor uuid,p_capability text,p_legacy_admin_only boolean default false)
returns uuid language plpgsql volatile security definer set search_path='' as $$
begin
  if p_actor is null then raise insufficient_privilege using message='operator_capability_required'; end if;
  perform private.lock_operator_subjects(array[p_actor]);
  if not private.has_operator_capability(p_actor,p_capability,p_legacy_admin_only) then
    raise insufficient_privilege using message='operator_capability_required';
  end if;
  return p_actor;
end $$;
revoke all on function private.require_actor_operator_capability(uuid,text,boolean) from public,anon,authenticated,service_role;

create function private.require_operator_capability(p_capability text,p_legacy_admin_only boolean default false)
returns uuid language sql volatile security definer set search_path='' as $$
  select private.require_actor_operator_capability((select auth.uid()),p_capability,p_legacy_admin_only);
$$;
revoke all on function private.require_operator_capability(text,boolean) from public,anon,authenticated,service_role;

create function public.admin_current_operator_access()
returns jsonb language sql stable security definer set search_path='' as $$
  select private.operator_access_for((select auth.uid()));
$$;
revoke all on function public.admin_current_operator_access() from public,anon,authenticated,service_role;
grant execute on function public.admin_current_operator_access() to authenticated;

create function private.register_operator_rpc_contract(p_function regprocedure,p_capability text,p_guard_kind text,p_legacy_admin_only boolean default false)
returns void language plpgsql volatile security definer set search_path='' as $$
declare function_name text; function_body text;
begin
  select p.oid::regprocedure::text,p.prosrc into function_name,function_body from pg_proc p where p.oid=p_function::oid;
  if not found then raise undefined_function using message='operator_rpc_contract_function_missing'; end if;
  insert into private.operator_rpc_contracts(signature,capability,guard_kind,legacy_admin_only,body_md5)
  values(function_name,p_capability,p_guard_kind,p_legacy_admin_only,md5(function_body))
  on conflict(signature) do update set capability=excluded.capability,guard_kind=excluded.guard_kind,
    legacy_admin_only=excluded.legacy_admin_only,body_md5=excluded.body_md5;
end $$;
revoke all on function private.register_operator_rpc_contract(regprocedure,text,text,boolean) from public,anon,authenticated,service_role;

-- This old endpoint cannot express a manager role and must not create unmapped
-- raw staff/admin accounts while a setup or role transition is in progress.
revoke all on function public.admin_set_user_role(uuid,public.user_role) from public,anon,authenticated,service_role;

comment on table private.operator_memberships is 'Store manager authorization; independent from public.operator_assignments duty labels.';
comment on table private.operator_legacy_cohort is 'Fixed pre-migration cohort only; do not append new staff as an authorization fallback.';
comment on function public.admin_current_operator_access() is 'Self-only current DB authority. Explicit assignments apply before global setup completion.';
