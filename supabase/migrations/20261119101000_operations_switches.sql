-- 운영 스위치 어드민 화면(원장 #21·#17 준비, 2026-11-19).
--
-- 세 스위치가 있는데 켜는 화면이 없고 런북이 "후속 migration SQL로 켜라"고만 한다.
--   · 주문 지연 안내 이메일(private.order_delay_notice_delivery_control.enabled): 꺼져 있으면 지연 안내 요청과
--     예약 주문 발송일 일괄 변경이 delay_notice_delivery_disabled로 거절된다(12/2 홍실 2차 예약 판매에 필요).
--   · 반품배송비 차감(private.return_fee_deduction_settings.enabled·one_way_amount·evidence)
--   · 재고 부족 부분 취소(같은 행의 partial_cancel_enabled·partial_cancel_evidence)
-- 이 migration은 스위치를 켜지 않는다 — 켜는 것은 정책·계약을 확인한 사람의 결정이다. 어드민 화면에서
-- 감사 기록과 함께 켜고 끌 수 있도록 읽기·저장 RPC만 더한다.
--
-- 권한: 읽기·저장 모두 통합·계정 주매니저(platform.manage, 권한 전환 전에는 기존 admin). 저장은 도메인 권한
-- sales.manage도 함께 요구한다. 감사: 저장은 항상 admin.operations_switch.* 행(작업 ID가 행 ID — 멱등)을 남긴다.
-- 반품배송비 행의 기존 감사 트리거(system.return_fee_deduction.settings_changed)는 SQL 편집기·migration 직접 변경을
-- 계속 잡고, 이 RPC가 바꿀 때는 같은 트랜잭션 표식으로 건너뛰어 한 변경이 두 줄로 남지 않게 한다.
begin;

create function private.o3a_patch_function(p_signature text, p_anchor text, p_replacement text)
returns void language plpgsql volatile set search_path = '' as $$
declare body text; found_count integer;
begin
  body := pg_get_functiondef(p_signature::regprocedure);
  found_count := (length(body) - length(replace(body, p_anchor, ''))) / length(p_anchor);
  if found_count <> 1 then raise exception 'o3a_anchor_changed: % (found %)', p_signature, found_count; end if;
  execute replace(body, p_anchor, p_replacement);
end $$;
revoke all on function private.o3a_patch_function(text, text, text) from public, anon, authenticated, service_role;

-- 1. 지연 안내 스위치 행: 리비전·근거·변경자 칸. 직접 변경(SQL 편집기)도 리비전을 올리고 감사 기록에 남긴다.
alter table private.order_delay_notice_delivery_control
  add column revision bigint not null default 1 check (revision > 0),
  add column evidence text check (evidence is null or (evidence = btrim(evidence) and char_length(evidence) between 2 and 500 and evidence !~ '[[:cntrl:]]')),
  add column updated_by uuid references public.profiles(id) on delete set null;

create function private.order_delay_notice_control_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise check_violation using message = 'order_delay_notice_delivery_control_required'; end if;
  if tg_when = 'BEFORE' then
    new.revision := old.revision + 1;
    new.changed_at := clock_timestamp();
    return new;
  end if;
  if current_setting('icons.operations_switch_tx', true) = txid_current()::text then return new; end if;
  insert into public.audit_log(actor_id, action, target, diff)
  values (null, 'system.order_delay_notice.delivery_changed', 'order_delay_notice_delivery_control',
    jsonb_build_object('before', to_jsonb(old) - 'singleton', 'after', to_jsonb(new) - 'singleton', 'sessionUser', session_user::text));
  return new;
end $$;
revoke all on function private.order_delay_notice_control_guard() from public, anon, authenticated, service_role;
create trigger order_delay_notice_control_revision before update on private.order_delay_notice_delivery_control
  for each row execute function private.order_delay_notice_control_guard();
create trigger order_delay_notice_control_audit after update on private.order_delay_notice_delivery_control
  for each row execute function private.order_delay_notice_control_guard();
create trigger order_delay_notice_control_keep before delete on private.order_delay_notice_delivery_control
  for each row execute function private.order_delay_notice_control_guard();

-- 2. 반품배송비·부분 취소 행: 변경자 칸, 그리고 이 RPC가 바꿀 때 기존 감사 트리거의 중복 줄을 건너뛴다.
alter table private.return_fee_deduction_settings
  add column updated_by uuid references public.profiles(id) on delete set null;

select private.o3a_patch_function('private.audit_return_fee_deduction_settings()',
  'insert into public.audit_log(actor_id, action, target, diff)',
  E'if current_setting(''icons.operations_switch_tx'', true) = txid_current()::text then return new; end if;\n  insert into public.audit_log(actor_id, action, target, diff)');

-- 3. 문서. 읽는 쪽이 한 번에 세 스위치를 본다.
create function private.operations_switches_document() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'delayNotice', (select jsonb_build_object('revision', d.revision, 'enabled', d.enabled, 'smsEnabled', d.sms_enabled,
        'evidence', d.evidence, 'changedAt', d.changed_at, 'updatedBy', (select p.nickname from public.profiles p where p.id = d.updated_by))
      from private.order_delay_notice_delivery_control d where d.singleton),
    'returnFee', (select jsonb_build_object('revision', r.revision, 'enabled', r.enabled, 'oneWayAmount', r.one_way_amount,
        'evidence', r.evidence, 'enabledAt', r.enabled_at, 'updatedAt', r.updated_at,
        'updatedBy', (select p.nickname from public.profiles p where p.id = r.updated_by))
      from private.return_fee_deduction_settings r where r.singleton),
    'partialCancel', (select jsonb_build_object('revision', r.revision, 'enabled', r.partial_cancel_enabled,
        'evidence', r.partial_cancel_evidence, 'enabledAt', r.partial_cancel_enabled_at, 'updatedAt', r.updated_at,
        'updatedBy', (select p.nickname from public.profiles p where p.id = r.updated_by))
      from private.return_fee_deduction_settings r where r.singleton));
