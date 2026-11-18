\set ON_ERROR_STOP on
begin;
-- 운영자 2단계 인증 요구 스위치(OPS-006)와 권한 회수 세션 끊기(OPS-005). 합성 계정만 쓰고 끝에서 모두 되돌린다.
-- JWT는 request.jwt.claims로 흉내 낸다(aal·session_id·role). 세션은 auth.sessions 합성 행이다.
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
update private.operator_mfa_policy set required=false,revision=1 where singleton;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('86300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','operator-mfa-'||n||'@example.test',now(),'{}','{}',now(),now()
from generate_series(1,6) n;
-- 1 관리자(통합 매니저가 된다) · 2 주매니저 · 3 부매니저 · 4 전환 때 회수 · 5 고객 · 6 물류(나중에 회수)
update public.profiles set role=(case right(id::text,1) when '1' then 'admin' when '5' then 'user' else 'staff' end)::public.user_role,
  nickname='operator-mfa-'||right(id::text,1),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id::text like '86300000-0000-4000-8000-%';
insert into private.operator_legacy_cohort(profile_id,legacy_role)
select id,role from public.profiles where id::text like '86300000-0000-4000-8000-%' and role in ('staff','admin')
on conflict(profile_id) do nothing;
-- 세션: 사용자 n의 aal1 세션은 ...00n1, aal2 세션은 ...00n2.
insert into auth.sessions(id,user_id,aal,created_at,updated_at)
select ('86310000-0000-4000-8000-0000000000'||n||a)::uuid,('86300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('aal'||a)::auth.aal_level,now(),now()
from generate_series(1,6) n cross join generate_series(1,2) a;
insert into auth.refresh_tokens(token,user_id,revoked,created_at,updated_at,session_id)
select 'operator-mfa-refresh-'||n,'86300000-0000-4000-8000-'||lpad(n::text,12,'0'),false,now(),now(),('86310000-0000-4000-8000-0000000000'||n||'1')::uuid
from generate_series(1,6) n;
-- 관리자만 미리 TOTP를 등록해 둔다.
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
values('86320000-0000-4000-8000-000000000001','86300000-0000-4000-8000-000000000001','operator-mfa-1','totp','verified',now(),now(),'synthetic');

create function pg_temp.expect_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q; exception when others then if sqlerrm=expected or sqlstate=expected then return; end if; raise; end; raise exception 'expected error: % (%)',expected,q; end $$;
-- 요청 주체와 JWT를 바꾼다. aal은 'aal1'·'aal2', session은 세션 끝 숫자(없으면 session_id 없음).
create function pg_temp.as_user(p_user integer,p_aal text,p_session integer default null) returns void language sql as $$
  select set_config('request.jwt.claim.sub','86300000-0000-4000-8000-'||lpad(p_user::text,12,'0'),true),
    set_config('request.jwt.claims',jsonb_strip_nulls(jsonb_build_object('sub','86300000-0000-4000-8000-'||lpad(p_user::text,12,'0'),
      'role','authenticated','aal',p_aal,'session_id',case when p_session is null then null else '86310000-0000-4000-8000-0000000000'||p_user||p_session end))::text,true);
$$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$ select ('86300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;

-- 봉인: 판정 helper·스위치 행은 앱 롤이 직접 만나지 못한다. 관리 RPC는 authenticated만 부른다.
select 1/case when not has_table_privilege('authenticated','private.operator_mfa_policy','select')
  and not has_table_privilege('service_role','private.operator_mfa_policy','update')
  and not has_function_privilege('authenticated','private.operator_mfa_blocks(uuid)','execute')
  and not has_function_privilege('anon','private.operator_mfa_required()','execute')
  and not has_function_privilege('authenticated','private.operator_revoke_auth_sessions(uuid)','execute')
  and not has_function_privilege('service_role','private.operator_mfa_session_verified(uuid)','execute')
  and has_function_privilege('authenticated','public.admin_save_operator_mfa_policy(boolean,bigint,uuid)','execute')
  and not has_function_privilege('anon','public.admin_reset_operator_mfa(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_get_operator_mfa_policy()','execute')
  and (select not required from private.operator_mfa_policy where singleton)
  then 1 else 0 end as sealed_and_default_off;

-- 권한 전환(최초 역할 지정) 때 미지정으로 회수되는 운영자의 세션이 끊긴다. 스위치가 꺼져 있으면 aal1 관리자가 그대로 한다.
select jsonb_agg(jsonb_build_object('profileId',id,'managerRole',case id
  when pg_temp.uid(1) then 'owner' when pg_temp.uid(2) then 'primary' when pg_temp.uid(3) then 'deputy' when pg_temp.uid(6) then 'logistics'
  else null end) order by id) as mapping from public.profiles where role in ('staff','admin') \gset
select pg_temp.as_user(1,'aal1',1);
set local role authenticated;
select 1/case when public.admin_current_operator_access()->'mfa'='{"required":false,"satisfied":true}'::jsonb
  and public.has_operator_capability('operators.manage',true) and public.is_staff() then 1 else 0 end as off_switch_keeps_aal1_operator;
select public.admin_activate_operator_access(:'mapping'::jsonb,1,'86330000-0000-4000-8000-000000000001');
reset role;
select 1/case when not exists(select 1 from auth.sessions where user_id=pg_temp.uid(4))
  and not exists(select 1 from auth.refresh_tokens where user_id=pg_temp.uid(4)::text)
  and (select count(*) from auth.sessions where user_id=pg_temp.uid(1))=2
  and (select count(*) from auth.sessions where user_id=pg_temp.uid(2))=2 then 1 else 0 end as activation_revocation_ends_sessions;

-- 켜기: 본인 세션이 aal2가 아니거나, 세션 행이 없거나, 운영자 중 미등록자가 있으면 거절한다.
select pg_temp.as_user(1,'aal1',1);
set local role authenticated;
select 1/case when public.admin_get_operator_mfa_policy()->>'unenrolledCount'='3'
  and jsonb_array_length(public.admin_get_operator_mfa_policy()->'operators')=4
  and public.admin_get_operator_mfa_policy()#>>'{operators,3,verifiedFactors}'='1' then 1 else 0 end as policy_lists_operator_enrollment;
select pg_temp.expect_error($q$select public.admin_save_operator_mfa_policy(true,1,'86330000-0000-4000-8000-000000000011')$q$,'operator_mfa_self_required');
select pg_temp.as_user(1,'aal2',9);
select pg_temp.expect_error($q$select public.admin_save_operator_mfa_policy(true,1,'86330000-0000-4000-8000-000000000012')$q$,'operator_mfa_self_required');
select pg_temp.as_user(1,'aal2',2);
select pg_temp.expect_error($q$select public.admin_save_operator_mfa_policy(true,1,'86330000-0000-4000-8000-000000000013')$q$,'operator_mfa_unenrolled');
reset role;
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
select ('86320000-0000-4000-8000-00000000000'||n)::uuid,pg_temp.uid(n),'operator-mfa-'||n,'totp','verified',now(),now(),'synthetic' from unnest(array[2,3,6]) n;
select pg_temp.as_user(1,'aal2',2);
set local role authenticated;
select pg_temp.expect_error($q$select public.admin_save_operator_mfa_policy(true,2,'86330000-0000-4000-8000-000000000014')$q$,'PT409');
select public.admin_save_operator_mfa_policy(true,1,'86330000-0000-4000-8000-000000000015') as enabled \gset
select 1/case when (:'enabled'::jsonb)->>'required'='true' and (:'enabled'::jsonb)->>'revision'='2'
  and public.admin_save_operator_mfa_policy(true,1,'86330000-0000-4000-8000-000000000015')=:'enabled'::jsonb then 1 else 0 end as enable_exact_replay;
reset role;
select 1/case when (select required from private.operator_mfa_policy where singleton)
  and exists(select 1 from public.audit_log where id='86330000-0000-4000-8000-000000000015' and action='admin.operator.mfa_policy' and actor_id=pg_temp.uid(1)
    and diff#>>'{before,required}'='false') then 1 else 0 end as enable_audited;

-- 켜진 뒤: aal1 운영자는 능력 판정·RLS 진입·역할 기반 판정·RPC 모두 거절. 본인 권한 응답은 MFA 대기를 알린다.
select pg_temp.as_user(2,'aal1',1);
set local role authenticated;
select 1/case when not public.has_operator_capability('home') and not public.is_staff()
  and public.admin_current_operator_access()->>'mode'='configured'
  and public.admin_current_operator_access()->'mfa'='{"required":true,"satisfied":false}'::jsonb then 1 else 0 end as aal1_operator_blocked;
select pg_temp.expect_error('select public.admin_get_collectible_features()','operator_mfa_required');
select pg_temp.expect_error('select public.admin_search_operators()','operator_capability_required');
-- aal2라도 그 JWT의 세션 행이 없으면(끊긴 세션) 거절한다. aal 주장 없이 세션만 있어도 거절한다.
select pg_temp.as_user(2,'aal2',9);
select 1/case when not public.has_operator_capability('home') then 1 else 0 end as aal2_without_live_session_blocked;
select pg_temp.as_user(2,null,2);
select 1/case when not public.has_operator_capability('home') then 1 else 0 end as missing_aal_blocked;
select pg_temp.as_user(2,'aal2',2);
select 1/case when public.has_operator_capability('platform.manage',true) and public.is_staff()
  and public.admin_current_operator_access()->'mfa'='{"required":true,"satisfied":true}'::jsonb
  and public.admin_get_collectible_features() ? 'revision' then 1 else 0 end as aal2_operator_allowed;
-- 다른 사람의 권한을 확인하는 판정은 지금 세션과 무관하다(대상 운영자 MFA를 따지지 않는다).
select pg_temp.as_user(2,'aal1',1);
reset role;
select 1/case when private.has_operator_capability(pg_temp.uid(3),'catalog.manage') then 1 else 0 end as other_actor_check_unaffected;

-- 세션 행이 aal1로 내려간 세션(GoTrue가 요소 삭제 때 내린다)은 JWT가 aal2라도 거절한다.
reset role;
update auth.sessions set aal='aal1' where id='86310000-0000-4000-8000-000000000022';
select pg_temp.as_user(2,'aal2',2);
set local role authenticated;
select 1/case when not public.has_operator_capability('home') then 1 else 0 end as downgraded_session_row_blocked;
reset role;
update auth.sessions set aal='aal2' where id='86310000-0000-4000-8000-000000000022';
-- 인증 앱이 모두 지워진 사용자(초기화의 admin 삭제는 세션 행 aal을 내리지 않는다)의 aal2 세션도 거절한다.
delete from auth.mfa_factors where user_id=pg_temp.uid(2);
select pg_temp.as_user(2,'aal2',2);
set local role authenticated;
select 1/case when not public.has_operator_capability('home') then 1 else 0 end as factorless_aal2_session_blocked;
reset role;
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
values('86320000-0000-4000-8000-000000000002',pg_temp.uid(2),'operator-mfa-2','totp','verified',now(),now(),'synthetic');

-- 앱 서버가 사용자 JWT를 검증한 뒤 service client로 사용자·세션을 넘기는 경로(클레임 연락처·상담 첨부·디지털 자산·
-- 환불 계좌 내려받기·부분취소 정리·리뷰 내보내기)도 넘겨받은 세션 행이 aal2여야 운영자로 본다(aal2면 권한 관문을 지나 다음 검사에서 멈춘다).
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.sid(n integer,a integer) returns uuid language sql immutable as $$ select ('86310000-0000-4000-8000-0000000000'||n||a)::uuid $$;
select pg_temp.expect_error(format('select private.contact_require_identity(%L,%L,%L,false,%L,true)',pg_temp.uid(2),pg_temp.sid(2,1),'sales.manage','{}'),'auth_changed');
select private.contact_require_identity(pg_temp.uid(2),pg_temp.sid(2,2),'sales.manage',false,'{}',true);
select private.contact_require_identity(pg_temp.uid(5),pg_temp.sid(5,1),null,false,'{}',true);
select pg_temp.expect_error(format('select private.inquiry_file_session(%L,%L,true)',pg_temp.uid(2),pg_temp.sid(2,1)),'operator_mfa_required');
select private.inquiry_file_session(pg_temp.uid(2),pg_temp.sid(2,2),true);
select private.inquiry_file_session(pg_temp.uid(5),pg_temp.sid(5,1),false);
select pg_temp.expect_error(format('select private.digital_operator_session(%L,%L)',pg_temp.uid(2),pg_temp.sid(2,1)),'42501');
select private.digital_operator_session(pg_temp.uid(2),pg_temp.sid(2,2));
insert into private.inquiry_chat_files(id,actor_id,session_id,filename,mime_type,path,size_bytes,sha256,state,in_library,expires_at,verified_at)
values('86340000-0000-4000-8000-000000000001',pg_temp.uid(2),pg_temp.sid(2,2),'operator-mfa.pdf','application/pdf',
  '86340000-0000-4000-8000-000000000001/86340000-0000-4000-8000-000000000002.pdf',10,repeat('a',64),'verified',true,now()+interval '1 day',now());
set local role service_role;
select pg_temp.expect_error(format('select public.service_inquiry_file_download(%L,%L,%L)',pg_temp.uid(2),pg_temp.sid(2,1),'86340000-0000-4000-8000-000000000001'),'42501');
select 1/case when public.service_inquiry_file_download(pg_temp.uid(2),pg_temp.sid(2,2),'86340000-0000-4000-8000-000000000001') ? 'path' then 1 else 0 end as aal2_staff_library_download;
select pg_temp.expect_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',pg_temp.uid(2),pg_temp.sid(2,1),'86340000-0000-4000-8000-000000000011','[]'),'bank_refund_permission_required');
select public.service_export_bank_transfer_refund_accounts(pg_temp.uid(2),pg_temp.sid(2,2),'86340000-0000-4000-8000-000000000012','[]') is not null as aal2_bank_export_allowed;
select pg_temp.expect_error(format('select public.service_export_order_partial_cancellation_refund_accounts(%L,%L,%L,%L)',pg_temp.uid(2),pg_temp.sid(2,1),'86340000-0000-4000-8000-000000000013','[]'),'bank_refund_permission_required');
select pg_temp.expect_error(format('select public.service_resolve_order_partial_cancellation(%L,%L,%L,null,null,%L,%L)','86340000-0000-4000-8000-000000000014','retry','합성',pg_temp.uid(2),pg_temp.sid(2,1)),'bank_refund_permission_required');
select pg_temp.expect_error(format('select public.service_record_review_export_v2(%L,%L,%L,%L,0,%L,%L)',pg_temp.uid(2),pg_temp.sid(2,1),'{}',repeat('a',64),now()-interval '1 second',repeat('b',64)),'review_export_auth_changed');
select pg_temp.expect_error(format('select public.service_record_review_export_v2(%L,%L,%L,%L,0,%L,%L)',pg_temp.uid(2),pg_temp.sid(2,2),'{}',repeat('a',64),now()-interval '1 second',repeat('b',64)),'invalid_review_export_filters');
select pg_temp.expect_error(format('select public.service_record_review_export(%L,%L,%L,%L,0,%L,%L)',pg_temp.uid(2),pg_temp.sid(2,1),'{}',repeat('a',64),now()-interval '1 second',repeat('b',64)),'review_export_auth_changed');
reset role;

-- 고객: 능력이 없어 거절 사유도 그대로이고 고객 RPC는 영향이 없다.
select pg_temp.as_user(5,'aal1',1);
set local role authenticated;
select 1/case when not public.has_operator_capability('home') and not public.is_staff()
  and public.admin_current_operator_access()->>'mode'='none'
  and public.admin_current_operator_access()->'mfa'='{"required":false,"satisfied":true}'::jsonb
  and public.get_collectible_features() ? 'binder' then 1 else 0 end as customer_unaffected;
select pg_temp.expect_error('select public.admin_get_collectible_features()','operator_capability_required');
reset role;

-- service_role·cron(JWT 없음)·트리거 경로는 판정 대상의 MFA를 묻지 않는다.
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
select 1/case when private.has_operator_capability(pg_temp.uid(2),'sales.manage')
  and private.require_actor_operator_capability(pg_temp.uid(2),'sales.manage')=pg_temp.uid(2) then 1 else 0 end as cron_path_unaffected;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select 1/case when public.has_operator_capability('home') is false then 1 else 0 end as service_role_self_predicate_unchanged;
reset role;
select 1/case when private.has_operator_capability(pg_temp.uid(2),'sales.manage') then 1 else 0 end as service_role_actor_path_unaffected;

-- 초기화: 최고 관리자(통합 매니저)만, 본인·운영자 아닌 계정은 거절. 대상 세션을 끊고 감사 기록을 남긴다.
select pg_temp.as_user(2,'aal2',2);
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_reset_operator_mfa(%L,%L)',pg_temp.uid(3),'86330000-0000-4000-8000-000000000021'),'operator_mfa_reset_owner_only');
select pg_temp.as_user(1,'aal2',2);
select pg_temp.expect_error(format('select public.admin_reset_operator_mfa(%L,%L)',pg_temp.uid(1),'86330000-0000-4000-8000-000000000022'),'operator_self_change_denied');
select pg_temp.expect_error(format('select public.admin_reset_operator_mfa(%L,%L)',pg_temp.uid(5),'86330000-0000-4000-8000-000000000023'),'operator_mfa_reset_target_invalid');
select public.admin_reset_operator_mfa(pg_temp.uid(3),'86330000-0000-4000-8000-000000000024') as reset \gset
select 1/case when (:'reset'::jsonb)->>'factorCount'='1' and (:'reset'::jsonb)->>'sessionsRevoked'='2'
  and public.admin_reset_operator_mfa(pg_temp.uid(3),'86330000-0000-4000-8000-000000000024')=:'reset'::jsonb then 1 else 0 end as reset_exact_replay;
select pg_temp.expect_error(format('select public.admin_reset_operator_mfa(%L,%L)',pg_temp.uid(2),'86330000-0000-4000-8000-000000000024'),'operation_conflict');
reset role;
-- 같은 요청의 재시도(요소 삭제 뒤 마무리 호출 포함)는 그 사이 새로 만든 세션도 끊는다.
reset role;
insert into auth.sessions(id,user_id,aal,created_at,updated_at) values('86310000-0000-4000-8000-000000000039',pg_temp.uid(3),'aal2',now(),now());
select pg_temp.as_user(1,'aal2',2);
set local role authenticated;
select 1/case when public.admin_reset_operator_mfa(pg_temp.uid(3),'86330000-0000-4000-8000-000000000024')=:'reset'::jsonb then 1 else 0 end as reset_replay_same_receipt;
reset role;
select 1/case when not exists(select 1 from auth.sessions where user_id=pg_temp.uid(3))
  and not exists(select 1 from auth.refresh_tokens where user_id=pg_temp.uid(3)::text)
  and exists(select 1 from public.audit_log where id='86330000-0000-4000-8000-000000000024' and action='admin.operator.mfa_reset'
    and target='profile:'||pg_temp.uid(3) and actor_id=pg_temp.uid(1)) then 1 else 0 end as reset_ends_sessions_and_audits;
-- 끊긴 aal2 세션의 JWT는 만료 전이라도 운영자로 인정되지 않는다.
select pg_temp.as_user(3,'aal2',2);
set local role authenticated;
select 1/case when not public.has_operator_capability('home') then 1 else 0 end as revoked_session_jwt_blocked;

-- 역할 회수: 그 사용자의 모든 세션과 refresh token을 같은 트랜잭션에서 지운다.
select pg_temp.as_user(1,'aal2',2);
select public.admin_change_operator_role(pg_temp.uid(6),null,1,(select (public.admin_current_operator_access()->>'revision')::bigint),'86330000-0000-4000-8000-000000000031');
reset role;
select 1/case when not exists(select 1 from auth.sessions where user_id=pg_temp.uid(6))
  and not exists(select 1 from auth.refresh_tokens where user_id=pg_temp.uid(6)::text)
  and (select role from public.profiles where id=pg_temp.uid(6))='user' then 1 else 0 end as role_revocation_ends_sessions;

-- 끄기: 켜진 동안에는 aal2 운영자만 끌 수 있고, 끄면 aal1 운영자가 다시 들어온다.
select pg_temp.as_user(1,'aal1',1);
set local role authenticated;
select pg_temp.expect_error($q$select public.admin_save_operator_mfa_policy(false,2,'86330000-0000-4000-8000-000000000041')$q$,'operator_mfa_required');
select pg_temp.as_user(1,'aal2',2);
select 1/case when public.admin_save_operator_mfa_policy(false,2,'86330000-0000-4000-8000-000000000042')->>'required'='false' then 1 else 0 end as disabled;
select pg_temp.as_user(2,'aal1',1);
select 1/case when public.has_operator_capability('home') and public.admin_get_collectible_features() ? 'revision' then 1 else 0 end as off_again_aal1_allowed;
reset role;
rollback;
