\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 카드 바인더·굿즈 마켓·카드 트레이드 공개 스위치 (2026-11-18)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 세 기능은 전부 꺼진 상태로 시작한다(운영자가 아직 바꾸지 않은 revision 1)
--   · 스위치 행은 앱 롤이 직접 읽거나 쓰지 못하고, 공개 읽기는 세 불리언만 돌려준다
--   · 읽기·저장은 platform.manage 운영자만 — 일반 회원·비로그인·권한 없는 staff는 거절
--   · 저장은 감사 기록을 남기고 같은 작업 ID는 같은 결과(멱등), 다른 요청이면 충돌
--   · 화면이 본 revision이 낡았으면 PT409로 거절하고 값을 바꾸지 않는다
-- ============================================================================

select 1/case when (
  has_function_privilege('anon','public.get_collectible_features()','execute')
  and has_function_privilege('authenticated','public.get_collectible_features()','execute')
  and not has_function_privilege('service_role','public.get_collectible_features()','execute')
  and has_function_privilege('authenticated','public.admin_get_collectible_features()','execute')
  and not has_function_privilege('anon','public.admin_get_collectible_features()','execute')
  and not has_function_privilege('service_role','public.admin_get_collectible_features()','execute')
  and has_function_privilege('authenticated','public.admin_save_collectible_features(boolean,boolean,boolean,bigint,uuid)','execute')
  and not has_function_privilege('anon','public.admin_save_collectible_features(boolean,boolean,boolean,bigint,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_save_collectible_features(boolean,boolean,boolean,bigint,uuid)','execute')
  and not has_function_privilege('authenticated','private.collectible_features_state()','execute')
  and not has_function_privilege('authenticated','private.collectible_features_admin_document()','execute')
  and not has_table_privilege('anon','private.collectible_feature_control','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.collectible_feature_control','select,insert,update,delete')
  and not has_table_privilege('service_role','private.collectible_feature_control','select,insert,update,delete')
  and (select relrowsecurity from pg_class where oid='private.collectible_feature_control'::regclass)
  -- 권한 가드(volatile)를 부르는 관리자 읽기는 stable이면 PostgREST 읽기 전용 트랜잭션에서 25006(HTTP 405)으로 막힌다.
  and (select provolatile='v' from pg_proc where oid='public.admin_get_collectible_features()'::regprocedure)
  and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_get_collectible_features()'
    and capability='platform.manage' and guard_kind='read' and legacy_admin_only)
  and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_save_collectible_features(boolean,boolean,boolean,bigint,uuid)'
    and capability='platform.manage' and guard_kind='write' and legacy_admin_only)
) then 1 else 0 end as assert_sealed_acl_and_contracts;

-- 운영자가 아직 바꾸지 않은(revision 1) DB는 migration 기본값(전부 꺼짐) 그대로다.
select 1/case when (select revision>1 or not (binder_enabled or market_enabled or exchange_enabled)
  from private.collectible_feature_control where singleton) then 1 else 0 end as assert_starts_disabled;

-- 이후 단언은 기본값에서 출발한다(트랜잭션은 끝에서 되돌린다).
update private.collectible_feature_control set revision=1,binder_enabled=false,market_enabled=false,exchange_enabled=false,
  updated_by=null where singleton;

