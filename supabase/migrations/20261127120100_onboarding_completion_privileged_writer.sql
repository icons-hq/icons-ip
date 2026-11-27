begin;

-- 호스팅 Preview는 service_role에 완료 RPC 실행 권한만 준다.
-- 두 앱 버전이 공유하는 서버 전용 함수에서 프로필을 한 번 잠그고 완료 조건을 검사한다.
create function private.complete_member_onboarding(p_user_id uuid, p_require_phone boolean, p_require_country boolean)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_at timestamptz;
  country text;
  completed_at timestamptz;
begin
  if p_user_id is null or p_require_phone is null or p_require_country is null then
    raise invalid_parameter_value using message = 'onboarding_completion_invalid';
  end if;

  select p.onboarded_at, p.residence_country_code into current_at, country
  from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise no_data_found using message = 'onboarding_profile_missing';
  end if;
  -- 이미 마친 계정은 완료 시각을 바꾸지 않는다(번호를 옮겨 가 다시 인증한 회원 포함).
  if current_at is not null then
    return current_at;
  end if;

  if p_require_country and country is null then
    raise check_violation using message = 'onboarding_residence_country_required';
  end if;

  -- 약관·개인정보 동의와 만 14세 확인(1단계)을 마친 계정만 끝낼 수 있다.
  if not private.member_phone_onboarding_ready(p_user_id) then
    raise insufficient_privilege using message = 'onboarding_step_required';
  end if;
  if p_require_phone and not exists (
    select 1 from private.member_phone_numbers n where n.user_id = p_user_id and n.phone_e164 is not null
  ) then
    raise insufficient_privilege using message = 'onboarding_phone_required';
  end if;

  completed_at := pg_catalog.now();
  update public.profiles set onboarded_at = completed_at where id = p_user_id;
  return completed_at;
end;
$$;

alter function private.complete_member_onboarding(uuid, boolean, boolean) owner to postgres;
revoke all on function private.complete_member_onboarding(uuid, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function private.complete_member_onboarding(uuid, boolean, boolean) to service_role;

create or replace function public.service_complete_member_onboarding(p_user_id uuid, p_require_phone boolean)
returns timestamptz language sql volatile security invoker set search_path = ''
as $$ select private.complete_member_onboarding(p_user_id, p_require_phone, false) $$;

create or replace function public.service_complete_member_onboarding_v2(p_user_id uuid, p_require_phone boolean)
returns timestamptz language sql volatile security invoker set search_path = ''
as $$ select private.complete_member_onboarding(p_user_id, p_require_phone, true) $$;

revoke all on function public.service_complete_member_onboarding(uuid, boolean), public.service_complete_member_onboarding_v2(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.service_complete_member_onboarding(uuid, boolean), public.service_complete_member_onboarding_v2(uuid, boolean)
  to service_role;

notify pgrst, 'reload schema';
commit;
