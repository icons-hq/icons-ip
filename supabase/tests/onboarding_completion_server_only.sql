\set ON_ERROR_STOP on
-- 온보딩 완료(profiles.onboarded_at)를 서버가 기록하는 service_role 전용 RPC. authenticated·anon은 부를 수 없고,
-- 휴대폰 인증이 필요하면 인증된 번호를 다시 확인하며, 이미 마친 계정의 시각은 바꾸지 않는다.
-- authenticated의 onboarded_at 열 직접 update는 2단계 migration(20261118157000)으로 회수돼 권한 오류로 거절된다.
begin;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
 select ('a6271800-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.expect_error(q text, wanted text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if position(wanted in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected error %', wanted;
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.uid(n),'authenticated','authenticated','onboard-server-'||n||'@example.test',now(),'{}','{}',now(),now()
 from generate_series(1,4) n;
-- 1·2·3번은 1단계(생년월일·동의)를 마쳤고 4번은 아직이다.
update public.profiles set nickname='TEST 온보딩'||right(id::text,2), birth_date='1990-01-01',
 consents='{"terms":true,"privacy":true}', onboarded_at=null where id in (pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3));
update public.profiles set nickname='TEST 온보딩04', birth_date=null, consents='{}', onboarded_at=null where id=pg_temp.uid(4);
-- 3번만 인증된 번호가 있다.
insert into private.member_phone_numbers(user_id, phone_e164, verified_at) values (pg_temp.uid(3), '+821012340003', now());

-- 선언적 단언: 열 권한과 RPC 봉인.
select 1/case when not has_column_privilege('authenticated','public.profiles','onboarded_at','UPDATE')
 and not has_column_privilege('anon','public.profiles','onboarded_at','UPDATE')
 and has_column_privilege('authenticated','public.profiles','birth_date','UPDATE')
 and has_column_privilege('authenticated','public.profiles','consents','UPDATE') then 1 else 0 end as assert_onboarded_at_not_client_writable;
select 1/case when has_function_privilege('service_role','public.service_complete_member_onboarding(uuid,boolean)','execute')
 and not has_function_privilege('authenticated','public.service_complete_member_onboarding(uuid,boolean)','execute')
 and not has_function_privilege('anon','public.service_complete_member_onboarding(uuid,boolean)','execute')
 and not has_function_privilege('public','public.service_complete_member_onboarding(uuid,boolean)','execute') then 1 else 0 end as assert_complete_rpc_sealed;

-- 런타임: 로그인한 회원이 직접 쓰거나 완료 RPC를 부르면 거절된다(휴대폰 인증 우회 시도).
select set_config('request.jwt.claim.sub', pg_temp.uid(1)::text, true);
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(1)::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.expect_error(format('update public.profiles set onboarded_at = now() where id = %L', pg_temp.uid(1)), 'permission denied');
select pg_temp.expect_error(format('select public.service_complete_member_onboarding(%L, false)', pg_temp.uid(1)), 'permission denied');
reset role;
select 1/case when (select onboarded_at is null from public.profiles where id=pg_temp.uid(1)) then 1 else 0 end as assert_direct_write_left_no_trace;

-- service_role 경로.
set local role service_role;
-- 1단계 전(4번)은 끝낼 수 없다.
select pg_temp.expect_error(format('select public.service_complete_member_onboarding(%L, false)', pg_temp.uid(4)), 'onboarding_step_required');
-- 번호 인증이 필요한 배포에서 번호 없는 계정(2번)은 끝낼 수 없다.
select pg_temp.expect_error(format('select public.service_complete_member_onboarding(%L, true)', pg_temp.uid(2)), 'onboarding_phone_required');
select pg_temp.expect_error(format('select public.service_complete_member_onboarding(%L, null)', pg_temp.uid(2)), 'onboarding_completion_invalid');
select pg_temp.expect_error(format('select public.service_complete_member_onboarding(%L, false)', gen_random_uuid()), 'onboarding_profile_missing');
-- 스위치가 꺼진 배포는 번호 없이 끝낼 수 있고, 켜진 배포는 인증된 번호가 있어야 한다.
select public.service_complete_member_onboarding(pg_temp.uid(2), false);
select public.service_complete_member_onboarding(pg_temp.uid(3), true);
-- 이미 마친 계정은 시각이 바뀌지 않는다(번호 없이 true로 불러도 그대로).
create temp table first_at on commit drop as select onboarded_at from public.profiles where id=pg_temp.uid(2);
select public.service_complete_member_onboarding(pg_temp.uid(2), true);
reset role;
select 1/case when (select onboarded_at is not null from public.profiles where id=pg_temp.uid(3))
 and (select onboarded_at is not null from public.profiles where id=pg_temp.uid(2))
 and (select onboarded_at is null from public.profiles where id=pg_temp.uid(4))
 and (select p.onboarded_at = f.onboarded_at from public.profiles p, first_at f where p.id=pg_temp.uid(2)) then 1 else 0 end as assert_server_completion_results;

-- 새 회원은 국가를 고른 뒤에만 마칠 수 있고, 기존 완료·재인증 회원은 소급해 요구하지 않는다.
set local role service_role;
select pg_temp.expect_error(format('select public.service_complete_member_onboarding_v2(%L, false)', pg_temp.uid(1)), 'onboarding_residence_country_required');
select public.service_complete_member_onboarding_v2(pg_temp.uid(2), true);
reset role;

set local role authenticated;
select pg_temp.expect_error(format('select public.service_complete_member_onboarding_v2(%L, false)', pg_temp.uid(1)), 'permission denied');
select pg_temp.expect_error(format('update public.profiles set residence_country_code = %L where id = %L', 'ZZ', pg_temp.uid(1)), 'profiles_residence_country_code_valid');
update public.profiles set residence_country_code = 'CA' where id = pg_temp.uid(1);
select 1/case when (select residence_country_code = 'CA' from public.profiles where id = pg_temp.uid(1))
  and not exists(select residence_country_code from public.profiles where id = pg_temp.uid(2)) then 1 else 0 end as assert_only_own_country;
reset role;

set local role service_role;
select pg_temp.expect_error(format('select public.service_complete_member_onboarding_v2(%L, true)', pg_temp.uid(1)), 'onboarding_phone_required');
select public.service_complete_member_onboarding_v2(pg_temp.uid(1), false);
reset role;
select private.erase_withdrawn_member_profile(pg_temp.uid(1));
select 1/case when (select residence_country_code is null from public.profiles where id = pg_temp.uid(1))
  then 1 else 0 end as assert_country_erased;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '{}', true);
set local role anon;
select 1/case when not exists (select residence_country_code from public.profiles) then 1 else 0 end as assert_anonymous_read_is_empty;
reset role;
rollback;
