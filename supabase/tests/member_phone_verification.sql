\set ON_ERROR_STOP on
-- 1014-005·006 — 휴대폰 번호 인증(자체 인증번호). 봉인·동의 전 수집 거절·한도·오입력 잠금·만료·
-- 옮기기와 재인증 필요 표시·탈퇴 봉인 시 파기·보관 기한.
begin;
create function pg_temp.phone_error(q text, wanted text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if position(wanted in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected error %', wanted;
end $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
 select ('a6271200-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.cid(n integer) returns uuid language sql immutable as $$
 select ('a6271201-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
-- 앱이 만드는 base64url HMAC 다이제스트(43자)와 같은 모양의 고정값.
create function pg_temp.d(label text) returns text language sql immutable as $$
 select rpad(replace(label,' ','_'),43,'x') $$;
create function pg_temp.issue(n_user integer, n_challenge integer, phone text, phone_digest text, ip_digest text, code text)
returns jsonb language sql as $$
 select public.service_issue_member_phone_verification(pg_temp.cid(n_challenge), pg_temp.uid(n_user), phone,
  pg_temp.d(phone_digest), case when ip_digest is null then null else pg_temp.d(ip_digest) end, pg_temp.d('code '||code), 300) $$;
create function pg_temp.verify(n_user integer, n_challenge integer, code text) returns jsonb language sql as $$
 select public.service_verify_member_phone_verification(pg_temp.cid(n_challenge), pg_temp.uid(n_user), pg_temp.d('code '||code)) $$;
-- SQL은 한 식 안의 호출 순서를 보장하지 않는다. 순서가 있는 호출은 한 문장씩 결과를 남기고 따로 확인한다.
create temp table phone_results(name text primary key, value jsonb) on commit drop;
create function pg_temp.keep(label text, value jsonb) returns void language sql as $$
 insert into phone_results values(label, value) $$;
create function pg_temp.r(label text) returns jsonb language sql stable as $$
 select value from phone_results where name=label $$;
-- 60초 재발송 간격을 지난 것처럼 기존 요청을 과거로 민다.
create function pg_temp.age_challenges(seconds integer) returns void language sql as $$
 update private.member_phone_verification_challenges
  set created_at = created_at - make_interval(secs => seconds), expires_at = expires_at - make_interval(secs => seconds),
   resolved_at = resolved_at - make_interval(secs => seconds) $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.uid(n),'authenticated','authenticated','member-phone-'||n||'@example.test',now(),'{}','{}',now(),now()
 from generate_series(1,8) n;
update public.profiles set nickname='TEST 휴대폰'||right(id::text,2), birth_date='1990-01-01',
 consents='{"terms":true,"privacy":true}', onboarded_at=now() where id::text like 'a6271200-%';
-- 7번 회원은 아직 약관·개인정보 동의 전(온보딩 1단계 전)이다.
update public.profiles set birth_date=null, consents='{}', onboarded_at=null where id=pg_temp.uid(7);

-- 봉인: 표는 어느 API 롤에도 열리지 않고, 서비스 RPC는 service_role에만, 본인 조회는 authenticated에만 열린다.
select 1/case when not has_table_privilege('authenticated','private.member_phone_numbers','select')
 and not has_table_privilege('service_role','private.member_phone_numbers','select')
 and not has_table_privilege('service_role','private.member_phone_verification_challenges','select')
 and not has_table_privilege('service_role','private.member_phone_verification_events','select')
 and has_function_privilege('service_role','public.service_issue_member_phone_verification(uuid,uuid,text,text,text,text,integer)','execute')
 and not has_function_privilege('authenticated','public.service_issue_member_phone_verification(uuid,uuid,text,text,text,text,integer)','execute')
 and not has_function_privilege('anon','public.service_issue_member_phone_verification(uuid,uuid,text,text,text,text,integer)','execute')
 and has_function_privilege('service_role','public.service_verify_member_phone_verification(uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','public.service_verify_member_phone_verification(uuid,uuid,text)','execute')
 and has_function_privilege('service_role','public.service_fail_member_phone_verification(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.service_fail_member_phone_verification(uuid,uuid)','execute')
 and has_function_privilege('authenticated','public.my_member_phone_verification()','execute')
 and not has_function_privilege('anon','public.my_member_phone_verification()','execute')
 and not has_function_privilege('service_role','public.my_member_phone_verification()','execute')
 and not has_function_privilege('authenticated','private.erase_member_phone(uuid)','execute')
 and not has_function_privilege('service_role','private.member_phone_rate_limited(text,text,integer,integer)','execute')
 and not has_function_privilege('service_role','private.prune_member_phone_verification_challenges(integer)','execute')
 and not has_function_privilege('authenticated','private.member_phone_onboarding_ready(uuid)','execute')
 then 1 else 0 end as sealed;

-- 형식이 틀린 입력은 거절한다.
select pg_temp.phone_error($q$select public.service_issue_member_phone_verification(gen_random_uuid(),'a6271200-0000-4000-8000-000000000001','01012345678',rpad('a',43,'x'),null,rpad('b',43,'x'),300)$q$,'invalid_member_phone_verification');
select pg_temp.phone_error($q$select public.service_issue_member_phone_verification(gen_random_uuid(),'a6271200-0000-4000-8000-000000000001','+821012345678','short',null,rpad('b',43,'x'),300)$q$,'invalid_member_phone_verification');
select pg_temp.phone_error($q$select public.service_issue_member_phone_verification(gen_random_uuid(),'a6271200-0000-4000-8000-000000000001','+821012345678',rpad('a',43,'x'),null,rpad('b',43,'x'),30)$q$,'invalid_member_phone_verification');

-- 약관·개인정보 동의와 생년월일(만 14세 확인) 전에는 번호를 받지 않고 요청 행도 남기지 않는다.
select 1/case when pg_temp.issue(7,30,'+821077777777','phone pre',null,'303030')->>'reason'='onboarding_required'
 and not exists(select 1 from private.member_phone_verification_challenges where user_id=pg_temp.uid(7))
 then 1 else 0 end as consent_before_phone;
update public.profiles set consents='{"terms":true,"privacy":false}', birth_date='2000-01-01' where id=pg_temp.uid(7);
select 1/case when pg_temp.issue(7,30,'+821077777777','phone pre',null,'303030')->>'reason'='onboarding_required'
 then 1 else 0 end as privacy_consent_required;

-- 발송 요청: 진행 중 요청이 생기고 번호 원문은 진행 중에만 남는다. 60초 안 재요청은 간격으로 거절한다.
select 1/case when (pg_temp.issue(1,1,'+821012345678','phone a','ip one','111111')->>'ok')::boolean then 1 else 0 end as issued;
select 1/case when (select status='pending' and phone_e164='+821012345678' and attempts=0 and expires_at>created_at
 from private.member_phone_verification_challenges where id=pg_temp.cid(1)) then 1 else 0 end as pending_row;
select 1/case when pg_temp.issue(1,2,'+821012345678','phone a','ip one','222222')->>'reason'='cooldown'
 and (pg_temp.issue(1,2,'+821012345678','phone a','ip one','222222')->>'retryAfterSeconds')::integer between 1 and 60
 and not exists(select 1 from private.member_phone_verification_challenges where id=pg_temp.cid(2))
 then 1 else 0 end as cooldown_refused;
-- 다른 회원이라도 같은 번호면 간격이 적용된다.
select 1/case when pg_temp.issue(2,3,'+821012345678','phone a','ip two','333333')->>'reason'='cooldown' then 1 else 0 end as cooldown_per_number;

-- 새 요청은 같은 회원의 진행 중 요청을 대신한다(가장 최근 문자의 번호만 맞는다).
select pg_temp.age_challenges(61);
select pg_temp.keep('issue4', pg_temp.issue(1,4,'+821012345678','phone a','ip one','444444'));
select pg_temp.keep('verify1_after', pg_temp.verify(1,1,'111111'));
select 1/case when (pg_temp.r('issue4')->>'ok')::boolean
 and (select status='superseded' and phone_e164 is null and resolved_at is not null from private.member_phone_verification_challenges where id=pg_temp.cid(1))
 and pg_temp.r('verify1_after')->>'reason'='superseded'
 then 1 else 0 end as superseded;

-- 오입력: 남은 횟수를 알려 주고 5번째에 요청을 닫는다. 닫힌 요청은 맞는 번호로도 통과하지 않는다.
select pg_temp.keep('mismatch1', pg_temp.verify(1,4,'000000'));
select pg_temp.keep('mismatch2', pg_temp.verify(1,4,'000000'));
select 1/case when pg_temp.r('mismatch1')->>'reason'='mismatch' and (pg_temp.r('mismatch1')->>'remainingAttempts')::integer=4
 and (pg_temp.r('mismatch2')->>'remainingAttempts')::integer=3 then 1 else 0 end as mismatch_counts;
select pg_temp.verify(1,4,'000000'); select pg_temp.verify(1,4,'000000');
select pg_temp.keep('mismatch5', pg_temp.verify(1,4,'000000'));
select pg_temp.keep('after_exhausted', pg_temp.verify(1,4,'444444'));
select 1/case when pg_temp.r('mismatch5')->>'reason'='exhausted'
 and (select status='exhausted' and attempts=5 and phone_e164 is null from private.member_phone_verification_challenges where id=pg_temp.cid(4))
 and pg_temp.r('after_exhausted')->>'reason'='exhausted'
 and not exists(select 1 from private.member_phone_numbers where user_id=pg_temp.uid(1))
 then 1 else 0 end as exhausted_locks;

-- 다른 회원의 요청 id로는 확인할 수 없다.
select pg_temp.age_challenges(61);
select pg_temp.issue(1,5,'+821012345678','phone a','ip one','555555');
select 1/case when pg_temp.verify(2,5,'555555')->>'reason'='not_found' then 1 else 0 end as other_member_cannot_verify;

-- 만료된 요청은 맞는 번호여도 닫힌다.
update private.member_phone_verification_challenges set expires_at=clock_timestamp()-interval '1 second', created_at=clock_timestamp()-interval '10 minutes' where id=pg_temp.cid(5);
-- 한 문장 안의 하위 조회는 문장 시작 시점 스냅샷이라 함수가 바꾼 행을 보지 못한다. 호출과 확인을 나눈다.
select pg_temp.keep('verify5_expired', pg_temp.verify(1,5,'555555'));
select 1/case when pg_temp.r('verify5_expired')->>'reason'='expired'
 and (select status='expired' and phone_e164 is null from private.member_phone_verification_challenges where id=pg_temp.cid(5))
 then 1 else 0 end as expired_closes;

-- 성공: 번호가 회원에게 기록되고 요청 행의 번호 원문은 지워진다. 같은 요청의 재확인은 멱등이다.
select pg_temp.age_challenges(61);
select pg_temp.issue(1,6,'+821012345678','phone a','ip one','666666');
select pg_temp.keep('verify6', pg_temp.verify(1,6,'666666'));
select pg_temp.keep('verify6_again', pg_temp.verify(1,6,'666666'));
select 1/case when (pg_temp.r('verify6')->>'ok')::boolean and not (pg_temp.r('verify6')->>'replayed')::boolean
 and (pg_temp.r('verify6_again')->>'ok')::boolean and (pg_temp.r('verify6_again')->>'replayed')::boolean
 and (select phone_e164='+821012345678' from private.member_phone_numbers where user_id=pg_temp.uid(1))
 and (select status='verified' and phone_e164 is null from private.member_phone_verification_challenges where id=pg_temp.cid(6))
 and (select count(*)=1 from private.member_phone_verification_events where user_id=pg_temp.uid(1) and event='verified')
 then 1 else 0 end as verified_recorded;

-- 본인 조회는 authenticated 세션의 자기 번호만 돌려준다.
select set_config('request.jwt.claim.sub', pg_temp.uid(1)::text, true);
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(1)::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select 1/case when (public.my_member_phone_verification()->>'verified')::boolean
 and public.my_member_phone_verification()->>'phoneE164'='+821012345678'
 and not (public.my_member_phone_verification()->>'reverificationRequired')::boolean then 1 else 0 end as own_state;
reset role;
select set_config('request.jwt.claim.sub', pg_temp.uid(2)::text, true);
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(2)::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select 1/case when not (public.my_member_phone_verification()->>'verified')::boolean
 and public.my_member_phone_verification()->'phoneE164'='null'::jsonb
 and not (public.my_member_phone_verification()->>'reverificationRequired')::boolean then 1 else 0 end as other_state_empty;
reset role;

-- 옮기기: 같은 번호를 다른 회원이 인증하면 번호가 그 회원으로 옮겨 가고, 이전 회원에게는 번호 없이 재인증 필요
-- 표시만 남는다(사용자 결정 '옮기고 재인증 요구').
select pg_temp.age_challenges(61);
select pg_temp.issue(2,7,'+821012345678','phone a','ip two','777777');
select pg_temp.keep('verify7', pg_temp.verify(2,7,'777777'));
select 1/case when (pg_temp.r('verify7')->>'ok')::boolean
 and (select phone_e164 is null and verified_at is null and released_at is not null from private.member_phone_numbers where user_id=pg_temp.uid(1))
 and (select phone_e164='+821012345678' from private.member_phone_numbers where user_id=pg_temp.uid(2))
 and (select count(*)=1 from private.member_phone_verification_events where user_id=pg_temp.uid(1) and event='released')
 then 1 else 0 end as moved_to_new_member;
select set_config('request.jwt.claim.sub', pg_temp.uid(1)::text, true);
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(1)::text, 'role', 'authenticated')::text, true);
set local role authenticated;
select 1/case when not (public.my_member_phone_verification()->>'verified')::boolean
 and public.my_member_phone_verification()->'phoneE164'='null'::jsonb
 and (public.my_member_phone_verification()->>'reverificationRequired')::boolean then 1 else 0 end as released_member_must_reverify;
reset role;

-- 번호를 잃은 회원이 다시 인증하면(다른 번호) 재인증 필요 표시가 지워진다.
select pg_temp.age_challenges(61);
select pg_temp.issue(1,16,'+821016161616','phone k','ip one','161616');
select pg_temp.verify(1,16,'161616');
select 1/case when (select phone_e164='+821016161616' and verified_at is not null and released_at is null from private.member_phone_numbers where user_id=pg_temp.uid(1))
 then 1 else 0 end as reverified_clears_flag;

-- 요청 뒤 동의 조건이 깨지면 맞는 인증번호여도 기록하지 않고 요청을 닫는다.
select pg_temp.age_challenges(61);
select pg_temp.issue(8,17,'+821018181818','phone l',null,'171717');
update public.profiles set consents='{"terms":true,"privacy":false}' where id=pg_temp.uid(8);
select pg_temp.keep('verify17', pg_temp.verify(8,17,'171717'));
select 1/case when pg_temp.r('verify17')->>'reason'='onboarding_required'
 and (select status='refused' and phone_e164 is null from private.member_phone_verification_challenges where id=pg_temp.cid(17))
 and not exists(select 1 from private.member_phone_numbers where user_id=pg_temp.uid(8))
 then 1 else 0 end as verify_rechecks_consent;

-- 회원이 번호를 바꾸면 회원당 한 행이 새 번호로 바뀐다.
select pg_temp.age_challenges(61);
select pg_temp.issue(2,8,'+819012345678','phone b','ip two','888888');
select pg_temp.verify(2,8,'888888');
select 1/case when (select count(*)=1 and min(phone_e164)='+819012345678' from private.member_phone_numbers where user_id=pg_temp.uid(2))
 then 1 else 0 end as one_number_per_member;

-- 한도: 같은 회원은 1시간 5건, 같은 번호는 1시간 5건, 같은 IP는 1시간 10건까지다.
select pg_temp.age_challenges(3600*25);
insert into private.member_phone_verification_challenges(id,user_id,phone_digest,ip_digest,code_digest,status,attempts,created_at,expires_at,resolved_at)
 select gen_random_uuid(),pg_temp.uid(3),pg_temp.d('phone c'),pg_temp.d('ip three'),pg_temp.d('code x'),'superseded',0,
  clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '9 minutes'
 from generate_series(1,5);
select 1/case when pg_temp.issue(3,9,'+821033333333','phone d','ip four','999999')->>'reason'='rate_limited' then 1 else 0 end as user_hour_limit;
select 1/case when pg_temp.issue(4,10,'+821033333333','phone c','ip four','101010')->>'reason'='rate_limited' then 1 else 0 end as number_hour_limit;
insert into private.member_phone_verification_challenges(id,user_id,phone_digest,ip_digest,code_digest,status,attempts,created_at,expires_at,resolved_at)
 select gen_random_uuid(),pg_temp.uid(5),pg_temp.d('phone e'||n),pg_temp.d('ip three'),pg_temp.d('code x'),'superseded',0,
  clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '9 minutes'
 from generate_series(1,5) n;
select pg_temp.keep('ip_limited', pg_temp.issue(4,11,'+821044444444','phone f','ip three','111112'));
select pg_temp.keep('ip_other', pg_temp.issue(4,11,'+821044444444','phone f','ip five','111112'));
select 1/case when pg_temp.r('ip_limited')->>'reason'='rate_limited' and (pg_temp.r('ip_other')->>'ok')::boolean
 then 1 else 0 end as ip_hour_limit;

-- 발송 실패는 요청을 닫고 한도에는 그대로 센다.
select pg_temp.keep('fail_first', to_jsonb(public.service_fail_member_phone_verification(pg_temp.cid(11),pg_temp.uid(4))));
select pg_temp.keep('fail_again', to_jsonb(public.service_fail_member_phone_verification(pg_temp.cid(11),pg_temp.uid(4))));
select 1/case when pg_temp.r('fail_first')='true'::jsonb and pg_temp.r('fail_again')='false'::jsonb
 and (select status='send_failed' and phone_e164 is null from private.member_phone_verification_challenges where id=pg_temp.cid(11))
 then 1 else 0 end as send_failure_closes;

-- 정지 계정은 요청할 수 없다.
update public.profiles set suspended_at=now(), suspension_reason='TEST 정지' where id=pg_temp.uid(6);
select 1/case when pg_temp.issue(6,12,'+821066666666','phone g',null,'121212')->>'reason'='account_unavailable' then 1 else 0 end as suspended_refused;

-- 탈퇴 신청(계정 봉인): 같은 트랜잭션에서 번호·요청 행·인증 이력을 지우고, 이후 요청은 거절한다.
select pg_temp.age_challenges(61);
select pg_temp.issue(2,13,'+821022222222','phone h',null,'131313');
insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status)
 values('a6271202-0000-4000-8000-000000000001',pg_temp.uid(2),'a6271202-0000-4000-8000-000000000002','blocked_active_obligation');
insert into private.account_action_fences(subject_user_id,deletion_event_id) values(pg_temp.uid(2),'a6271202-0000-4000-8000-000000000001');
select 1/case when not exists(select 1 from private.member_phone_numbers where user_id=pg_temp.uid(2))
 and not exists(select 1 from private.member_phone_verification_challenges where user_id=pg_temp.uid(2))
 and not exists(select 1 from private.member_phone_verification_events where user_id=pg_temp.uid(2))
 and pg_temp.issue(2,14,'+821022222222','phone h',null,'141414')->>'reason'='account_unavailable'
 and pg_temp.verify(2,13,'131313')->>'reason'='not_found'
 and not exists(select 1 from private.member_phone_verification_challenges where id=pg_temp.cid(14))
 then 1 else 0 end as fence_erases_phone;

-- 보관 기한: 만료된 진행 중 요청은 번호 원문을 지우고 닫으며, 이틀 지난 요청 행과 1년 지난 인증·해제 이력은
-- 삭제한다(매시 정리 작업).
select pg_temp.age_challenges(61);
select pg_temp.issue(1,15,'+821015151515','phone i',null,'151515');
update private.member_phone_verification_challenges set expires_at=clock_timestamp()-interval '1 second', created_at=clock_timestamp()-interval '10 minutes' where id=pg_temp.cid(15);
update private.member_phone_verification_challenges set created_at=created_at-interval '3 days', expires_at=expires_at-interval '3 days', resolved_at=resolved_at-interval '3 days' where user_id=pg_temp.uid(3);
update private.member_phone_verification_events set occurred_at=occurred_at-interval '366 days' where user_id=pg_temp.uid(1) and event='released';
select private.prune_member_phone_verification_challenges() as pruned \gset
select 1/case when :pruned>=6
 and (select status='expired' and phone_e164 is null and resolved_at is not null from private.member_phone_verification_challenges where id=pg_temp.cid(15))
 and not exists(select 1 from private.member_phone_verification_challenges where user_id=pg_temp.uid(3))
 and not exists(select 1 from private.member_phone_verification_challenges where status='pending' and expires_at<=clock_timestamp())
 and not exists(select 1 from private.member_phone_verification_events where user_id=pg_temp.uid(1) and event='released')
 and exists(select 1 from private.member_phone_verification_events where user_id=pg_temp.uid(1) and event='verified')
 then 1 else 0 end as retention_pruned;
select 1/case when exists(select 1 from pg_catalog.pg_extension where extname='pg_cron')
 = exists(select 1 from cron.job where jobname='member-phone-verification-retention') then 1 else 0 end as retention_scheduled;

rollback;
