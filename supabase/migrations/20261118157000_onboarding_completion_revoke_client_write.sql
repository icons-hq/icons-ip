-- 온보딩 완료 기록을 서버 신뢰 경계로 옮긴다 — 2단계(회원 직접 쓰기 회수).
--
-- 1단계(20261118153000)가 service_role 전용 완료 RPC를 만들고 앱이 그 RPC로만 쓰게 바꿨다. 이 migration은 그 앱이
-- 운영에 배포된 뒤에 적용한다(CI는 DB를 앱보다 먼저 배포한다 — 같이 넣으면 그 사이 옛 앱의 온보딩 완료가 막힌다).
-- 회수 뒤에는 로그인한 회원이 공개 Data API로 자기 profiles.onboarded_at을 써서 휴대폰 인증을 건너뛸 수 없다.
-- birth_date·consents 권한은 바꾸지 않는다.

begin;

revoke update (onboarded_at) on table public.profiles from authenticated;

notify pgrst, 'reload schema';

commit;
