\set ON_ERROR_STOP on
-- 1014-010 — 수단별 수신 동의의 카카오톡(v2)과 SMS 알림 seam의 받는 사람 판정.
begin;
create function pg_temp.kakao_error(q text, wanted text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if position(wanted in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected error %', wanted;
end $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
 select ('a6271300-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub', pg_temp.uid(n)::text, true);
 perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(n)::text, 'role', 'authenticated')::text, true);
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.uid(n),'authenticated','authenticated','marketing-kakao-'||n||'@example.test',now(),'{}','{}',now(),now()
 from generate_series(1,5) n;
update public.profiles set nickname='TEST 카카오동의'||right(id::text,2), birth_date='1990-01-01',
 consents='{"terms":true,"privacy":true}', onboarded_at=now() where id::text like 'a6271300-%';

-- 봉인: v2는 authenticated에만, 받는 사람 판정은 service_role에만 열린다. v1 권한은 그대로다.
select 1/case when has_function_privilege('authenticated','public.set_my_marketing_consents_v2(boolean,boolean,boolean,text,text)','execute')
 and not has_function_privilege('anon','public.set_my_marketing_consents_v2(boolean,boolean,boolean,text,text)','execute')
 and not has_function_privilege('service_role','public.set_my_marketing_consents_v2(boolean,boolean,boolean,text,text)','execute')
 and has_function_privilege('authenticated','public.set_my_marketing_consents(boolean,boolean,text,text)','execute')
 and not has_function_privilege('service_role','public.set_my_marketing_consents(boolean,boolean,text,text)','execute')
 and has_function_privilege('service_role','public.service_member_sms_recipient(uuid,text)','execute')
 and not has_function_privilege('authenticated','public.service_member_sms_recipient(uuid,text)','execute')
 and not has_function_privilege('anon','public.service_member_sms_recipient(uuid,text)','execute')
 then 1 else 0 end as sealed;

-- 스위치 OFF 경로(v1)는 예전과 같다: 문서에 kakao가 null로 붙을 뿐 이메일·SMS 기록과 파생값은 그대로다.
select pg_temp.actor(1); set local role authenticated;
select public.set_my_marketing_consents(true,false,'marketing-channels-v1','onboarding') as v1 \gset
reset role;
select 1/case when (:'v1'::jsonb)->'kakao'='null'::jsonb and (:'v1'::jsonb)->'email'->'agreed'='true'::jsonb
 and (:'v1'::jsonb)->'marketing'='true'::jsonb
 and not exists(select 1 from private.customer_marketing_consents where user_id=pg_temp.uid(1) and channel='kakao')
 then 1 else 0 end as v1_unchanged;

-- v2는 안내 버전 v2만 받고, 세 수단을 기록한다. 카카오톡만 동의해도 파생값은 true다.
select pg_temp.actor(2); set local role authenticated;
select pg_temp.kakao_error($q$select public.set_my_marketing_consents_v2(false,false,true,'marketing-channels-v1','settings')$q$,'invalid_marketing_consent');
select pg_temp.kakao_error($q$select public.set_my_marketing_consents_v2(false,false,null,'marketing-channels-v2','settings')$q$,'invalid_marketing_consent');
select public.set_my_marketing_consents_v2(false,false,true,'marketing-channels-v2','settings') as v2 \gset
select 1/case when public.set_my_marketing_consents_v2(false,false,true,'marketing-channels-v2','settings')=:'v2'::jsonb then 1 else 0 end as v2_idempotent;
reset role;
select 1/case when (:'v2'::jsonb)->'kakao'->'agreed'='true'::jsonb and (:'v2'::jsonb)->'kakao'->>'noticeVersion'='marketing-channels-v2'
 and (:'v2'::jsonb)->'marketing'='true'::jsonb
 and (select consents->'marketing' from public.profiles where id=pg_temp.uid(2))='true'::jsonb
 and (select count(*) from private.customer_marketing_consent_events where user_id=pg_temp.uid(2))=3
 then 1 else 0 end as v2_records_kakao;

