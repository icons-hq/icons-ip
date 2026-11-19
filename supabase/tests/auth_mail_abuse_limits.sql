\set ON_ERROR_STOP on
-- 실운영 전 3차(CUS-003) — 가입·확인 메일 재전송·재설정 요청의 IP·이메일 시도 한도.
-- 봉인·다이제스트만 저장·IP/이메일 한도·IP 없음·막힌 시도 미기록·입력 검증·보관 기한.
begin;
create function pg_temp.d(label text) returns text language sql immutable as $$
 select rpad(replace(label,' ','_'),43,'x') $$;
create function pg_temp.try(act text, ip text, mail text) returns jsonb language sql as $$
 select public.service_consume_auth_mail_attempt(act, case when ip is null then null else pg_temp.d(ip) end, pg_temp.d(mail)) $$;
create function pg_temp.err(q text, wanted text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if position(wanted in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected error %', wanted;
end $$;
create temp table abuse_results(name text primary key, value jsonb) on commit drop;
create function pg_temp.keep(label text, value jsonb) returns void language sql as $$
 insert into abuse_results values(label, value) $$;
create function pg_temp.r(label text) returns jsonb language sql stable as $$
 select value from abuse_results where name=label $$;

-- 봉인: 표는 어느 API 롤에도 열리지 않고, RPC는 service_role에만 열린다.
select 1/case when not has_table_privilege('service_role','private.auth_mail_abuse_attempts','select')
 and not has_table_privilege('service_role','private.auth_mail_abuse_attempts','insert')
 and not has_table_privilege('authenticated','private.auth_mail_abuse_attempts','select')
 and not has_table_privilege('anon','private.auth_mail_abuse_attempts','select')
 and has_function_privilege('service_role','public.service_consume_auth_mail_attempt(text,text,text)','execute')
 and not has_function_privilege('authenticated','public.service_consume_auth_mail_attempt(text,text,text)','execute')
 and not has_function_privilege('anon','public.service_consume_auth_mail_attempt(text,text,text)','execute')
 and not has_function_privilege('service_role','private.auth_mail_abuse_retry_after(text,text,integer,integer)','execute')
 and not has_function_privilege('service_role','private.prune_auth_mail_abuse_attempts(integer)','execute')
 and (select relrowsecurity from pg_class where oid='private.auth_mail_abuse_attempts'::regclass)
 then 1 else 0 end as sealed;

-- 프로젝트 메일 한도 도달 알림: service_role만 부를 수 있고, 같은 시간 안에서는 한 행만, 개인정보 없이 system 분류로 남는다.
select 1/case when has_function_privilege('service_role','public.service_record_auth_mail_limit_alert()','execute')
 and not has_function_privilege('authenticated','public.service_record_auth_mail_limit_alert()','execute')
 and not has_function_privilege('anon','public.service_record_auth_mail_limit_alert()','execute')
 then 1 else 0 end as alert_sealed;
delete from private.admin_operation_alerts where event_key like 'auth_mail_limit:%';
select public.service_record_auth_mail_limit_alert() as first_alert \gset
select public.service_record_auth_mail_limit_alert() as second_alert \gset
select 1/case when :'first_alert'='t' and :'second_alert'='f'
 and (select count(*) from private.admin_operation_alerts where event_key like 'auth_mail_limit:%')=1
 and exists(select 1 from private.admin_operation_alerts where event_key like 'auth_mail_limit:%'
   and category='system' and href='/admin/settings/system' and title='가입·재설정 메일 시간당 한도에 도달했습니다')
 then 1 else 0 end as mail_limit_alert_once_per_hour;

-- 입력 검증: 모르는 종류·모양이 틀린 다이제스트·빈 이메일은 거절한다(원문 IP·이메일이 들어오지 못하게 한다).
select pg_temp.err($q$select public.service_consume_auth_mail_attempt('login', null, repeat('a',43))$q$, 'invalid_auth_mail_attempt');
select pg_temp.err($q$select public.service_consume_auth_mail_attempt('signup', '203.0.113.7', repeat('a',43))$q$, 'invalid_auth_mail_attempt');
select pg_temp.err($q$select public.service_consume_auth_mail_attempt('signup', null, 'victim@example.test')$q$, 'invalid_auth_mail_attempt');
select pg_temp.err($q$select public.service_consume_auth_mail_attempt('signup', null, null)$q$, 'invalid_auth_mail_attempt');

-- IP 한도: 같은 IP는 이메일이 달라도, 종류가 달라도 합쳐 시간당 15번까지.
select pg_temp.keep('ip'||n, pg_temp.try((array['signup','resend','reset'])[1 + n % 3], 'ip a', 'mail ip '||n))
 from generate_series(1,15) n;
select pg_temp.keep('ip16', pg_temp.try('signup','ip a','mail ip 16'));
select pg_temp.keep('ip_other', pg_temp.try('signup','ip b','mail ip 17'));
select 1/case when (select bool_and((value->>'ok')::boolean) from abuse_results where name ~ '^ip[0-9]+$' and name <> 'ip16')
 and not (pg_temp.r('ip16')->>'ok')::boolean
 and pg_temp.r('ip16')->>'reason'='rate_limited' and pg_temp.r('ip16')->>'scope'='ip'
 and (pg_temp.r('ip16')->>'retryAfterSeconds')::integer between 1 and 3600
 and (pg_temp.r('ip_other')->>'ok')::boolean
 -- 막힌 시도는 기록하지 않는다(15+1행이 아니라 15행).
 and (select count(*) from private.auth_mail_abuse_attempts where ip_digest=pg_temp.d('ip a'))=15
 then 1 else 0 end as ip_hour_limit;

-- 이메일 한도: 같은 이메일은 IP가 달라도 시간당 5번까지. IP를 알 수 없어도(null) 이메일 한도는 적용된다.
select pg_temp.keep('m'||n, pg_temp.try('signup', 'ip m'||n, 'victim')) from generate_series(1,4) n;
select pg_temp.keep('m5', pg_temp.try('resend', null, 'victim'));
select pg_temp.keep('m6', pg_temp.try('reset', 'ip m6', 'victim'));
select pg_temp.keep('m_other', pg_temp.try('reset', null, 'bystander'));
select 1/case when (select bool_and((value->>'ok')::boolean) from abuse_results where name in ('m1','m2','m3','m4','m5'))
 and not (pg_temp.r('m6')->>'ok')::boolean and pg_temp.r('m6')->>'reason'='rate_limited'
 and (pg_temp.r('m_other')->>'ok')::boolean
 and not exists(select 1 from private.auth_mail_abuse_attempts where ip_digest=pg_temp.d('ip m6'))
 and (select count(*) from private.auth_mail_abuse_attempts where email_digest=pg_temp.d('victim'))=5
 then 1 else 0 end as email_hour_limit;

-- 이메일은 하루 한도가 없다: 시간 창이 지나면 하루 안에 몇 번을 채웠어도 다시 열리고, 최악의 차단은 1시간이다.
update private.auth_mail_abuse_attempts set created_at = created_at - interval '2 hours' where email_digest=pg_temp.d('victim');
select pg_temp.keep('v_again', pg_temp.try('signup', null, 'victim'));
select 1/case when (pg_temp.r('v_again')->>'ok')::boolean then 1 else 0 end as hour_window_reopens;
select pg_temp.keep('v'||n, pg_temp.try('signup', null, 'victim')) from generate_series(1,4) n;
update private.auth_mail_abuse_attempts set created_at = created_at - interval '2 hours' where email_digest=pg_temp.d('victim');
select pg_temp.keep('w'||n, pg_temp.try('signup', null, 'victim')) from generate_series(1,5) n;
-- 하루 안에 이미 15행 이상 쌓였지만(5+1+4+5) 시간 창이 비면 계속 열려 있다.
update private.auth_mail_abuse_attempts set created_at = created_at - interval '2 hours' where email_digest=pg_temp.d('victim');
select pg_temp.keep('w_open', pg_temp.try('signup', null, 'victim'));
select 1/case when (select count(*) from private.auth_mail_abuse_attempts where email_digest=pg_temp.d('victim'))>=15
 and (pg_temp.r('w_open')->>'ok')::boolean
 then 1 else 0 end as email_has_no_day_limit;
-- 시간 한도에 걸린 이메일은 최대 1시간 안에 풀린다.
select pg_temp.keep('b'||n, pg_temp.try('reset', null, 'blocked')) from generate_series(1,5) n;
select pg_temp.keep('b6', pg_temp.try('reset', null, 'blocked'));
select 1/case when not (pg_temp.r('b6')->>'ok')::boolean
 and pg_temp.r('b6')->>'scope'='email'
 and (pg_temp.r('b6')->>'retryAfterSeconds')::integer between 1 and 3600
 then 1 else 0 end as email_block_is_at_most_one_hour;

-- IP는 하루 40: 시간 창을 밀어 가며 40행을 채우면 이후엔 하루 한도로 막힌다.
update private.auth_mail_abuse_attempts set created_at = created_at - interval '2 hours' where ip_digest=pg_temp.d('ip a');
select pg_temp.keep('d'||n, pg_temp.try('signup','ip a','day mail '||n)) from generate_series(1,15) n;
update private.auth_mail_abuse_attempts set created_at = created_at - interval '2 hours' where ip_digest=pg_temp.d('ip a');
select pg_temp.keep('e'||n, pg_temp.try('signup','ip a','day mail e'||n)) from generate_series(1,10) n;
select pg_temp.keep('e_over', pg_temp.try('signup','ip a','day mail over'));
select 1/case when (select count(*) from private.auth_mail_abuse_attempts where ip_digest=pg_temp.d('ip a'))=40
 and not (pg_temp.r('e_over')->>'ok')::boolean and pg_temp.r('e_over')->>'scope'='ip'
 and (pg_temp.r('e_over')->>'retryAfterSeconds')::integer > 3600
 then 1 else 0 end as ip_day_limit;

-- 저장 모양: 다이제스트(가명)만 남고 원문 IP·이메일 열은 표에 없다.
select 1/case when not exists(select 1 from information_schema.columns
   where table_schema='private' and table_name='auth_mail_abuse_attempts' and column_name in ('ip','email','ip_address'))
 and not exists(select 1 from private.auth_mail_abuse_attempts where email_digest !~ '^[A-Za-z0-9_-]{32,128}$')
 then 1 else 0 end as digest_only;

-- 보관 기한: 이틀 지난 행만 지운다.
update private.auth_mail_abuse_attempts set created_at = clock_timestamp() - interval '3 days' where email_digest=pg_temp.d('bystander');
select private.prune_auth_mail_abuse_attempts() as pruned \gset
select 1/case when :pruned>=1
 and not exists(select 1 from private.auth_mail_abuse_attempts where email_digest=pg_temp.d('bystander'))
 and exists(select 1 from private.auth_mail_abuse_attempts where email_digest=pg_temp.d('victim'))
 then 1 else 0 end as retention_pruned;
select pg_temp.err($q$select private.prune_auth_mail_abuse_attempts(0)$q$, 'invalid_auth_mail_abuse_prune_limit');
select 1/case when exists(select 1 from pg_catalog.pg_extension where extname='pg_cron')
 = exists(select 1 from cron.job where jobname='auth-mail-abuse-retention') then 1 else 0 end as retention_scheduled;

rollback;
