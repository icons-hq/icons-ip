-- #188 · ADR-0009: v1 가입 기준을 만 14세 이상으로 확정한다.
--
-- 앱 폼(app/onboarding/actions.ts)의 검증만으로는 PostgREST 직접 호출을 막지 못한다.
-- profiles 는 본인 행에 대한 update 를 RLS 로 허용하므로, 로그인한 이용자가 폼을
-- 거치지 않고 birth_date 를 그대로 쓸 수 있다. 그래서 판정을 DB 에 둔다.
--
-- 법정대리인 동의 경로는 v1 에서 제공하지 않는다 — 수집·검증·철회 전부를 만들어야
-- 하는데 그 대상이 아직 없다. 따라서 만 14세 미만은 예외 없이 거부다.
--
-- 이 게이트는 `minimum_age_14` purpose 하나만 담당한다. 19+ 성인 상품 접근은 NICE
-- 본인확인 증거(`adult_19`, #210)로 별도 관리하며, 생년월일을 성인인증으로 승격하지
-- 않는다.

create function private.enforce_minimum_signup_age()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if new.birth_date is null then
    return new;
  end if;

  -- KST 달력 기준 만 나이. pg_catalog.age() 는 생일이 지나야 한 살 오르고,
  -- 2월 29일생은 평년에 3월 1일 도래한다 — lib/age/minimum-age.ts 와 같은 규칙이다.
  -- 서버 타임존이 UTC 여도 판정 날짜는 이용자의 달력을 따라야 한다.
  -- extract(year from ...) 는 파서 문법이라 스키마 한정 호출이 안 된다.
  -- date_part 는 같은 계산을 하는 일반 함수라 pg_catalog 로 고정할 수 있다.
  if pg_catalog.date_part(
       'year',
       pg_catalog.age(
         (pg_catalog.now() at time zone 'Asia/Seoul')::date,
         new.birth_date
       )
     ) < 14
  then
    raise exception 'minimum_age_required' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_minimum_signup_age() from public, anon, authenticated, service_role;

-- `update of birth_date` 로 좁힌다. 닉네임·아바타처럼 생년월일을 건드리지 않는 갱신은
-- 이 게이트를 지나지 않아야, 이미 저장된 행이 있는 계정의 다른 편집이 막히지 않는다.
-- 2026-08-20 Production 실측 기준 만 14세 미만 계정은 0건이므로 소급 차단 대상은 없다.
create trigger profiles_minimum_signup_age
before insert or update of birth_date on public.profiles
for each row
execute function private.enforce_minimum_signup_age();
