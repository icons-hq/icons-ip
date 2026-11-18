-- 온보딩 완료(profiles.onboarded_at) 기록을 서버 신뢰 경계로 옮긴다 — 1단계(서버 경로 열기).
--
-- 문제: p0_foundation의 열 권한이 authenticated에게 profiles.onboarded_at update를 열어 둬, 로그인한 회원이 공개
-- Data API로 자기 onboarded_at을 직접 써서 휴대폰 번호 인증(스위치 ON)을 건너뛰고 구매 게이트를 넘을 수 있었다.
-- '한 번호 한 계정'과 첫구매 쿠폰 다계정 방지가 이 우회로 무력화된다.
--
-- 해결은 두 단계다. 이 migration은 서버(service_role)만 부르는 완료 RPC를 만든다. 휴대폰 인증이 필요한 배포(앱 스위치
-- ON)는 호출 서버가 p_require_phone=true로 부르고, RPC가 쓰기와 같은 트랜잭션에서 인증된 번호가 있는지 다시 확인한다.
-- authenticated의 onboarded_at update 권한 회수는 이 앱이 운영에 배포된 뒤 별도 migration에서 한다 — CI는 DB를 먼저
-- 배포하고 앱을 나중에 배포하므로, 같이 회수하면 그 사이(앱 배포 실패 시 그 이후까지) 옛 앱의 온보딩 완료가 권한 오류로
-- 막힌다. birth_date·consents 권한은 이번 범위에서 바꾸지 않는다(트리거가 값을 지킨다).

begin;

create function public.service_complete_member_onboarding(p_user_id uuid, p_require_phone boolean)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_at timestamptz;
  completed_at timestamptz;
begin
  if p_user_id is null or p_require_phone is null then
    raise invalid_parameter_value using message = 'onboarding_completion_invalid';
  end if;

  select p.onboarded_at into current_at from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise no_data_found using message = 'onboarding_profile_missing';
  end if;
  -- 이미 마친 계정은 완료 시각을 바꾸지 않는다(번호를 옮겨 가 다시 인증한 회원 포함).
  if current_at is not null then
    return current_at;
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

alter function public.service_complete_member_onboarding(uuid, boolean) owner to postgres;
revoke all on function public.service_complete_member_onboarding(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.service_complete_member_onboarding(uuid, boolean) to service_role;

notify pgrst, 'reload schema';

commit;
