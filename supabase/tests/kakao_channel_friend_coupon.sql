\set ON_ERROR_STOP on
-- 1014-014 — 카카오톡 채널 친구 추가 쿠폰. 봉인·identity 연결·대상 회원·멱등·출처(kakao_channel)·쿠폰 거절.
begin;
create function pg_temp.kakao_reward_error(q text, wanted text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if position(wanted in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected error %', wanted;
end $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
 select ('a6271400-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create temp table kakao_results(name text primary key, value jsonb) on commit drop;
create function pg_temp.keep(label text, value jsonb) returns void language sql as $$
 insert into kakao_results values(label, value) $$;
create function pg_temp.r(label text) returns jsonb language sql stable as $$
 select value from kakao_results where name=label $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.uid(n),'authenticated','authenticated','kakao-reward-'||n||'@example.test',now(),'{}','{}',now(),now()
 from generate_series(1,5) n;
update public.profiles set nickname='TEST 카카오쿠폰'||right(id::text,2), birth_date='1990-01-01',
 consents='{"terms":true,"privacy":true}', onboarded_at=now() where id::text like 'a6271400-%';
-- 2번 회원은 온보딩 전이다(카카오로 막 가입한 회원).
update public.profiles set onboarded_at=null where id=pg_temp.uid(2);
insert into auth.identities(provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
 values('1234567890',pg_temp.uid(1),jsonb_build_object('sub','1234567890'),'kakao',now(),now(),now()),
       ('2234567890',pg_temp.uid(2),jsonb_build_object('sub','2234567890'),'kakao',now(),now(),now());
insert into public.coupons(code,name,discount_type,discount_value,starts_at,status,issue_limit)
 values('KAKAO-FRIEND','TEST 채널 친구 쿠폰','fixed',1000,now()-interval '1 day','active',2),
       ('KAKAO-ENDED','TEST 끝난 쿠폰','fixed',1000,now()-interval '10 days','active',null);
update public.coupons set ends_at=now()-interval '1 day' where code='KAKAO-ENDED';

-- 봉인: 발급 원장은 어느 API 롤에도 열리지 않고, 세 RPC는 service_role에만 열린다.
select 1/case when not has_table_privilege('service_role','private.kakao_channel_friend_rewards','select')
 and not has_table_privilege('authenticated','private.kakao_channel_friend_rewards','select')
 and has_function_privilege('service_role','public.service_grant_kakao_channel_friend_coupon(uuid,text,text,text)','execute')
 and not has_function_privilege('authenticated','public.service_grant_kakao_channel_friend_coupon(uuid,text,text,text)','execute')
 and not has_function_privilege('anon','public.service_grant_kakao_channel_friend_coupon(uuid,text,text,text)','execute')
 and has_function_privilege('service_role','public.service_kakao_identity_user(text)','execute')
 and not has_function_privilege('authenticated','public.service_kakao_identity_user(text)','execute')
 and has_function_privilege('service_role','public.service_member_kakao_identity(uuid)','execute')
 and not has_function_privilege('authenticated','public.service_member_kakao_identity(uuid)','execute')
 and not has_function_privilege('service_role','private.issue_coupon_code(text,uuid,text)','execute')
 and not has_function_privilege('authenticated','private.issue_coupon_code(text,uuid,text)','execute')
 then 1 else 0 end as sealed;

-- 카카오 회원번호 ↔ 회원 연결.
select 1/case when public.service_kakao_identity_user('1234567890')=pg_temp.uid(1)
 and public.service_kakao_identity_user('999') is null
 and public.service_member_kakao_identity(pg_temp.uid(1))='1234567890'
 and public.service_member_kakao_identity(pg_temp.uid(3)) is null
 then 1 else 0 end as identity_mapping;

-- 형식이 틀린 요청은 거절한다.
select pg_temp.kakao_reward_error($q$select public.service_grant_kakao_channel_friend_coupon('a6271400-0000-4000-8000-000000000001','IconsTest','KAKAO-FRIEND','login')$q$,'invalid_kakao_channel_reward');
select pg_temp.kakao_reward_error($q$select public.service_grant_kakao_channel_friend_coupon('a6271400-0000-4000-8000-000000000001','_IconsTest','KAKAO-FRIEND','browser')$q$,'invalid_kakao_channel_reward');

-- 발급: 출처는 kakao_channel이고, 같은 회원·채널은 다시 받지 않는다(멱등).
select pg_temp.keep('first', public.service_grant_kakao_channel_friend_coupon(pg_temp.uid(1),'_IconsTest','KAKAO-FRIEND','login'));
select pg_temp.keep('again', public.service_grant_kakao_channel_friend_coupon(pg_temp.uid(1),'_IconsTest','KAKAO-FRIEND','webhook'));
select 1/case when pg_temp.r('first')->>'status'='granted'
 and pg_temp.r('again')->>'status'='already_granted'
 and pg_temp.r('again')->>'userCouponId'=pg_temp.r('first')->>'userCouponId'
 and (select count(*)=1 and min(issued_source)='kakao_channel' from public.user_coupons where user_id=pg_temp.uid(1) and coupon_code='KAKAO-FRIEND')
 and (select issued_count=1 from public.coupons where code='KAKAO-FRIEND')
 and (select granted_via='login' from private.kakao_channel_friend_rewards where user_id=pg_temp.uid(1))
 then 1 else 0 end as granted_once;

-- 온보딩 전 회원은 대상이 아니고 원장도 남기지 않는다(온보딩 완료 때 다시 확인한다).
select 1/case when public.service_grant_kakao_channel_friend_coupon(pg_temp.uid(2),'_IconsTest','KAKAO-FRIEND','login')->>'reason'='customer_unavailable'
 and not exists(select 1 from private.kakao_channel_friend_rewards where user_id=pg_temp.uid(2))
 and not exists(select 1 from public.user_coupons where user_id=pg_temp.uid(2))
 then 1 else 0 end as not_onboarded_skipped;

-- 운영자·정지 회원도 대상이 아니다.
update public.profiles set suspended_at=now() where id=pg_temp.uid(4);
select 1/case when public.service_grant_kakao_channel_friend_coupon(pg_temp.uid(4),'_IconsTest','KAKAO-FRIEND','webhook')->>'reason'='customer_unavailable'
 then 1 else 0 end as suspended_skipped;

-- 쿠폰이 끝났거나 한도를 다 쓰면 발급하지 않고 원장도 남기지 않는다(쿠폰을 고치면 다음 확인 때 발급).
select pg_temp.keep('ended', public.service_grant_kakao_channel_friend_coupon(pg_temp.uid(3),'_IconsTest','KAKAO-ENDED','webhook'));
select 1/case when pg_temp.r('ended')->>'status'='unavailable' and pg_temp.r('ended')->>'reason' like 'coupon_%'
 and not exists(select 1 from private.kakao_channel_friend_rewards where user_id=pg_temp.uid(3))
 then 1 else 0 end as ended_coupon_refused;
select pg_temp.keep('limit_last', public.service_grant_kakao_channel_friend_coupon(pg_temp.uid(3),'_IconsTest','KAKAO-FRIEND','webhook'));
select pg_temp.keep('limit_over', public.service_grant_kakao_channel_friend_coupon(pg_temp.uid(5),'_IconsTest','KAKAO-FRIEND','webhook'));
select 1/case when pg_temp.r('limit_last')->>'status'='granted'
 and pg_temp.r('limit_over')->>'reason'='coupon_exhausted'
 and not exists(select 1 from private.kakao_channel_friend_rewards where user_id=pg_temp.uid(5))
 then 1 else 0 end as exhausted_refused;

-- 기존 출처(code_entry·admin_grant)는 그대로 받고, 모르는 출처는 계속 거절한다.
select pg_temp.kakao_reward_error($q$select private.issue_coupon_code('KAKAO-FRIEND','a6271400-0000-4000-8000-000000000005','marketing')$q$,'invalid_coupon_issue_source');

-- 회원이 지워지면 원장도 지워진다.
delete from auth.users where id=pg_temp.uid(1);
select 1/case when not exists(select 1 from private.kakao_channel_friend_rewards where user_id=pg_temp.uid(1)) then 1 else 0 end as cascade_on_delete;

rollback;