-- ---------------------------------------------------------------------------
-- Fixtures (합성 값)
-- ---------------------------------------------------------------------------
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: % (statement: %)',expected,statement;
end $$;
create function pg_temp.expect_state(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected SQLSTATE: % (statement: %)',expected,statement;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c0f00000-0000-4000-8000-000000000001','authenticated','authenticated','collectible-admin@example.test',now(),'{}','{}',now(),now()),
 ('c0f00000-0000-4000-8000-000000000002','authenticated','authenticated','collectible-deputy@example.test',now(),'{}','{}',now(),now()),
 ('c0f00000-0000-4000-8000-000000000003','authenticated','authenticated','collectible-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 수집 기능 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case right(id::text,1) when '1' then 'admin'::public.user_role when '2' then 'staff'::public.user_role else 'user'::public.user_role end
 where id in('c0f00000-0000-4000-8000-000000000001','c0f00000-0000-4000-8000-000000000002','c0f00000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values
 ('c0f00000-0000-4000-8000-000000000001','primary'),
 ('c0f00000-0000-4000-8000-000000000002','deputy');
update private.operator_access_state set configured=true where id;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',coalesce(p::text,''),true);
 perform set_config('request.jwt.claims',case when p is null then '{"role":"anon"}' else jsonb_build_object('sub',p,'role','authenticated')::text end,true);
end $$;
grant execute on function pg_temp.as_actor(uuid) to anon,authenticated;
grant execute on function pg_temp.expect_error(text,text) to anon,authenticated;
grant execute on function pg_temp.expect_state(text,text) to anon,authenticated;

create temporary table collectible_results(name text primary key,result jsonb) on commit drop;
grant all on collectible_results to anon,authenticated;

-- ---------------------------------------------------------------------------
-- 공개 읽기: 비로그인·회원 모두 세 불리언만 본다. 행을 직접 읽지 못한다.
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_actor(null);
insert into collectible_results values('anon_public',public.get_collectible_features());
select pg_temp.expect_state('select * from private.collectible_feature_control','42501');
select pg_temp.expect_state('select public.admin_get_collectible_features()','42501');
reset role;

select 1/case when (select result from collectible_results where name='anon_public')
  ='{"binder":false,"market":false,"exchange":false}'::jsonb then 1 else 0 end as assert_public_read_is_three_flags;

-- 회원·권한 없는 staff(deputy)는 읽기·저장 모두 거절된다.
set local role authenticated;
select pg_temp.as_actor('c0f00000-0000-4000-8000-000000000003');
select pg_temp.expect_error('select public.admin_get_collectible_features()','operator_capability_required');
select pg_temp.expect_error($$select public.admin_save_collectible_features(true,true,true,1,'c0f00000-0000-4000-9000-000000000001')$$,'operator_capability_required');
select pg_temp.expect_state('update private.collectible_feature_control set binder_enabled=true','42501');
select pg_temp.as_actor('c0f00000-0000-4000-8000-000000000002');
select pg_temp.expect_error('select public.admin_get_collectible_features()','operator_capability_required');
select pg_temp.expect_error($$select public.admin_save_collectible_features(true,true,true,1,'c0f00000-0000-4000-9000-000000000001')$$,'operator_capability_required');
-- 로그인하지 않은 authenticated 요청은 인증 오류다.
select pg_temp.as_actor(null);
select pg_temp.expect_error($$select public.admin_save_collectible_features(true,true,true,1,'c0f00000-0000-4000-9000-000000000001')$$,'auth_required');
reset role;

select 1/case when (select revision=1 and not (binder_enabled or market_enabled or exchange_enabled)
  from private.collectible_feature_control where singleton) then 1 else 0 end as assert_denied_calls_change_nothing;
select 1/case when not exists(select 1 from public.audit_log where action='admin.collectible_features.settings'
  and id='c0f00000-0000-4000-9000-000000000001') then 1 else 0 end as assert_denied_calls_leave_no_audit;

-- ---------------------------------------------------------------------------
-- 관리자 저장: 감사·멱등·충돌·낡은 revision
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_actor('c0f00000-0000-4000-8000-000000000001');
insert into collectible_results values('admin_initial',public.admin_get_collectible_features());
select pg_temp.expect_error($$select public.admin_save_collectible_features(null,true,true,1,'c0f00000-0000-4000-9000-000000000002')$$,'invalid_collectible_features');
select pg_temp.expect_error($$select public.admin_save_collectible_features(true,true,true,0,'c0f00000-0000-4000-9000-000000000002')$$,'invalid_collectible_features');
select pg_temp.expect_error('select public.admin_save_collectible_features(true,true,true,1,null)','invalid_collectible_features');
-- 바인더만 켠다.
insert into collectible_results values('admin_enable_binder',
  public.admin_save_collectible_features(true,false,false,1,'c0f00000-0000-4000-9000-000000000010'));
-- 같은 작업 ID·같은 요청은 같은 결과를 다시 돌려주고 revision을 올리지 않는다.
insert into collectible_results values('admin_replay',
  public.admin_save_collectible_features(true,false,false,1,'c0f00000-0000-4000-9000-000000000010'));
-- 같은 작업 ID에 다른 요청은 충돌이다.
select pg_temp.expect_error($$select public.admin_save_collectible_features(true,true,false,1,'c0f00000-0000-4000-9000-000000000010')$$,'operation_conflict');
-- 낡은 revision(1)으로 다시 저장하면 PT409.
select pg_temp.expect_state($$select public.admin_save_collectible_features(false,false,false,1,'c0f00000-0000-4000-9000-000000000011')$$,'PT409');
insert into collectible_results values('member_view_after_enable',public.get_collectible_features());
reset role;

select 1/case when (select result->>'revision'='1' and result->>'binder'='false' and result->>'market'='false' and result->>'exchange'='false'
  and result ? 'updatedAt' and result ? 'updatedBy' from collectible_results where name='admin_initial') then 1 else 0 end as assert_admin_reads_document;
select 1/case when (select r.result=e.result from collectible_results r,collectible_results e where r.name='admin_replay' and e.name='admin_enable_binder')
  and (select result->>'revision'='2' and (result->>'binder')::boolean and not (result->>'market')::boolean and not (result->>'exchange')::boolean
    and result->>'updatedBy'='TEST 수집 기능 1' from collectible_results where name='admin_enable_binder')
  then 1 else 0 end as assert_save_is_idempotent;
select 1/case when (select revision=2 and binder_enabled and not market_enabled and not exchange_enabled
  and updated_by='c0f00000-0000-4000-8000-000000000001' from private.collectible_feature_control where singleton)
  then 1 else 0 end as assert_stale_revision_changes_nothing;
select 1/case when (select count(*)=1 from public.audit_log where id='c0f00000-0000-4000-9000-000000000010'
  and actor_id='c0f00000-0000-4000-8000-000000000001' and action='admin.collectible_features.settings' and target='collectible_features'
  and diff->'request'='{"binder":true,"market":false,"exchange":false,"expectedRevision":1}'::jsonb
  and diff->'before'='{"binder":false,"market":false,"exchange":false}'::jsonb
  and diff->'result'->>'revision'='2')
  and not exists(select 1 from public.audit_log where id='c0f00000-0000-4000-9000-000000000011')
  then 1 else 0 end as assert_audit_recorded_once;
select 1/case when (select result from collectible_results where name='member_view_after_enable')
  ='{"binder":true,"market":false,"exchange":false}'::jsonb then 1 else 0 end as assert_public_read_follows_switch;

-- 끄기도 같은 경로로 감사된다.
set local role authenticated;
select pg_temp.as_actor('c0f00000-0000-4000-8000-000000000001');
insert into collectible_results values('admin_disable_all',
  public.admin_save_collectible_features(false,false,false,2,'c0f00000-0000-4000-9000-000000000012'));
reset role;
select 1/case when (select result->>'revision'='3' and not (result->>'binder')::boolean from collectible_results where name='admin_disable_all')
  and (select diff->'before'->>'binder'='true' from public.audit_log where id='c0f00000-0000-4000-9000-000000000012')
  and public.get_collectible_features()='{"binder":false,"market":false,"exchange":false}'::jsonb
  then 1 else 0 end as assert_disable_is_audited;

rollback;