-- 카카오톡 동의가 있는 회원이 예전 v1 화면(스위치를 다시 끈 경우)에서 이메일·SMS를 저장해도 카카오톡 동의는 남는다.
select pg_temp.actor(2); set local role authenticated;
select public.set_my_marketing_consents(false,false,'marketing-channels-v1','settings') as v1_after \gset
reset role;
select 1/case when (:'v1_after'::jsonb)->'kakao'->'agreed'='true'::jsonb and (:'v1_after'::jsonb)->'marketing'='true'::jsonb
 and (select consents->'marketing' from public.profiles where id=pg_temp.uid(2))='true'::jsonb
 and (select agreed from private.customer_marketing_consents where user_id=pg_temp.uid(2) and channel='kakao')
 then 1 else 0 end as v1_keeps_kakao;

-- 카카오톡 철회(v2): 동의 수단이 없으면 파생값이 false가 된다.
select pg_temp.actor(2); set local role authenticated;
select public.set_my_marketing_consents_v2(false,false,false,'marketing-channels-v2','settings') as withdrawn \gset
reset role;
select 1/case when (:'withdrawn'::jsonb)->'kakao'->'agreed'='false'::jsonb and (:'withdrawn'::jsonb)->'marketing'='false'::jsonb
 and (select withdrawn_at is not null from private.customer_marketing_consents where user_id=pg_temp.uid(2) and channel='kakao')
 then 1 else 0 end as kakao_withdrawn;

-- 옛 앱의 consents.marketing=false 직접 쓰기는 카카오톡을 포함한 모든 동의를 철회로 남긴다.
select pg_temp.actor(3); set local role authenticated;
select public.set_my_marketing_consents_v2(false,false,true,'marketing-channels-v2','onboarding');
update public.profiles set consents=jsonb_set(consents,'{marketing}','false') where id=pg_temp.uid(3);
reset role;
select 1/case when not exists(select 1 from private.customer_marketing_consents where user_id=pg_temp.uid(3) and agreed)
 and (select source from private.customer_marketing_consents where user_id=pg_temp.uid(3) and channel='kakao')='legacy_app'
 then 1 else 0 end as legacy_false_withdraws_kakao;

-- SMS 알림 받는 사람: 인증 번호가 있어야 하고, 광고성 정보는 SMS 동의까지 있어야 한다.
select pg_temp.kakao_error($q$select public.service_member_sms_recipient('a6271300-0000-4000-8000-000000000004','marketing')$q$,'invalid_sms_recipient_request');
select 1/case when public.service_member_sms_recipient(pg_temp.uid(4),'transactional')->>'reason'='no_verified_phone' then 1 else 0 end as needs_phone;
insert into private.member_phone_numbers(user_id,phone_e164,verified_at) values(pg_temp.uid(4),'+821040404040',now());
select 1/case when public.service_member_sms_recipient(pg_temp.uid(4),'transactional')->>'phoneE164'='+821040404040'
 and public.service_member_sms_recipient(pg_temp.uid(4),'advertising')->>'reason'='consent_required'
 then 1 else 0 end as advertising_needs_consent;
select pg_temp.actor(4); set local role authenticated;
select public.set_my_marketing_consents(false,true,'marketing-channels-v1','settings');
reset role;
select 1/case when (public.service_member_sms_recipient(pg_temp.uid(4),'advertising')->>'ok')::boolean
 and public.service_member_sms_recipient(pg_temp.uid(4),'advertising')->>'smsConsentAgreedAt' is not null
 then 1 else 0 end as advertising_with_consent;
update public.profiles set suspended_at=now() where id=pg_temp.uid(4);
select 1/case when public.service_member_sms_recipient(pg_temp.uid(4),'transactional')->>'reason'='account_unavailable' then 1 else 0 end as suspended_unavailable;

rollback;
