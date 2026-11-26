begin;

-- 회원이 가입을 마친 뒤에는 심사 대조에 쓰는 생년월일을 직접 고칠 수 없다.
-- 기존 가입 작성, 신뢰된 정정 및 탈퇴 파기 경로는 각각 원래 권한으로 실행한다.
create function private.guard_onboarded_birth_date() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated','anon') then
    raise insufficient_privilege using message = 'onboarded_birth_date_locked';
  end if;
  return new;
end $$;
revoke all on function private.guard_onboarded_birth_date() from public, anon, authenticated, service_role;
create trigger zz_profiles_lock_onboarded_birth_date before update of birth_date on public.profiles
  for each row when (old.onboarded_at is not null and old.birth_date is not null and new.birth_date is distinct from old.birth_date)
  execute function private.guard_onboarded_birth_date();

commit;
