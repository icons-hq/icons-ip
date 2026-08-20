\set ON_ERROR_STOP on

begin;

-- #188 · ADR-0009: 만 14세 가입 게이트가 앱 폼이 아니라 DB 에서 강제되는지 확인한다.
-- 여기서 쓰는 날짜는 전부 KST 오늘을 기준으로 상대 계산한다 — 고정 날짜를 박으면
-- 스위트가 시간이 지나면서 조용히 의미를 잃는다.

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
values (
  '00000000-0000-4000-8000-000000001401',
  'authenticated',
  'authenticated',
  'minimum-age@example.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

-- 1. 만 14세 생일 당일은 통과한다. 경계일은 거부가 아니라 허용 쪽이다.
update public.profiles
set birth_date = (now() at time zone 'Asia/Seoul')::date - interval '14 years'
where id = '00000000-0000-4000-8000-000000001401';

select 1 / case when (
  select birth_date
  from public.profiles
  where id = '00000000-0000-4000-8000-000000001401'
) = ((now() at time zone 'Asia/Seoul')::date - interval '14 years')::date
then 1 else 0 end as assert_exact_fourteenth_birthday_is_allowed;

-- 2. 생일 하루 전은 거부한다.
do $$
begin
  begin
    update public.profiles
    set birth_date = (now() at time zone 'Asia/Seoul')::date - interval '14 years' + interval '1 day'
    where id = '00000000-0000-4000-8000-000000001401';
  exception
    when check_violation then
      if sqlerrm not like '%minimum_age_required%' then
        raise exception 'unexpected check violation: %', sqlerrm;
      end if;
      return;
  end;

  raise exception 'under-14 birth_date update should be rejected';
end;
$$;

-- 3. 명백한 미성년도 같은 경로로 막힌다 — 법정대리인 동의 예외는 없다.
do $$
begin
  begin
    update public.profiles
    set birth_date = (now() at time zone 'Asia/Seoul')::date - interval '6 years'
    where id = '00000000-0000-4000-8000-000000001401';
  exception
    when check_violation then
      return;
  end;

  raise exception 'child birth_date update should be rejected';
end;
$$;

-- 4. 미래 날짜도 같은 게이트에 걸린다. age() 가 음수를 내므로 별도 분기가 필요 없다.
do $$
begin
  begin
    update public.profiles
    set birth_date = (now() at time zone 'Asia/Seoul')::date + interval '1 day'
    where id = '00000000-0000-4000-8000-000000001401';
  exception
    when check_violation then
      return;
  end;

  raise exception 'future birth_date update should be rejected';
end;
$$;

-- 5. 거부된 갱신이 기존 값을 남기지 않았는지 확인한다.
select 1 / case when (
  select birth_date
  from public.profiles
  where id = '00000000-0000-4000-8000-000000001401'
) = ((now() at time zone 'Asia/Seoul')::date - interval '14 years')::date
then 1 else 0 end as assert_rejected_updates_left_row_untouched;

-- 6. 생년월일을 건드리지 않는 갱신은 이 게이트를 지나지 않는다.
--    닉네임 변경이 나이 판정에 걸리면, 이미 저장된 계정의 다른 편집까지 막힌다.
update public.profiles
set nickname = 'age-gate-smoke'
where id = '00000000-0000-4000-8000-000000001401';

select 1 / case when (
  select nickname
  from public.profiles
  where id = '00000000-0000-4000-8000-000000001401'
) = 'age-gate-smoke' then 1 else 0 end as assert_unrelated_update_is_not_gated;

-- 7. 앱 구현(lib/age/minimum-age.ts)과 같은 윤년 규칙인지 고정한다.
--    2월 29일생은 평년에 3월 1일 도래한다. 2월 28일에 도래시키면 판정이 하루 이르다.
select 1 / case when
  pg_catalog.date_part('year', pg_catalog.age(date '2026-02-28', date '2012-02-29')) = 13
  and pg_catalog.date_part('year', pg_catalog.age(date '2026-03-01', date '2012-02-29')) = 14
  and pg_catalog.date_part('year', pg_catalog.age(date '2028-02-29', date '2012-02-29')) = 16
then 1 else 0 end as assert_leap_day_birthday_matches_app_rule;

rollback;
