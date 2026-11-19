\set ON_ERROR_STOP on
-- 카카오 계정 상태 변경 웹훅(user-unlinked) — 봉인·형식 거절·다른 수단 회원의 연결 끊기(공급자 목록·카카오 메타 정리)·
-- 대표 공급자 교체·재전송 멱등·카카오만 회원의 탈퇴 검토 대기·비밀번호 없는 이메일 identity·알림 뒤 재로그인(relinked·대기
-- 목록 제외)·같은 초 로그인 여유·탈퇴 처리 회원 제외·모르는 회원번호·미래 시각 보정·회원 삭제 시 원장 정리.
begin;
create function pg_temp.unlink_error(q text, wanted text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if position(wanted in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected error %', wanted;
end $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
 select ('a6271800-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create temp table unlink_results(name text primary key, value jsonb) on commit drop;
create function pg_temp.keep(label text, value jsonb) returns void language sql as $$
 insert into unlink_results values(label, value) $$;
create function pg_temp.r(label text) returns jsonb language sql stable as $$
 select value from unlink_results where name=label $$;

-- 1: 이메일(비밀번호)로 가입 후 카카오를 연결(마지막 로그인은 카카오라 user metadata가 카카오 값).
-- 2·3·4·7·8: 카카오로만 가입. 5: 카카오 가입 후 관리 API로 이메일을 바꿔 비밀번호 없는 이메일 identity가 생긴 회원.
-- 6: 카카오로 가입한 뒤 Google을 연결(대표 공급자가 kakao).
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.uid(n),'authenticated','authenticated','kakao-unlink-'||n||'@example.test',
   case when n=1 then '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234' else '' end,now(),
   case when n=1 then '{"provider":"email","providers":["email","kakao"]}'::jsonb
        when n=5 then '{"provider":"kakao","providers":["email","kakao"]}'::jsonb
        when n=6 then '{"provider":"kakao","providers":["google","kakao"]}'::jsonb
        else '{"provider":"kakao","providers":["kakao"]}'::jsonb end,
   case when n=1 then '{"name":"카카오닉","avatar_url":"https://k.kakaocdn.net/a.jpg","provider_id":"1111111111","sub":"1111111111","email":"kakao-unlink-1@example.test","onboarding_note":"keep"}'::jsonb
        else '{}'::jsonb end,
   now()-interval '10 days',now()-interval '10 days'
 from generate_series(1,8) n;
insert into auth.identities(provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
 values('1111111111',pg_temp.uid(1),'{"sub":"1111111111","provider_id":"1111111111","name":"카카오닉","avatar_url":"https://k.kakaocdn.net/a.jpg","email":"kakao-unlink-1@example.test"}','kakao',now()-interval '2 days',now()-interval '5 days',now()-interval '2 days'),
       (pg_temp.uid(1)::text,pg_temp.uid(1),jsonb_build_object('sub',pg_temp.uid(1)::text,'email','kakao-unlink-1@example.test'),'email',now()-interval '9 days',now()-interval '10 days',now()-interval '9 days'),
       ('2222222222',pg_temp.uid(2),'{"sub":"2222222222"}','kakao',now()-interval '2 days',now()-interval '10 days',now()-interval '2 days'),
       ('3333333333',pg_temp.uid(3),'{"sub":"3333333333"}','kakao',now()-interval '2 days',now()-interval '10 days',now()-interval '2 days'),
       ('4444444444',pg_temp.uid(4),'{"sub":"4444444444"}','kakao',now()-interval '2 days',now()-interval '10 days',now()-interval '2 days'),
       ('5555555555',pg_temp.uid(5),'{"sub":"5555555555"}','kakao',now()-interval '2 days',now()-interval '10 days',now()-interval '2 days'),
       (pg_temp.uid(5)::text,pg_temp.uid(5),jsonb_build_object('sub',pg_temp.uid(5)::text,'email','kakao-unlink-5@example.test'),'email',null,now()-interval '3 days',now()-interval '3 days'),
       ('6666666666',pg_temp.uid(6),'{"sub":"6666666666","name":"카카오육"}','kakao',now()-interval '2 days',now()-interval '10 days',now()-interval '2 days'),
       ('g-6',pg_temp.uid(6),'{"sub":"g-6","email":"kakao-unlink-6@example.test"}','google',now()-interval '4 days',now()-interval '4 days',now()-interval '4 days'),
       ('7777777777',pg_temp.uid(7),'{"sub":"7777777777"}','kakao',now()-interval '2 days',now()-interval '10 days',now()-interval '2 days'),
       ('8888888888',pg_temp.uid(8),'{"sub":"8888888888"}','kakao',now()-interval '2 days',now()-interval '10 days',now()-interval '2 days');

-- 봉인: 원장·대기 목록은 어느 API 롤에도 열리지 않고, RPC는 service_role에만 열린다.
select 1/case when not has_table_privilege('service_role','private.kakao_unlink_events','select')
 and not has_table_privilege('authenticated','private.kakao_unlink_events','select')
 and not has_table_privilege('anon','private.kakao_unlink_events','select')
 and not has_table_privilege('service_role','private.kakao_unlink_withdrawal_queue','select')
 and not has_table_privilege('authenticated','private.kakao_unlink_withdrawal_queue','select')
 and has_function_privilege('service_role','public.service_record_kakao_unlink(text,text,text,timestamptz)','execute')
 and not has_function_privilege('authenticated','public.service_record_kakao_unlink(text,text,text,timestamptz)','execute')
 and not has_function_privilege('anon','public.service_record_kakao_unlink(text,text,text,timestamptz)','execute')
 and not has_function_privilege('public','public.service_record_kakao_unlink(text,text,text,timestamptz)','execute')
 and (select relrowsecurity from pg_class where oid='private.kakao_unlink_events'::regclass)
 then 1 else 0 end as sealed;

-- 형식이 틀린 요청은 거절한다.
select pg_temp.unlink_error($q$select public.service_record_kakao_unlink('', '1111111111', 'ACCOUNT_DELETE', now())$q$,'invalid_kakao_unlink_event');
select pg_temp.unlink_error($q$select public.service_record_kakao_unlink('e', '0111', 'ACCOUNT_DELETE', now())$q$,'invalid_kakao_unlink_event');
select pg_temp.unlink_error($q$select public.service_record_kakao_unlink('e', '1111111111', 'account_delete', now())$q$,'invalid_kakao_unlink_event');
select pg_temp.unlink_error($q$select public.service_record_kakao_unlink('e', '1111111111', 'ACCOUNT_DELETE', null)$q$,'invalid_kakao_unlink_event');
select 1/case when not exists (select 1 from private.kakao_unlink_events) then 1 else 0 end as invalid_left_nothing;

-- 비밀번호가 있는 이메일 identity가 있는 회원: 카카오 identity만 지우고, 공급자 목록을 맞추고, 카카오 값인 메타만 지운다.
select pg_temp.keep('linked', public.service_record_kakao_unlink('set-1', '1111111111', 'UNLINK_FROM_APPS', now()-interval '1 hour'));
select 1/case when pg_temp.r('linked')->>'status'='identity_unlinked' and (pg_temp.r('linked')->>'replayed')::boolean = false
 and not exists (select 1 from auth.identities where user_id=pg_temp.uid(1) and provider='kakao')
 and exists (select 1 from auth.identities where user_id=pg_temp.uid(1) and provider='email')
 and (select raw_app_meta_data from auth.users where id=pg_temp.uid(1)) = '{"provider":"email","providers":["email"]}'::jsonb
 and (select raw_user_meta_data from auth.users where id=pg_temp.uid(1)) = '{"onboarding_note":"keep"}'::jsonb
 and (select email from auth.users where id=pg_temp.uid(1)) = 'kakao-unlink-1@example.test'
 and (select email from public.profiles where id=pg_temp.uid(1)) = 'kakao-unlink-1@example.test'
 then 1 else 0 end as other_method_member_unlinked;
select 1/case when (select row(user_id, reason, outcome)::text from private.kakao_unlink_events where event_id='set-1')
   = row(pg_temp.uid(1), 'UNLINK_FROM_APPS', 'identity_unlinked')::text
 then 1 else 0 end as ledger_has_no_member_number;

-- 같은 이벤트의 재전송은 처음 결과를 돌려주고 아무것도 다시 하지 않는다.
select pg_temp.keep('replay', public.service_record_kakao_unlink('set-1', '1111111111', 'UNLINK_FROM_APPS', now()-interval '1 hour'));
select 1/case when pg_temp.r('replay') = '{"status":"identity_unlinked","replayed":true}'::jsonb
 and (select count(*) from private.kakao_unlink_events where event_id='set-1') = 1
 and exists (select 1 from auth.identities where user_id=pg_temp.uid(1) and provider='email')
 then 1 else 0 end as replay_is_idempotent;

-- 같은 회원번호의 다른 이벤트: identity가 이미 없으므로 회원을 특정하지 않는다.
select pg_temp.keep('gone', public.service_record_kakao_unlink('set-1b', '1111111111', 'ACCOUNT_DELETE', now()-interval '30 minutes'));
select 1/case when pg_temp.r('gone')->>'status'='no_member'
 and (select user_id from private.kakao_unlink_events where event_id='set-1b') is null
 then 1 else 0 end as detached_member_not_reidentified;

-- 대표 공급자가 카카오였던 회원(카카오 가입 후 Google 연결): 카카오만 지우고 대표 공급자를 남은 공급자로 바꾼다.
select pg_temp.keep('primary', public.service_record_kakao_unlink('set-6', '6666666666', 'UNLINK_FROM_APPS', now()-interval '1 hour'));
select 1/case when pg_temp.r('primary')->>'status'='identity_unlinked'
 and not exists (select 1 from auth.identities where user_id=pg_temp.uid(6) and provider='kakao')
 and exists (select 1 from auth.identities where user_id=pg_temp.uid(6) and provider='google')
 and (select raw_app_meta_data from auth.users where id=pg_temp.uid(6)) = '{"provider":"google","providers":["google"]}'::jsonb
 then 1 else 0 end as primary_provider_replaced;

-- 카카오로만 가입한 회원: 계정·identity를 두고 탈퇴 검토 대기로 남긴다.
select pg_temp.keep('only', public.service_record_kakao_unlink('set-2', '2222222222', 'ACCOUNT_DELETE', now()-interval '1 hour'));
select 1/case when pg_temp.r('only')->>'status'='withdrawal_review'
 and exists (select 1 from auth.identities where user_id=pg_temp.uid(2) and provider='kakao')
 and (select raw_app_meta_data from auth.users where id=pg_temp.uid(2)) = '{"provider":"kakao","providers":["kakao"]}'::jsonb
 and exists (select 1 from private.kakao_unlink_withdrawal_queue where user_id=pg_temp.uid(2) and reason='ACCOUNT_DELETE')
 then 1 else 0 end as kakao_only_member_queued;

-- 비밀번호 없는 이메일 identity는 다른 로그인 수단으로 세지 않는다(카카오를 지우면 로그인할 수 없게 된다).
select pg_temp.keep('passwordless', public.service_record_kakao_unlink('set-5', '5555555555', 'UNLINK_FROM_APPS', now()-interval '1 hour'));
select 1/case when pg_temp.r('passwordless')->>'status'='withdrawal_review'
 and exists (select 1 from auth.identities where user_id=pg_temp.uid(5) and provider='kakao')
 and (select raw_app_meta_data from auth.users where id=pg_temp.uid(5)) = '{"provider":"kakao","providers":["email","kakao"]}'::jsonb
 and exists (select 1 from private.kakao_unlink_withdrawal_queue where user_id=pg_temp.uid(5))
 then 1 else 0 end as passwordless_email_not_counted;

-- 알림보다 나중에 카카오로 다시 로그인한 회원은 바꾸지 않는다(늦게 온 재전송).
select pg_temp.keep('late', public.service_record_kakao_unlink('set-3', '3333333333', 'UNLINK_FROM_APPS', now()-interval '3 days'));
select 1/case when pg_temp.r('late')->>'status'='relinked'
 and exists (select 1 from auth.identities where user_id=pg_temp.uid(3) and provider='kakao')
 and not exists (select 1 from private.kakao_unlink_withdrawal_queue where user_id=pg_temp.uid(3))
 then 1 else 0 end as stale_event_ignored;

-- 알림 시각(toe)은 초 단위로 잘린다. 같은 초 안의 로그인 기록은 '다시 로그인'으로 보지 않는다.
update auth.identities set last_sign_in_at=date_trunc('second', now()-interval '1 hour')+interval '400 milliseconds'
 where user_id=pg_temp.uid(7) and provider='kakao';
select pg_temp.keep('same_second', public.service_record_kakao_unlink('set-7', '7777777777', 'INCOMPLETE_SIGN_UP', date_trunc('second', now()-interval '1 hour')));
select 1/case when pg_temp.r('same_second')->>'status'='withdrawal_review'
 and exists (select 1 from private.kakao_unlink_withdrawal_queue where user_id=pg_temp.uid(7))
 then 1 else 0 end as same_second_login_not_relinked;

-- 대기 중이던 회원이 알림 뒤 카카오로 다시 로그인하면(GoTrue가 identity를 갱신) 대기 목록에서 빠진다.
select pg_temp.keep('queued', public.service_record_kakao_unlink('set-4', '4444444444', 'UNLINK_FROM_APPS', now()-interval '1 hour'));
select 1/case when pg_temp.r('queued')->>'status'='withdrawal_review'
 and exists (select 1 from private.kakao_unlink_withdrawal_queue where user_id=pg_temp.uid(4))
 then 1 else 0 end as queued_before_relogin;
update auth.identities set last_sign_in_at=now(), updated_at=now() where user_id=pg_temp.uid(4) and provider='kakao';
select 1/case when not exists (select 1 from private.kakao_unlink_withdrawal_queue where user_id=pg_temp.uid(4))
 then 1 else 0 end as relogin_leaves_queue;

-- 카카오 시계가 앞서 미래 시각이 와도 지금으로 줄여 기록한다. 줄이지 않으면 그 시각 전의 재로그인이 목록에서 빠지지 않는다.
select pg_temp.keep('future', public.service_record_kakao_unlink('set-8', '8888888888', 'UNLINK_FROM_ADMIN', now()+interval '1 day'));
select 1/case when pg_temp.r('future')->>'status'='withdrawal_review'
 and (select event_at from private.kakao_unlink_events where event_id='set-8') <= clock_timestamp()
 then 1 else 0 end as future_event_clamped;
update auth.identities set last_sign_in_at=clock_timestamp()+interval '1 minute', updated_at=clock_timestamp()+interval '1 minute'
 where user_id=pg_temp.uid(8) and provider='kakao';
select 1/case when not exists (select 1 from private.kakao_unlink_withdrawal_queue where user_id=pg_temp.uid(8))
 then 1 else 0 end as clamped_event_lets_relogin_leave_queue;

-- 어드민에서 탈퇴를 처리한 회원은 대기 목록에서 빠진다(문의로 받은 탈퇴 처리, 20261118165000).
select 1/case when exists (select 1 from private.kakao_unlink_withdrawal_queue where user_id=pg_temp.uid(7))
 then 1 else 0 end as queued_before_withdrawal;
insert into private.member_withdrawal_processings(user_id, inquiry_reference) values (pg_temp.uid(7), 1);
select 1/case when not exists (select 1 from private.kakao_unlink_withdrawal_queue where user_id=pg_temp.uid(7))
 then 1 else 0 end as processed_withdrawal_leaves_queue;

-- 모르는 회원번호는 기록만 한다.
select pg_temp.keep('unknown', public.service_record_kakao_unlink('set-9', '9999999999', 'INCOMPLETE_SIGN_UP', now()));
select 1/case when pg_temp.r('unknown')->>'status'='no_member'
 and (select user_id from private.kakao_unlink_events where event_id='set-9') is null
 then 1 else 0 end as unknown_member_recorded;

-- 회원(auth.users)이 지워지면 그 회원의 원장도 함께 지워진다.
delete from auth.users where id=pg_temp.uid(2);
select 1/case when not exists (select 1 from private.kakao_unlink_events where event_id='set-2')
 and not exists (select 1 from private.kakao_unlink_withdrawal_queue where user_id=pg_temp.uid(2))
 then 1 else 0 end as member_delete_cascades;

rollback;
