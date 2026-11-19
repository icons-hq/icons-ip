\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 운영 스위치 어드민 저장(지연 안내 메일·반품배송비 차감·재고 부족 부분 취소) (2026-11-19)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 세 스위치는 migration 직후 전부 꺼짐이고, 읽기·저장 RPC는 authenticated에게만 열려 있다
--   · 읽기·저장은 platform.manage 운영자만 — 일반 회원·권한 없는 staff·비로그인은 거절, 거절은 아무것도 바꾸지 않는다
--   · 켤 때는 근거(지연 2~500자, 반품·부분 취소 2~1000자)와 반품배송비 편도 금액이 필요하다
--   · 낡은 revision은 PT409, 같은 작업 ID는 같은 결과(멱등), 다른 요청이면 operation_conflict
--   · 저장은 admin.operations_switch.* 감사 한 줄(작업 ID = 행 ID). 이 RPC가 바꿀 때 시스템 트리거 감사는 건너뛰고,
--     SQL 편집기 같은 직접 변경은 시스템 감사에 남는다
--   · 기존 게이트(지연 안내 요청·일괄 변경, 반품배송비 판정, 부분 취소 판정)가 그대로 이 칸을 읽는다
-- ============================================================================

select 1/case when (
  has_function_privilege('authenticated','public.admin_get_operations_switches()','execute')
  and not has_function_privilege('anon','public.admin_get_operations_switches()','execute')
  and not has_function_privilege('service_role','public.admin_get_operations_switches()','execute')
  and has_function_privilege('authenticated','public.admin_save_order_delay_notice_switch(boolean,text,bigint,uuid)','execute')
  and not has_function_privilege('anon','public.admin_save_order_delay_notice_switch(boolean,text,bigint,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_save_order_delay_notice_switch(boolean,text,bigint,uuid)','execute')
  and has_function_privilege('authenticated','public.admin_save_return_fee_deduction_switch(boolean,integer,text,integer,uuid)','execute')
  and not has_function_privilege('anon','public.admin_save_return_fee_deduction_switch(boolean,integer,text,integer,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_save_return_fee_deduction_switch(boolean,integer,text,integer,uuid)','execute')
  and has_function_privilege('authenticated','public.admin_save_partial_cancel_switch(boolean,text,integer,uuid)','execute')
  and not has_function_privilege('anon','public.admin_save_partial_cancel_switch(boolean,text,integer,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_save_partial_cancel_switch(boolean,text,integer,uuid)','execute')
  and not has_function_privilege('authenticated','private.operations_switches_document()','execute')
  and not has_function_privilege('authenticated','private.order_delay_notice_control_guard()','execute')
  and (select provolatile='v' from pg_proc where oid='public.admin_get_operations_switches()'::regprocedure)
  and (select count(*)=4 from private.operator_rpc_contracts where signature in (
    'public.admin_get_operations_switches()','public.admin_save_order_delay_notice_switch(boolean,text,bigint,uuid)',
    'public.admin_save_return_fee_deduction_switch(boolean,integer,text,integer,uuid)','public.admin_save_partial_cancel_switch(boolean,text,integer,uuid)')
    and capability='platform.manage' and legacy_admin_only and guard_kind in ('read','write'))
  and to_regprocedure('private.o3a_patch_function(text,text,text)') is null
) then 1 else 0 end as assert_sealed_acl_and_contracts;

-- migration은 아무 스위치도 켜지 않았다(이미 운영자가 바꾼 DB면 건너뛴다).
select 1/case when (select revision>1 or not enabled from private.order_delay_notice_delivery_control where singleton)
  and (select revision>1 or not (enabled or partial_cancel_enabled) from private.return_fee_deduction_settings where singleton)
  then 1 else 0 end as assert_starts_disabled;

-- 이후 단언은 기본값에서 출발한다(트랜잭션은 끝에서 되돌린다).
update private.order_delay_notice_delivery_control set enabled=false,sms_enabled=false,evidence=null,updated_by=null where singleton;
update private.return_fee_deduction_settings set enabled=false,one_way_amount=null,evidence=null,enabled_at=null,
  partial_cancel_enabled=false,partial_cancel_evidence=null,partial_cancel_enabled_at=null,updated_by=null where singleton;
