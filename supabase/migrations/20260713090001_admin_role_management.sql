-- ============================================================================
-- ICONS · staff/admin 역할 부여·회수 (PRD #1 스토리 39)
--
-- 배경: profiles.role은 컬럼 단위 update grant에서 제외되어 클라이언트 경로의
--   직접 변경은 이미 차단되어 있으나(20260617090001), 제품 안에서 역할을
--   부여·회수할 경로 자체가 없어 service role 키나 수동 SQL로만 가능했다.
--   admin 전용 audited RPC로 부여·회수 경로를 추가한다.
--
-- 규칙:
--   - 호출자는 role = 'admin'만 허용 (staff는 역할 관리 불가).
--   - 본인 역할 변경 금지 — 유일 admin이 스스로 강등되어 잠기는 사고 방지.
--     (admin이 다른 admin을 강등하는 것은 허용 — 본인 금지 규칙만으로
--      시스템에 admin이 최소 1명 남는 것이 보장된다.)
--   - 변경 시 audit_log에 from→to diff 기록. 동일 역할 재지정은 no-op.
-- ============================================================================

create or replace function public.admin_set_user_role(
  target_profile_id uuid,
  target_role user_role
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_role user_role;
  previous_role user_role;
begin
  if actor_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select profiles.role
    into actor_role
    from public.profiles
    where profiles.id = actor_id;

  if actor_role is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_profile_id = actor_id then
    raise exception 'cannot_change_own_role' using errcode = '22023';
  end if;

  select profiles.role
    into previous_role
    from public.profiles
    where profiles.id = target_profile_id
    for update;

  if not found then
    raise exception 'profile_not_found' using errcode = '22023';
  end if;

  if previous_role is distinct from target_role then
    update public.profiles
    set role = target_role
    where profiles.id = target_profile_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      actor_id,
      'admin_user_role_update',
      'profile:' || target_profile_id::text,
      jsonb_build_object('from', previous_role, 'to', target_role)
    );
  end if;

  return jsonb_build_object('profileId', target_profile_id, 'from', previous_role, 'to', target_role);
end;
$$;

-- default privileges 누수 봉인 — 롤별 명시 revoke 후 최소 grant (20260707090001 규율)
revoke all on function public.admin_set_user_role(uuid, user_role)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_user_role(uuid, user_role) to authenticated;
