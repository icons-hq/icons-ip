\set ON_ERROR_STOP on
-- 10/14 회의 S4 — 채널별 마케팅 수신 동의 원장과 consents.marketing 파생값.
begin;
create function pg_temp.marketing_consent_error(q text,wanted text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if position(wanted in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected error %',wanted;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('a6271100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'marketing-consent-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,2)n;
update public.profiles set nickname='TEST 수신동의'||right(id::text,2),birth_date='1990-01-01',
 consents='{"terms":true,"privacy":true}' where id::text like 'a6271100-%';
create function pg_temp.marketing_consent_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','a6271100-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','a6271100-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated')::text,true);
end $$;

-- 봉인: 원장 직접 접근과 anon 실행은 막히고, 고객 RPC만 authenticated에 열린다.
select 1/case when not has_table_privilege('authenticated','private.customer_marketing_consents','select')
 and not has_table_privilege('service_role','private.customer_marketing_consent_events','select')
 and not has_function_privilege('anon','public.set_my_marketing_consents(boolean,boolean,text,text)','execute')
 and not has_function_privilege('anon','public.my_marketing_consent_state()','execute')
 and not has_function_privilege('service_role','public.set_my_marketing_consents(boolean,boolean,text,text)','execute')
 and has_function_privilege('authenticated','public.set_my_marketing_consents(boolean,boolean,text,text)','execute')
 and not has_function_privilege('authenticated','private.customer_marketing_consent_document(uuid)','execute')
 then 1 else 0 end as sealed;

select pg_temp.marketing_consent_actor(1); set local role authenticated;
select 1/case when public.my_marketing_consent_state()->'email'='null'::jsonb and public.my_marketing_consent_state()->'sms'='null'::jsonb
 and public.my_marketing_consent_state()->'marketing'='false'::jsonb then 1 else 0 end as initially_unset;
select pg_temp.marketing_consent_error($q$select public.set_my_marketing_consents(true,false,'marketing-legacy-v0','onboarding')$q$,'invalid_marketing_consent');
select pg_temp.marketing_consent_error($q$select public.set_my_marketing_consents(true,false,'marketing-channels-v1','legacy')$q$,'invalid_marketing_consent');
select pg_temp.marketing_consent_error($q$select public.set_my_marketing_consents(null,false,'marketing-channels-v1','settings')$q$,'invalid_marketing_consent');

-- 온보딩: 이메일 동의·SMS 거부. 거부도 첫 기록으로 남고, 파생값은 true가 된다.
select public.set_my_marketing_consents(true,false,'marketing-channels-v1','onboarding') as first \gset
select 1/case when (:'first'::jsonb)->'email'->'agreed'='true'::jsonb and (:'first'::jsonb)->'email'->'agreedAt'<>'null'::jsonb
 and (:'first'::jsonb)->'sms'->'agreed'='false'::jsonb and (:'first'::jsonb)->'sms'->'withdrawnAt'='null'::jsonb
 and (:'first'::jsonb)->'marketing'='true'::jsonb then 1 else 0 end as onboarding_recorded;
-- 같은 선택의 재저장은 멱등이다.
select 1/case when public.set_my_marketing_consents(true,false,'marketing-channels-v1','onboarding')=:'first'::jsonb then 1 else 0 end as duplicate_converges;
reset role;
select 1/case when (select consents from public.profiles where id='a6271100-0000-4000-8000-000000000001')='{"terms":true,"privacy":true,"marketing":true}'::jsonb
 and (select count(*) from private.customer_marketing_consent_events where user_id='a6271100-0000-4000-8000-000000000001')=2
 and (select revision from private.customer_marketing_consents where user_id='a6271100-0000-4000-8000-000000000001' and channel='email')=1
 and (select source from private.customer_marketing_consents where user_id='a6271100-0000-4000-8000-000000000001' and channel='sms')='onboarding'
 then 1 else 0 end as derived_and_ledger_match;

-- Data API 직접 쓰기(온보딩 약관 저장처럼 consents 전체 덮어쓰기)는 파생값을 바꾸지 못한다.
select pg_temp.marketing_consent_actor(1); set local role authenticated;
update public.profiles set consents='{"terms":true,"privacy":true,"marketing":false}' where id='a6271100-0000-4000-8000-000000000001';
update public.profiles set consents='{"terms":true,"privacy":true}' where id='a6271100-0000-4000-8000-000000000001';
reset role;
select 1/case when (select consents from public.profiles where id='a6271100-0000-4000-8000-000000000001')='{"terms":true,"privacy":true,"marketing":true}'::jsonb
 then 1 else 0 end as direct_write_keeps_derived_value;
select pg_temp.marketing_consent_actor(2); set local role authenticated;
update public.profiles set consents='{"terms":true,"privacy":true,"marketing":true}' where id='a6271100-0000-4000-8000-000000000002';
reset role;
select 1/case when (select consents->'marketing' from public.profiles where id='a6271100-0000-4000-8000-000000000002')='false'::jsonb
 then 1 else 0 end as direct_write_cannot_self_consent;

-- 설정: 이메일 철회·SMS 동의. 철회 시각을 남기고 동의 시각은 지운다. 파생값은 SMS로 true 유지.
select pg_temp.marketing_consent_actor(1); set local role authenticated;
select public.set_my_marketing_consents(false,true,'marketing-channels-v1','settings') as changed \gset
select 1/case when (:'changed'::jsonb)->'email'->'agreed'='false'::jsonb and (:'changed'::jsonb)->'email'->'withdrawnAt'<>'null'::jsonb
 and (:'changed'::jsonb)->'email'->'agreedAt'='null'::jsonb and (:'changed'::jsonb)->'sms'->'agreed'='true'::jsonb
 and (:'changed'::jsonb)->'marketing'='true'::jsonb then 1 else 0 end as settings_changed;
-- 모두 철회하면 파생값이 false가 된다 — 세그먼트·인앱 메시지 대상에서 빠진다.
select public.set_my_marketing_consents(false,false,'marketing-channels-v1','settings') as withdrawn \gset
reset role;
select 1/case when (:'withdrawn'::jsonb)->'marketing'='false'::jsonb
 and (select consents->'marketing' from public.profiles where id='a6271100-0000-4000-8000-000000000001')='false'::jsonb
 and (select count(*) from private.customer_marketing_consent_events where user_id='a6271100-0000-4000-8000-000000000001')=5
 and (select array_agg(agreed order by id) from private.customer_marketing_consent_events where user_id='a6271100-0000-4000-8000-000000000001' and channel='email')=array[true,false]
 and (select revision from private.customer_marketing_consents where user_id='a6271100-0000-4000-8000-000000000001' and channel='sms')=3
 then 1 else 0 end as withdrawal_derives_false;

-- 운영 SQL(postgres)과 기존 스모크의 직접 설정은 막지 않는다.
update public.profiles set consents=consents||'{"marketing":true}' where id='a6271100-0000-4000-8000-000000000002';
select 1/case when (select consents->'marketing' from public.profiles where id='a6271100-0000-4000-8000-000000000002')='true'::jsonb
 then 1 else 0 end as privileged_write_unchanged;

-- 비로그인은 상태를 읽지 못한다.
select set_config('request.jwt.claim.sub','',true); select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role authenticated;
select pg_temp.marketing_consent_error($q$select public.my_marketing_consent_state()$q$,'marketing_consent_auth_required');
select pg_temp.marketing_consent_error($q$select public.set_my_marketing_consents(true,true,'marketing-channels-v1','settings')$q$,'marketing_consent_auth_required');
reset role;
rollback;
