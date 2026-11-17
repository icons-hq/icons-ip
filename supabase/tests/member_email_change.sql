\set ON_ERROR_STOP on
-- 2026-11-17 — 로그인 이메일이 쓸 수 없는 주소(Apple 이메일 가리기 릴레이·빈 값)인 회원의 이메일 변경.
-- 봉인·대상 계정 제한·한도·오입력 잠금·만료·'이미 쓰는 주소'는 코드를 맞힌 뒤에만·프로필 이메일 동기화·탈퇴 봉인 시 파기·보관 기한.
begin;
create function pg_temp.mail_error(q text, wanted text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if position(wanted in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected error %', wanted;
end $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
 select ('e1170000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.cid(n integer) returns uuid language sql immutable as $$
 select ('e1170001-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
-- 앱이 만드는 base64url HMAC 다이제스트(43자)와 같은 모양의 고정값.
create function pg_temp.d(label text) returns text language sql immutable as $$
 select rpad(regexp_replace(label,'[^A-Za-z0-9_-]','_','g'),43,'x') $$;
create function pg_temp.issue(n_user integer, n_challenge integer, email text, ip_digest text, code text)
returns jsonb language sql as $$
 select public.service_issue_member_email_change(pg_temp.cid(n_challenge), pg_temp.uid(n_user), email,
  pg_temp.d('mail '||email), case when ip_digest is null then null else pg_temp.d(ip_digest) end, pg_temp.d('code '||code), 600) $$;
create function pg_temp.verify(n_user integer, n_challenge integer, code text) returns jsonb language sql as $$
 select public.service_verify_member_email_change(pg_temp.cid(n_challenge), pg_temp.uid(n_user), pg_temp.d('code '||code)) $$;
create temp table mail_results(name text primary key, value jsonb) on commit drop;
create function pg_temp.keep(label text, value jsonb) returns void language sql as $$
 insert into mail_results values(label, value) $$;
create function pg_temp.r(label text) returns jsonb language sql stable as $$
 select value from mail_results where name=label $$;
-- 60초 재발송 간격을 지난 것처럼 기존 요청을 과거로 민다.
create function pg_temp.age_challenges(seconds integer) returns void language sql as $$
 update private.member_email_change_challenges
  set created_at = created_at - make_interval(secs => seconds), expires_at = expires_at - make_interval(secs => seconds),
   resolved_at = resolved_at - make_interval(secs => seconds) $$;

-- 1~4: Apple 릴레이 주소, 5: 일반 이메일, 6: 이미 다른 회원이 쓰는 주소의 주인
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.uid(n),'authenticated','authenticated',
  case when n<=4 then 'relay'||n||'@privaterelay.appleid.com' when n=5 then 'member-mail-5@example.test' else 'taken@example.test' end,
  now(),'{}','{}',now(),now()
 from generate_series(1,6) n;
update public.profiles set nickname='TEST 메일'||right(id::text,2), birth_date='1990-01-01',
 consents='{"terms":true,"privacy":true}', onboarded_at=now() where id::text like 'e1170000-%';

-- 봉인: 표는 어느 API 롤에도 열리지 않고, 서비스 RPC는 service_role에만 열린다.
select 1/case when not has_table_privilege('authenticated','private.member_email_change_challenges','select')
 and not has_table_privilege('service_role','private.member_email_change_challenges','select')
 and has_function_privilege('service_role','public.service_issue_member_email_change(uuid,uuid,text,text,text,text,integer)','execute')
 and not has_function_privilege('authenticated','public.service_issue_member_email_change(uuid,uuid,text,text,text,text,integer)','execute')
 and not has_function_privilege('anon','public.service_issue_member_email_change(uuid,uuid,text,text,text,text,integer)','execute')
 and has_function_privilege('service_role','public.service_verify_member_email_change(uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','public.service_verify_member_email_change(uuid,uuid,text)','execute')
 and has_function_privilege('service_role','public.service_fail_member_email_change(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.service_fail_member_email_change(uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.member_login_email_unusable(uuid)','execute')
 and not has_function_privilege('service_role','private.member_email_change_rate_limited(text,text,integer,integer)','execute')
 and not has_function_privilege('service_role','private.prune_member_email_change_challenges(integer)','execute')
 then 1 else 0 end as assert_sealed;

-- 입력 모양: 대문자·공백이 섞인 주소는 앱이 정규화해서 넘겨야 한다.
select pg_temp.mail_error($q$select pg_temp.issue(1, 90, 'New@Example.test', null, '111111')$q$, 'invalid_member_email_change');

-- 일반 이메일 계정은 이 경로로 바꾸지 않는다(현재 주소 확인을 건너뛰지 않게).
select 1/case when pg_temp.issue(5, 1, 'other5@example.test', null, '111111')->>'reason'='not_eligible' then 1 else 0 end as assert_regular_email_not_eligible;
select 1/case when not exists(select 1 from private.member_email_change_challenges where user_id=pg_temp.uid(5)) then 1 else 0 end as assert_refusal_leaves_no_row;
-- 새 주소도 릴레이면 안 된다. 같은 주소로 바꾸는 요청도 거절한다.
select 1/case when pg_temp.issue(1, 2, 'another@privaterelay.appleid.com', null, '111111')->>'reason'='email_unusable' then 1 else 0 end as assert_relay_target_refused;
select 1/case when pg_temp.issue(1, 3, 'relay1@privaterelay.appleid.com', null, '111111')->>'reason'='email_unusable' then 1 else 0 end as assert_same_relay_refused;

-- 정상 요청 → 60초 안 재요청은 대기 → 틀린 코드는 남은 횟수 → 맞는 코드는 새 주소를 돌려주고 원문을 지운다.
select pg_temp.keep('issued', pg_temp.issue(1, 10, 'real1@example.test', 'ip a', '123456'));
select 1/case when (pg_temp.r('issued')->>'ok')::boolean then 1 else 0 end as assert_issued;
select 1/case when pg_temp.issue(1, 11, 'real1b@example.test', 'ip a', '222222')->>'reason'='cooldown' then 1 else 0 end as assert_cooldown;
select pg_temp.keep('mismatch', pg_temp.verify(1, 10, '000000'));
select 1/case when pg_temp.r('mismatch')->>'reason'='mismatch' and (pg_temp.r('mismatch')->>'remainingAttempts')::int=4 then 1 else 0 end as assert_mismatch_counts;
select pg_temp.keep('verified', pg_temp.verify(1, 10, '123456'));
select 1/case when (pg_temp.r('verified')->>'ok')::boolean and pg_temp.r('verified')->>'email'='real1@example.test' then 1 else 0 end as assert_verified_returns_email;
select 1/case when (select status='verified' and email is null and resolved_at is not null from private.member_email_change_challenges where id=pg_temp.cid(10)) then 1 else 0 end as assert_verified_row_erased;
select 1/case when pg_temp.verify(1, 10, '123456')->>'reason'='verified' then 1 else 0 end as assert_code_single_use;

-- 프로필 이메일 동기화: 앱이 Admin API로 로그인 이메일을 바꾸면 profiles.email도 같은 값이 된다.
update auth.users set email='real1@example.test' where id=pg_temp.uid(1);
select 1/case when (select email='real1@example.test' from public.profiles where id=pg_temp.uid(1)) then 1 else 0 end as assert_profile_email_synced;
-- 바꾼 뒤에는 더 이상 이 경로의 대상이 아니다.
select pg_temp.age_challenges(120);
select 1/case when pg_temp.issue(1, 12, 'real1c@example.test', null, '333333')->>'reason'='not_eligible' then 1 else 0 end as assert_changed_account_not_eligible;

-- 다른 회원이 쓰는 주소: 요청은 받되(조회가 되지 않게) 코드를 맞힌 뒤에야 email_taken으로 닫는다. 틀린 코드에는 알리지 않는다.
select pg_temp.keep('taken_issue', pg_temp.issue(2, 20, 'taken@example.test', 'ip b', '444444'));
select 1/case when (pg_temp.r('taken_issue')->>'ok')::boolean then 1 else 0 end as assert_taken_issue_looks_normal;
select 1/case when pg_temp.verify(2, 20, '000000')->>'reason'='mismatch' then 1 else 0 end as assert_taken_hidden_on_wrong_code;
select 1/case when pg_temp.verify(2, 20, '444444')->>'reason'='email_taken' then 1 else 0 end as assert_taken_after_code;
select 1/case when (select status='email_taken' and email is null from private.member_email_change_challenges where id=pg_temp.cid(20)) then 1 else 0 end as assert_taken_row_erased;

-- 5번 틀리면 닫힌다.
select pg_temp.age_challenges(120);
select pg_temp.issue(3, 30, 'real3@example.test', null, '555555');
select pg_temp.verify(3, 30, '000001'); select pg_temp.verify(3, 30, '000002'); select pg_temp.verify(3, 30, '000003'); select pg_temp.verify(3, 30, '000004');
select 1/case when pg_temp.verify(3, 30, '000005')->>'reason'='exhausted' then 1 else 0 end as assert_exhausted;
select 1/case when pg_temp.verify(3, 30, '555555')->>'reason'='exhausted' then 1 else 0 end as assert_exhausted_stays_closed;

-- 만료.
select pg_temp.age_challenges(120);
select pg_temp.issue(3, 31, 'real3@example.test', null, '666666');
update private.member_email_change_challenges set expires_at=created_at-interval '1 second', created_at=created_at-interval '1 hour' where id=pg_temp.cid(31);
select 1/case when pg_temp.verify(3, 31, '666666')->>'reason'='expired' then 1 else 0 end as assert_expired;

-- 새 요청은 진행 중 요청을 대신한다.
select pg_temp.age_challenges(120);
select pg_temp.issue(3, 32, 'real3@example.test', null, '777777');
select pg_temp.age_challenges(120);
select pg_temp.issue(3, 33, 'real3@example.test', null, '888888');
select 1/case when pg_temp.verify(3, 32, '777777')->>'reason'='superseded' then 1 else 0 end as assert_superseded;

-- 발송 실패는 요청을 닫고 원문을 지운다.
select public.service_fail_member_email_change(pg_temp.cid(33), pg_temp.uid(3));
select 1/case when (select status='send_failed' and email is null from private.member_email_change_challenges where id=pg_temp.cid(33)) then 1 else 0 end as assert_send_failed_closed;

-- 회원 한도(1시간 5건): 3번 회원은 최근 1시간에 3건(30·32·33, 31은 한 시간 전으로 밀었다)을 썼다. 두 건 더 받고, 그다음은 막힌다.
select pg_temp.age_challenges(61);
select 1/case when (pg_temp.issue(3, 34, 'real3@example.test', null, '999999')->>'ok')::boolean then 1 else 0 end as assert_fourth_allowed;
select pg_temp.age_challenges(61);
select 1/case when (pg_temp.issue(3, 35, 'real3@example.test', null, '999998')->>'ok')::boolean then 1 else 0 end as assert_fifth_allowed;
select pg_temp.age_challenges(61);
select 1/case when pg_temp.issue(3, 36, 'real3@example.test', null, '999997')->>'reason'='rate_limited' then 1 else 0 end as assert_member_rate_limited;

-- 빈 이메일 계정도 대상이다.
update auth.users set email=null where id=pg_temp.uid(4);
select 1/case when (pg_temp.issue(4, 40, 'real4@example.test', null, '121212')->>'ok')::boolean then 1 else 0 end as assert_blank_email_eligible;

-- 탈퇴 신청(계정 봉인): 그 회원의 요청 행을 지우고, 이후 요청은 받지 않는다. 봉인된 계정의 Auth 이메일 변경은 프로필 쓰기를 건드리지 않는다.
insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status)
 values('e1170002-0000-4000-8000-000000000001',pg_temp.uid(4),'e1170002-0000-4000-8000-000000000002','blocked_active_obligation');
insert into private.account_action_fences(subject_user_id,deletion_event_id) values(pg_temp.uid(4),'e1170002-0000-4000-8000-000000000001');
select 1/case when not exists(select 1 from private.member_email_change_challenges where user_id=pg_temp.uid(4)) then 1 else 0 end as assert_fence_erases;
select 1/case when pg_temp.issue(4, 41, 'real4@example.test', null, '131313')->>'reason'='account_unavailable' then 1 else 0 end as assert_fenced_refused;
update auth.users set email='fenced4@example.test' where id=pg_temp.uid(4);
select 1/case when (select email is distinct from 'fenced4@example.test' from public.profiles where id=pg_temp.uid(4)) then 1 else 0 end as assert_fenced_profile_untouched;

-- 보관 기한: 이틀 지난 요청 행은 지운다.
update private.member_email_change_challenges set created_at=created_at-interval '3 days', expires_at=expires_at-interval '3 days',
 resolved_at=resolved_at-interval '3 days' where user_id=pg_temp.uid(3);
select pg_temp.keep('pruned', to_jsonb(private.prune_member_email_change_challenges()));
select 1/case when (pg_temp.r('pruned')#>>'{}')::int >= 6
 and not exists(select 1 from private.member_email_change_challenges where user_id=pg_temp.uid(3)) then 1 else 0 end as assert_pruned;

rollback;