delete from public.audit_log where action in ('system.order_delay_notice.delivery_changed','system.return_fee_deduction.settings_changed');
update private.order_delay_notice_delivery_control set revision=1 where singleton;
-- (revision은 트리거가 올리므로 직접 맞춘다)
alter table private.order_delay_notice_delivery_control disable trigger order_delay_notice_control_revision;
update private.order_delay_notice_delivery_control set revision=1 where singleton;
alter table private.order_delay_notice_delivery_control enable trigger order_delay_notice_control_revision;
alter table private.return_fee_deduction_settings disable trigger return_fee_deduction_settings_revision;
update private.return_fee_deduction_settings set revision=1 where singleton;
alter table private.return_fee_deduction_settings enable trigger return_fee_deduction_settings_revision;
delete from public.audit_log where action in ('system.order_delay_notice.delivery_changed','system.return_fee_deduction.settings_changed');

create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: % (statement: %)',expected,statement;
end $$;
create function pg_temp.expect_state(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected SQLSTATE: % (statement: %)',expected,statement;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c3a00000-0000-4000-8000-000000000001','authenticated','authenticated','switch-admin@example.test',now(),'{}','{}',now(),now()),
 ('c3a00000-0000-4000-8000-000000000002','authenticated','authenticated','switch-deputy@example.test',now(),'{}','{}',now(),now()),
 ('c3a00000-0000-4000-8000-000000000003','authenticated','authenticated','switch-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 스위치 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case right(id::text,1) when '1' then 'admin'::public.user_role when '2' then 'staff'::public.user_role else 'user'::public.user_role end
 where id in('c3a00000-0000-4000-8000-000000000001','c3a00000-0000-4000-8000-000000000002','c3a00000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values
 ('c3a00000-0000-4000-8000-000000000001','primary'),
 ('c3a00000-0000-4000-8000-000000000002','deputy');
update private.operator_access_state set configured=true where id;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',coalesce(p::text,''),true);
 perform set_config('request.jwt.claims',case when p is null then '{"role":"anon"}' else jsonb_build_object('sub',p,'role','authenticated')::text end,true);
end $$;
grant execute on function pg_temp.as_actor(uuid) to anon,authenticated;
grant execute on function pg_temp.expect_error(text,text) to anon,authenticated;
grant execute on function pg_temp.expect_state(text,text) to anon,authenticated;
create temporary table switch_results(name text primary key,result jsonb) on commit drop;
grant all on switch_results to anon,authenticated;

-- ---------------------------------------------------------------------------
-- 거절: 비로그인·회원·권한 없는 staff는 읽기도 저장도 못 하고 아무것도 바뀌지 않는다
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_actor(null);
select pg_temp.expect_state('select public.admin_get_operations_switches()','42501');
reset role;
set local role authenticated;
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
select pg_temp.expect_error('select public.admin_get_operations_switches()','operator_capability_required');
select pg_temp.expect_error($$select public.admin_save_order_delay_notice_switch(true,'TEST 근거 확인',1,'c3a00000-0000-4000-9000-000000000001')$$,'operator_capability_required');
select pg_temp.expect_error($$select public.admin_save_return_fee_deduction_switch(true,3000,'TEST 근거 확인',1,'c3a00000-0000-4000-9000-000000000001')$$,'operator_capability_required');
select pg_temp.expect_error($$select public.admin_save_partial_cancel_switch(true,'TEST 근거 확인',1,'c3a00000-0000-4000-9000-000000000001')$$,'operator_capability_required');
select pg_temp.expect_state('update private.order_delay_notice_delivery_control set enabled=true','42501');
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000002');
select pg_temp.expect_error('select public.admin_get_operations_switches()','operator_capability_required');
select pg_temp.expect_error($$select public.admin_save_order_delay_notice_switch(true,'TEST 근거 확인',1,'c3a00000-0000-4000-9000-000000000001')$$,'operator_capability_required');
select pg_temp.expect_error($$select public.admin_save_return_fee_deduction_switch(true,3000,'TEST 근거 확인',1,'c3a00000-0000-4000-9000-000000000001')$$,'operator_capability_required');
select pg_temp.expect_error($$select public.admin_save_partial_cancel_switch(true,'TEST 근거 확인',1,'c3a00000-0000-4000-9000-000000000001')$$,'operator_capability_required');
select pg_temp.as_actor(null);
select pg_temp.expect_error($$select public.admin_save_order_delay_notice_switch(true,'TEST 근거 확인',1,'c3a00000-0000-4000-9000-000000000001')$$,'auth_required');
reset role;

select 1/case when (select not enabled and revision=1 from private.order_delay_notice_delivery_control where singleton)
  and (select not enabled and not partial_cancel_enabled and revision=1 from private.return_fee_deduction_settings where singleton)
  and not exists(select 1 from public.audit_log where id='c3a00000-0000-4000-9000-000000000001')
  then 1 else 0 end as assert_denied_calls_change_nothing;

-- ---------------------------------------------------------------------------
-- 관리자 읽기·검증
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
insert into switch_results values('initial',public.admin_get_operations_switches());
select pg_temp.expect_error($$select public.admin_save_order_delay_notice_switch(null,'TEST 근거 확인',1,'c3a00000-0000-4000-9000-000000000002')$$,'invalid_operations_switch');
select pg_temp.expect_error($$select public.admin_save_order_delay_notice_switch(true,'TEST 근거 확인',0,'c3a00000-0000-4000-9000-000000000002')$$,'invalid_operations_switch');
select pg_temp.expect_error($$select public.admin_save_order_delay_notice_switch(true,'TEST 근거 확인',1,null)$$,'invalid_operations_switch');
select pg_temp.expect_error($$select public.admin_save_order_delay_notice_switch(true,' 앞뒤 공백 ',1,'c3a00000-0000-4000-9000-000000000002')$$,'invalid_operations_switch');
select pg_temp.expect_error($$select public.admin_save_order_delay_notice_switch(true,'가',1,'c3a00000-0000-4000-9000-000000000002')$$,'invalid_operations_switch');
select pg_temp.expect_error($$select public.admin_save_order_delay_notice_switch(true,repeat('가',501),1,'c3a00000-0000-4000-9000-000000000002')$$,'invalid_operations_switch');
select pg_temp.expect_error($$select public.admin_save_order_delay_notice_switch(true,null,1,'c3a00000-0000-4000-9000-000000000002')$$,'operations_switch_evidence_required');
select pg_temp.expect_error($$select public.admin_save_return_fee_deduction_switch(true,null,'TEST 근거 확인',1,'c3a00000-0000-4000-9000-000000000002')$$,'operations_switch_evidence_required');
select pg_temp.expect_error($$select public.admin_save_return_fee_deduction_switch(true,3000,null,1,'c3a00000-0000-4000-9000-000000000002')$$,'operations_switch_evidence_required');
select pg_temp.expect_error($$select public.admin_save_return_fee_deduction_switch(true,0,'TEST 근거 확인',1,'c3a00000-0000-4000-9000-000000000002')$$,'invalid_operations_switch');
select pg_temp.expect_error($$select public.admin_save_return_fee_deduction_switch(true,1000001,'TEST 근거 확인',1,'c3a00000-0000-4000-9000-000000000002')$$,'invalid_operations_switch');
select pg_temp.expect_error($$select public.admin_save_partial_cancel_switch(true,null,1,'c3a00000-0000-4000-9000-000000000002')$$,'operations_switch_evidence_required');
reset role;

select 1/case when (select result#>>'{delayNotice,revision}'='1' and result#>>'{delayNotice,enabled}'='false' and result#>>'{delayNotice,smsEnabled}'='false'
  and result#>>'{returnFee,enabled}'='false' and result#>'{returnFee,oneWayAmount}'='null'::jsonb
  and result#>>'{partialCancel,enabled}'='false' and result#>>'{partialCancel,revision}'='1'
  from switch_results where name='initial') then 1 else 0 end as assert_admin_reads_document;
select 1/case when (select revision=1 and not enabled from private.order_delay_notice_delivery_control where singleton)
  and (select revision=1 and not enabled and not partial_cancel_enabled from private.return_fee_deduction_settings where singleton)
  then 1 else 0 end as assert_invalid_calls_change_nothing;

-- ---------------------------------------------------------------------------
-- 지연 안내 메일 스위치: 켜기 · 멱등 · 충돌 · 낡은 revision · 끄기
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
insert into switch_results values('delay_on',public.admin_save_order_delay_notice_switch(true,'TEST 발신자·webhook 승인 확인',1,'c3a00000-0000-4000-9000-000000000010'));
insert into switch_results values('delay_replay',public.admin_save_order_delay_notice_switch(true,'TEST 발신자·webhook 승인 확인',1,'c3a00000-0000-4000-9000-000000000010'));
select pg_temp.expect_error($$select public.admin_save_order_delay_notice_switch(true,'TEST 다른 근거',1,'c3a00000-0000-4000-9000-000000000010')$$,'operation_conflict');
select pg_temp.expect_state($$select public.admin_save_order_delay_notice_switch(false,null,1,'c3a00000-0000-4000-9000-000000000011')$$,'PT409');
reset role;

select 1/case when (select r.result=e.result from switch_results r,switch_results e where r.name='delay_replay' and e.name='delay_on')
  and (select result#>>'{delayNotice,revision}'='2' and (result#>>'{delayNotice,enabled}')::boolean
    and result#>>'{delayNotice,evidence}'='TEST 발신자·webhook 승인 확인' and result#>>'{delayNotice,updatedBy}'='TEST 스위치 1'
    and result#>>'{delayNotice,smsEnabled}'='false' from switch_results where name='delay_on')
  and (select enabled and revision=2 and not sms_enabled and updated_by='c3a00000-0000-4000-8000-000000000001' from private.order_delay_notice_delivery_control where singleton)
  then 1 else 0 end as assert_delay_switch_on_idempotent;
select 1/case when (select count(*)=1 from public.audit_log where id='c3a00000-0000-4000-9000-000000000010'
  and actor_id='c3a00000-0000-4000-8000-000000000001' and action='admin.operations_switch.delay_notice' and target='order_delay_notice_delivery_control'
  and diff->'request'='{"enabled":true,"evidence":"TEST 발신자·webhook 승인 확인","expectedRevision":1}'::jsonb
  and diff->'before'->>'enabled'='false' and diff->'result'#>>'{delayNotice,revision}'='2')
  and not exists(select 1 from public.audit_log where id='c3a00000-0000-4000-9000-000000000011')
  and not exists(select 1 from public.audit_log where action='system.order_delay_notice.delivery_changed')
  then 1 else 0 end as assert_delay_switch_audited_once_without_system_duplicate;

-- 기존 게이트가 같은 칸을 읽는다(동작 시험은 order_delay_notices·goods_preorder_schedule_bulk가 한다).
select 1/case when (select prosrc like '%order_delay_notice_delivery_control%' from pg_proc where oid='public.admin_request_order_delay_notice(uuid)'::regprocedure)
  and (select prosrc like '%order_delay_notice_delivery_control%' from pg_proc
       where proname='admin_apply_goods_preorder_schedule_change' and pronamespace='public'::regnamespace)
  then 1 else 0 end as assert_existing_delay_gates_read_the_same_column;

set local role authenticated;
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
insert into switch_results values('delay_off',public.admin_save_order_delay_notice_switch(false,null,2,'c3a00000-0000-4000-9000-000000000012'));
reset role;
select 1/case when (select not enabled and revision=3 and evidence='TEST 발신자·webhook 승인 확인' from private.order_delay_notice_delivery_control where singleton)
  and (select diff->'before'->>'enabled'='true' from public.audit_log where id='c3a00000-0000-4000-9000-000000000012')
  then 1 else 0 end as assert_delay_switch_off_keeps_evidence_and_audits;

-- SQL 편집기 같은 직접 변경은 리비전을 올리고 시스템 감사에 남는다. (RPC 표식은 트랜잭션 번호에 묶이므로 이 시험은 한 트랜잭션이라 지운다.)
select set_config('icons.operations_switch_tx','',true);
update private.order_delay_notice_delivery_control set enabled=true where singleton;
select 1/case when (select revision=4 from private.order_delay_notice_delivery_control where singleton)
  and exists(select 1 from public.audit_log where action='system.order_delay_notice.delivery_changed'
    and diff#>>'{after,enabled}'='true' and diff#>>'{before,enabled}'='false' and actor_id is null)
  then 1 else 0 end as assert_direct_change_is_system_audited;
select pg_temp.expect_error('delete from private.order_delay_notice_delivery_control where singleton','order_delay_notice_delivery_control_required');
update private.order_delay_notice_delivery_control set enabled=false where singleton;

-- ---------------------------------------------------------------------------
-- 반품배송비 차감 스위치
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
insert into switch_results values('fee_on',public.admin_save_return_fee_deduction_switch(true,3000,'TEST 약관 개정 7일 공지·토스 부분 취소 확인',1,'c3a00000-0000-4000-9000-000000000020'));
insert into switch_results values('fee_replay',public.admin_save_return_fee_deduction_switch(true,3000,'TEST 약관 개정 7일 공지·토스 부분 취소 확인',1,'c3a00000-0000-4000-9000-000000000020'));
select pg_temp.expect_error($$select public.admin_save_return_fee_deduction_switch(true,4000,'TEST 약관 개정 7일 공지·토스 부분 취소 확인',1,'c3a00000-0000-4000-9000-000000000020')$$,'operation_conflict');
select pg_temp.expect_state($$select public.admin_save_return_fee_deduction_switch(false,null,null,1,'c3a00000-0000-4000-9000-000000000021')$$,'PT409');
reset role;
select 1/case when (select r.result=e.result from switch_results r,switch_results e where r.name='fee_replay' and e.name='fee_on')
  and (select enabled and one_way_amount=3000 and enabled_at is not null and revision=2 and not partial_cancel_enabled
    and updated_by='c3a00000-0000-4000-8000-000000000001' from private.return_fee_deduction_settings where singleton)
  and (select result#>>'{returnFee,oneWayAmount}'='3000' and result#>>'{returnFee,enabled}'='true' and result#>>'{partialCancel,enabled}'='false'
    from switch_results where name='fee_on')
  and public.get_return_fee_deduction_policy()='{"enabled": true, "oneWayAmount": 3000}'::jsonb
  then 1 else 0 end as assert_return_fee_on_idempotent_and_policy_follows;
select 1/case when (select count(*)=1 from public.audit_log where id='c3a00000-0000-4000-9000-000000000020'
  and action='admin.operations_switch.return_fee_deduction' and actor_id='c3a00000-0000-4000-8000-000000000001'
  and diff->'request'->>'oneWayAmount'='3000' and diff->'before'->>'enabled'='false')
  and not exists(select 1 from public.audit_log where action='system.return_fee_deduction.settings_changed' and diff#>>'{after,one_way_amount}'='3000')
  then 1 else 0 end as assert_return_fee_audited_once_without_system_duplicate;

-- 끄면 금액·근거는 남고 판정은 사라진다. 이미 켠 시각은 다시 켜기 전까지 유지된다.
set local role authenticated;
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
insert into switch_results values('fee_off',public.admin_save_return_fee_deduction_switch(false,null,null,2,'c3a00000-0000-4000-9000-000000000022'));
reset role;
select 1/case when (select not enabled and one_way_amount=3000 and evidence like 'TEST 약관%' and revision=3 from private.return_fee_deduction_settings where singleton)
  and public.get_return_fee_deduction_policy()='{"enabled": false, "oneWayAmount": null}'::jsonb
  then 1 else 0 end as assert_return_fee_off_keeps_amount;

-- SQL 편집기 같은 직접 변경은 기존 시스템 감사 모양 그대로 남는다.
select set_config('icons.operations_switch_tx','',true);
update private.return_fee_deduction_settings set enabled=true,enabled_at=clock_timestamp() where singleton;
select 1/case when exists(select 1 from public.audit_log where action='system.return_fee_deduction.settings_changed'
  and diff#>>'{after,enabled}'='true' and diff#>>'{before,enabled}'='false' and actor_id is null and diff ? 'sessionUser')
  and (select revision=4 from private.return_fee_deduction_settings where singleton)
  then 1 else 0 end as assert_return_fee_direct_change_keeps_system_audit;
update private.return_fee_deduction_settings set enabled=false where singleton;

-- ---------------------------------------------------------------------------
-- 재고 부족 부분 취소 스위치(반품배송비 스위치와 독립)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
insert into switch_results values('partial_on',public.admin_save_partial_cancel_switch(true,'TEST 토스 부분 취소 사용 확인·서원 품절 통보 경로',5,'c3a00000-0000-4000-9000-000000000030'));
insert into switch_results values('partial_replay',public.admin_save_partial_cancel_switch(true,'TEST 토스 부분 취소 사용 확인·서원 품절 통보 경로',5,'c3a00000-0000-4000-9000-000000000030'));
select pg_temp.expect_state($$select public.admin_save_partial_cancel_switch(false,null,5,'c3a00000-0000-4000-9000-000000000031')$$,'PT409');
reset role;
select 1/case when (select r.result=e.result from switch_results r,switch_results e where r.name='partial_replay' and e.name='partial_on')
  and private.order_partial_cancel_enabled()
  and (select not enabled and partial_cancel_enabled and partial_cancel_enabled_at is not null and revision=6
    and partial_cancel_evidence like 'TEST 토스%' from private.return_fee_deduction_settings where singleton)
  and (select result#>>'{partialCancel,enabled}'='true' and result#>>'{returnFee,enabled}'='false' from switch_results where name='partial_on')
  and (select count(*)=1 from public.audit_log where id='c3a00000-0000-4000-9000-000000000030' and action='admin.operations_switch.partial_cancel'
    and diff->'before'->>'enabled'='false')
  then 1 else 0 end as assert_partial_cancel_on_idempotent_and_gate_follows;

set local role authenticated;
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
insert into switch_results values('partial_off',public.admin_save_partial_cancel_switch(false,null,6,'c3a00000-0000-4000-9000-000000000032'));
reset role;
select 1/case when not private.order_partial_cancel_enabled()
  and (select partial_cancel_evidence like 'TEST 토스%' and revision=7 from private.return_fee_deduction_settings where singleton)
  then 1 else 0 end as assert_partial_cancel_off_closes_gate;

rollback;