$$;
revoke all on function private.operations_switches_document() from public, anon, authenticated, service_role;

-- volatile: 권한 가드를 부르는 읽기는 stable이면 PostgREST 읽기 전용 트랜잭션에서 25006(HTTP 405)으로 막힌다.
create function public.admin_get_operations_switches() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_operator_capability('platform.manage', true);
  return private.operations_switches_document();
end $$;
revoke all on function public.admin_get_operations_switches() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_operations_switches() to authenticated;

-- 4. 저장. 모두 같은 규칙: 작업 ID 멱등, 낡은 리비전은 PT409, 켤 때 근거 필수, 감사 한 줄.
create function public.admin_save_order_delay_notice_switch(p_enabled boolean, p_evidence text,
  p_expected_revision bigint, p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid; previous private.order_delay_notice_delivery_control; request jsonb; receipt jsonb;
begin
  actor := private.require_operator_capability('platform.manage', true);
  perform private.require_operator_capability('sales.manage', false);
  if p_enabled is null or p_expected_revision is null or p_expected_revision < 1 or p_operation_id is null
    or (p_evidence is not null and (p_evidence <> btrim(p_evidence) or char_length(p_evidence) not between 2 and 500 or p_evidence ~ '[[:cntrl:]]'))
    then raise invalid_parameter_value using message = 'invalid_operations_switch'; end if;
  if p_enabled and p_evidence is null then raise invalid_parameter_value using message = 'operations_switch_evidence_required'; end if;
  request := jsonb_build_object('enabled', p_enabled, 'evidence', p_evidence, 'expectedRevision', p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended('operations-switch-operation:' || p_operation_id::text, 0));
  receipt := private.operator_lifecycle_replay(actor, p_operation_id, 'admin.operations_switch.delay_notice', request);
  if receipt is not null then return receipt; end if;
  select * into previous from private.order_delay_notice_delivery_control where singleton for update;
  if not found then raise no_data_found using message = 'operations_switch_missing'; end if;
  if previous.revision <> p_expected_revision then raise sqlstate 'PT409' using message = 'operations_switch_changed'; end if;
  perform set_config('icons.operations_switch_tx', txid_current()::text, true);
  update private.order_delay_notice_delivery_control set enabled = p_enabled, evidence = coalesce(p_evidence, evidence), updated_by = actor
    where singleton;
  receipt := private.operations_switches_document();
  insert into public.audit_log(id, actor_id, action, target, diff) values (p_operation_id, actor, 'admin.operations_switch.delay_notice',
    'order_delay_notice_delivery_control', jsonb_build_object('request', request,
      'before', jsonb_build_object('enabled', previous.enabled, 'evidence', previous.evidence, 'revision', previous.revision), 'result', receipt));
  return receipt;
end $$;
revoke all on function public.admin_save_order_delay_notice_switch(boolean, text, bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_order_delay_notice_switch(boolean, text, bigint, uuid) to authenticated;

create function public.admin_save_return_fee_deduction_switch(p_enabled boolean, p_one_way_amount integer, p_evidence text,
  p_expected_revision integer, p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid; previous private.return_fee_deduction_settings; request jsonb; receipt jsonb;
begin
  actor := private.require_operator_capability('platform.manage', true);
  perform private.require_operator_capability('sales.manage', false);
  if p_enabled is null or p_expected_revision is null or p_expected_revision < 1 or p_operation_id is null
    or (p_one_way_amount is not null and p_one_way_amount not between 1 and 1000000)
    or (p_evidence is not null and (p_evidence <> btrim(p_evidence) or char_length(p_evidence) not between 2 and 1000 or p_evidence ~ '[[:cntrl:]]'))
    then raise invalid_parameter_value using message = 'invalid_operations_switch'; end if;
  if p_enabled and (p_one_way_amount is null or p_evidence is null) then raise invalid_parameter_value using message = 'operations_switch_evidence_required'; end if;
  request := jsonb_build_object('enabled', p_enabled, 'oneWayAmount', p_one_way_amount, 'evidence', p_evidence, 'expectedRevision', p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended('operations-switch-operation:' || p_operation_id::text, 0));
  receipt := private.operator_lifecycle_replay(actor, p_operation_id, 'admin.operations_switch.return_fee_deduction', request);
  if receipt is not null then return receipt; end if;
  select * into previous from private.return_fee_deduction_settings where singleton for update;
  if not found then raise no_data_found using message = 'operations_switch_missing'; end if;
  if previous.revision <> p_expected_revision then raise sqlstate 'PT409' using message = 'operations_switch_changed'; end if;
  perform set_config('icons.operations_switch_tx', txid_current()::text, true);
  update private.return_fee_deduction_settings set enabled = p_enabled, one_way_amount = coalesce(p_one_way_amount, one_way_amount),
    evidence = coalesce(p_evidence, evidence), updated_by = actor,
    enabled_at = case when p_enabled and not previous.enabled then clock_timestamp() else previous.enabled_at end
    where singleton;
  receipt := private.operations_switches_document();
  insert into public.audit_log(id, actor_id, action, target, diff) values (p_operation_id, actor, 'admin.operations_switch.return_fee_deduction',
    'return_fee_deduction_settings', jsonb_build_object('request', request,
      'before', jsonb_build_object('enabled', previous.enabled, 'oneWayAmount', previous.one_way_amount, 'evidence', previous.evidence,
        'revision', previous.revision), 'result', receipt));
  return receipt;
end $$;
revoke all on function public.admin_save_return_fee_deduction_switch(boolean, integer, text, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_return_fee_deduction_switch(boolean, integer, text, integer, uuid) to authenticated;

create function public.admin_save_partial_cancel_switch(p_enabled boolean, p_evidence text,
  p_expected_revision integer, p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid; previous private.return_fee_deduction_settings; request jsonb; receipt jsonb;
begin
  actor := private.require_operator_capability('platform.manage', true);
  perform private.require_operator_capability('sales.manage', false);
  if p_enabled is null or p_expected_revision is null or p_expected_revision < 1 or p_operation_id is null
    or (p_evidence is not null and (p_evidence <> btrim(p_evidence) or char_length(p_evidence) not between 2 and 1000 or p_evidence ~ '[[:cntrl:]]'))
    then raise invalid_parameter_value using message = 'invalid_operations_switch'; end if;
  if p_enabled and p_evidence is null then raise invalid_parameter_value using message = 'operations_switch_evidence_required'; end if;
  request := jsonb_build_object('enabled', p_enabled, 'evidence', p_evidence, 'expectedRevision', p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended('operations-switch-operation:' || p_operation_id::text, 0));
  receipt := private.operator_lifecycle_replay(actor, p_operation_id, 'admin.operations_switch.partial_cancel', request);
  if receipt is not null then return receipt; end if;
  select * into previous from private.return_fee_deduction_settings where singleton for update;
  if not found then raise no_data_found using message = 'operations_switch_missing'; end if;
  if previous.revision <> p_expected_revision then raise sqlstate 'PT409' using message = 'operations_switch_changed'; end if;
  perform set_config('icons.operations_switch_tx', txid_current()::text, true);
  update private.return_fee_deduction_settings set partial_cancel_enabled = p_enabled,
    partial_cancel_evidence = coalesce(p_evidence, partial_cancel_evidence), updated_by = actor,
    partial_cancel_enabled_at = case when p_enabled and not previous.partial_cancel_enabled then clock_timestamp() else previous.partial_cancel_enabled_at end
    where singleton;
  receipt := private.operations_switches_document();
  insert into public.audit_log(id, actor_id, action, target, diff) values (p_operation_id, actor, 'admin.operations_switch.partial_cancel',
    'return_fee_deduction_settings', jsonb_build_object('request', request,
      'before', jsonb_build_object('enabled', previous.partial_cancel_enabled, 'evidence', previous.partial_cancel_evidence,
        'revision', previous.revision), 'result', receipt));
  return receipt;
end $$;
revoke all on function public.admin_save_partial_cancel_switch(boolean, text, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_partial_cancel_switch(boolean, text, integer, uuid) to authenticated;

-- 5. 운영자 RPC 지문(ACL 확정 뒤). 고친 트리거 함수는 운영자 계약 대상이 아니다.
select private.register_operator_rpc_contract('public.admin_get_operations_switches()'::regprocedure, 'platform.manage', 'read', true);
select private.register_operator_rpc_contract('public.admin_save_order_delay_notice_switch(boolean,text,bigint,uuid)'::regprocedure, 'platform.manage', 'write', true);
select private.register_operator_rpc_contract('public.admin_save_return_fee_deduction_switch(boolean,integer,text,integer,uuid)'::regprocedure, 'platform.manage', 'write', true);
select private.register_operator_rpc_contract('public.admin_save_partial_cancel_switch(boolean,text,integer,uuid)'::regprocedure, 'platform.manage', 'write', true);

drop function private.o3a_patch_function(text, text, text);
commit;
