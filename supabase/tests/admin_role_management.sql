\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000301',
    'authenticated',
    'authenticated',
    'role-admin@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    'authenticated',
    'authenticated',
    'role-staff@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000303',
    'authenticated',
    'authenticated',
    'role-fan@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000301',
    'role-admin@example.test',
    'role_admin',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'admin'
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    'role-staff@example.test',
    'role_staff',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000303',
    'role-fan@example.test',
    'role_fan',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

-- ---------------------------------------------------------------------------
-- 일반 사용자는 역할을 변경할 수 없다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000303', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    perform public.admin_set_user_role(
      '00000000-0000-4000-8000-000000000302'::uuid,
      'admin'::user_role
    );
  exception
    when insufficient_privilege then
      return;
  end;
  raise exception 'non-admin role change should be blocked';
end;
$$;

-- ---------------------------------------------------------------------------
-- staff도 역할을 변경할 수 없다 (admin 전용)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000302', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    perform public.admin_set_user_role(
      '00000000-0000-4000-8000-000000000303'::uuid,
      'staff'::user_role
    );
  exception
    when insufficient_privilege then
      return;
  end;
  raise exception 'staff role change should be blocked';
end;
$$;

-- ---------------------------------------------------------------------------
-- admin은 부여·회수 가능, 본인 변경은 거부, 감사 로그 기록
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000301', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.admin_set_user_role(
  '00000000-0000-4000-8000-000000000303'::uuid,
  'staff'::user_role
);

select 1 / case when (
  select member.role
  from public.admin_search_members('role-fan@example.test') as member
  where member.profile_id = '00000000-0000-4000-8000-000000000303'
) = 'staff' then 1 else 0 end as assert_admin_can_grant_staff;

select public.admin_set_user_role(
  '00000000-0000-4000-8000-000000000303'::uuid,
  'user'::user_role
);

select 1 / case when (
  select member.role
  from public.admin_search_members('role-fan@example.test') as member
  where member.profile_id = '00000000-0000-4000-8000-000000000303'
) = 'user' then 1 else 0 end as assert_admin_can_revoke_staff;

do $$
begin
  begin
    perform public.admin_set_user_role(
      '00000000-0000-4000-8000-000000000301'::uuid,
      'user'::user_role
    );
  exception
    when others then
      if sqlerrm = 'cannot_change_own_role' then
        return;
      end if;
      raise;
  end;
  raise exception 'self role change should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.admin_set_user_role(
      '00000000-0000-4000-8000-000000000399'::uuid,
      'staff'::user_role
    );
  exception
    when others then
      if sqlerrm = 'profile_not_found' then
        return;
      end if;
      raise;
  end;
  raise exception 'unknown profile should be rejected';
end;
$$;

select 1 / case when (
  select count(*)
  from public.audit_log
  where actor_id = '00000000-0000-4000-8000-000000000301'
    and action = 'admin_user_role_update'
    and target = 'profile:00000000-0000-4000-8000-000000000303'
) = 2 then 1 else 0 end as assert_role_changes_audited;

-- 동일 역할 재지정은 no-op (감사 로그가 늘지 않는다)
select public.admin_set_user_role(
  '00000000-0000-4000-8000-000000000303'::uuid,
  'user'::user_role
);

select 1 / case when (
  select count(*)
  from public.audit_log
  where actor_id = '00000000-0000-4000-8000-000000000301'
    and action = 'admin_user_role_update'
) = 2 then 1 else 0 end as assert_noop_not_audited;

rollback;
