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
 and pg_temp.r('ip16')->>'reason'='rate_limited'
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

-- 시간 창이 지나면 다시 열리지만 하루 한도는 남는다(이메일 12, IP 40).
update private.auth_mail_abuse_attempts set created_at = created_at - interval '2 hours' where email_digest=pg_temp.d('victim');
select pg_temp.keep('v_again', pg_temp.try('signup', null, 'victim'));
select 1/case when (pg_temp.r('v_again')->>'ok')::boolean then 1 else 0 end as hour_window_reopens;
-- 지금까지 이메일 victim은 6행(2시간 전 5 + 방금 1). 시간 창을 두 번 더 밀어 12행까지 채운다.
update private.auth_mail_abuse_attempts set created_at = created_at - interval '2 hours' where email_digest=pg_temp.d('victim');
select pg_temp.keep('v'||n, pg_temp.try('signup', null, 'victim')) from generate_series(1,4) n;
update private.auth_mail_abuse_attempts set created_at = created_at - interval '2 hours' where email_digest=pg_temp.d('victim');
select pg_temp.keep('w'||n, pg_temp.try('signup', null, 'victim')) from generate_series(1,2) n;
select pg_temp.keep('v_day', pg_temp.try('signup', null, 'victim'));
select 1/case when not (pg_temp.r('v_day')->>'ok')::boolean
 and (pg_temp.r('v_day')->>'retryAfterSeconds')::integer > 3600
 then 1 else 0 end as day_limit;

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
