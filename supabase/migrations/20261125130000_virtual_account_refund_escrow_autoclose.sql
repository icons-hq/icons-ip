-- 가상계좌 은행 환불 감시 — 에스크로 구매자 취소 환불을 7일 뒤 시스템이 닫는다(ADR-0049 결정 5·6 보강, 2026-11-24).
--
-- 에스크로 결제의 취소 요청 수락(POST /v2/escrows/{id}/cancel)은 구매자가 취소 요청 때 토스에 등록한 계좌로 토스가 환불한다(상점에
-- 노출되지 않는다 — 부가 API '취소 요청 수락'). 그 뒤 결제 조회의 virtualAccount.refundStatus가 갱신되는지는 공식 문서(부가 API·
-- 에스크로 가이드, 2026-11-24 조회)에 없다. 갱신되지 않으면 NONE으로 남아 감시가 7일 뒤 지연(refund_overdue)으로 잘못 오르고, 운영자가
-- 토스 상점관리자를 확인해 '처리 완료'로 닫아야 했다(20261125110000의 남은 한계).
--
-- 이제 작업자(자동 재확인 cron)가 송금 상태가 NONE(또는 값 없음)인 에스크로 결제의 거래를 조회해 구매자 취소 수락(status CANCELED ·
-- cancelType CUSTOMER, 같은 결제)을 확인하면 p_escrow_buyer_canceled = true로 넘긴다. 그 상태로 환불 뒤 7일이 지나면 시스템이 감시를
-- 완료(completed_via 'escrow_buyer_cancel')로 닫고 감사 기록을 남긴다 — 운영 알림·시스템 상태 건수는 생기지 않는다.
--  - DB도 근거를 본다: 가상계좌 원장이 에스크로가 아니라고 기록한 결제(use_escrow = false)는 확인이 와도 닫지 않는다(값을 모르면
--    결제사 확인을 따른다 — 에스크로 작업과 같은 is distinct from false 규칙).
--  - 7일 전에는 닫지 않는다. 토스가 뒤늦게 송금을 추적해 PENDING·FAILED를 돌려주면 지금 판정(완료·실패·지연)을 그대로 따른다.
--  - 확인이 없으면(일반 결제 취소로 끝난 에스크로 TARGET_CANCELED, 에스크로 키 없음·거절, 에스크로가 아닌 결제, 거래 조회 실패) 지금처럼
--    지연으로 올린다. 이미 지연으로 오른 감시는 6시간마다 다시 보므로 뒤 회차에 확인되면 닫는다. 송금 실패(FAILED·PARTIAL_FAILED)·
--    기록 불일치로 오른 감시는 닫지 않는다.
--  - 다음 조회를 환불 뒤 7일 경계에 맞춘다 — 송금 확인 전 감시가 7일을 넘겨 시스템 상태에 '지연'으로 보이는 시간이 자동 재확인
--    한 회차(10분) 안으로 줄어든다. 구매자 취소가 확인된 NONE 감시는 하루 간격으로 본다(그 사이 바뀔 것이 거의 없다).
-- 함수 인자가 늘어 예전 3인자 함수를 지우고 다시 만든다. 새 인자는 기본값 null이라 배포 사이(migration 먼저) 돌던 예전 앱의 3인자
-- 호출도 그대로 받는다(확인 없음 = 지금 판정).

begin;

alter table private.virtual_account_refund_watches
  add column completed_via text,
  add constraint virtual_account_refund_watches_completed_via check (
    completed_via is null or (completed_via = 'escrow_buyer_cancel' and state = 'completed'));

comment on column private.virtual_account_refund_watches.completed_via is
  '완료 근거. null: 결제사가 송금 완료(COMPLETED)를 알림 / escrow_buyer_cancel: 에스크로 구매자 취소 수락 환불을 7일 뒤 시스템이 닫음.';

drop function public.service_record_virtual_account_refund_watch(uuid, text, text);

-- 작업자(service role): 조회 결과 기록. p_outcome: completed | pending | failed | mismatch | unavailable.
-- p_escrow_buyer_canceled: 송금 상태가 NONE(또는 값 없음)인 에스크로 결제에서 거래가 구매자 취소 수락으로 끝났음을 확인했으면 true,
-- 확인했는데 아니면 false, 확인하지 않았거나 못 했으면 null.
-- 실패(처음 한 번)는 운영 알림·감사 로그를 남긴다. 송금 확인 전이 7일을 넘으면 지연(refund_overdue)으로 실패와 같이 올린다 — 단
-- 에스크로 구매자 취소 환불로 확인된 NONE 감시는 시스템이 완료로 닫는다.
create function public.service_record_virtual_account_refund_watch(
  p_attempt_id uuid, p_outcome text, p_refund_status text, p_escrow_buyer_canceled boolean default null)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_watch private.virtual_account_refund_watches%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_failure text;
  v_overdue_at timestamptz;
  -- 토스가 이 환불의 은행 송금을 refundStatus로 알리지 않는다(NONE·값 없음).
  v_untracked boolean := coalesce(p_refund_status, 'NONE') = 'NONE';
begin
  if p_attempt_id is null or p_outcome is null or p_outcome not in ('completed', 'pending', 'failed', 'mismatch', 'unavailable')
    or (p_refund_status is not null and p_refund_status !~ '^[A-Z_]{1,32}$') then
    raise invalid_parameter_value using message = 'invalid_refund_watch_result';
  end if;
  select watch.* into v_watch from private.virtual_account_refund_watches as watch where watch.attempt_id = p_attempt_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_watch.state in ('completed', 'resolved') then
    return v_watch.state;
  end if;

  if p_outcome = 'completed' then
    update private.virtual_account_refund_watches
    set state = 'completed', refund_status = coalesce(p_refund_status, refund_status), completed_at = v_now, updated_at = v_now
    where attempt_id = p_attempt_id;
    if v_watch.state = 'failed' then
      insert into public.audit_log(actor_id, action, target, diff)
      values (null, 'system.order.virtual_account_refund_completed', 'order:' || v_watch.order_id::text,
        pg_catalog.jsonb_build_object('attemptId', p_attempt_id, 'after', v_watch.failure_code, 'actor', 'system'));
    end if;
    return 'completed';
  end if;

  if p_outcome = 'unavailable' then
    update private.virtual_account_refund_watches
    set next_check_at = v_now + interval '30 minutes', updated_at = v_now
    where attempt_id = p_attempt_id;
    return v_watch.state;
  end if;

  v_overdue_at := v_watch.refunded_at + interval '7 days';

  -- 에스크로 구매자 취소 환불: 토스가 송금 상태를 알리지 않은 채 7일이 지났다 — 시스템이 완료로 닫는다(지연으로 오른 감시 포함).
  if p_outcome = 'pending' and v_untracked and p_escrow_buyer_canceled is true and v_overdue_at <= v_now
    and (v_watch.state = 'pending' or v_watch.failure_code = 'refund_overdue')
    and exists (
      select 1 from private.payment_attempt_virtual_accounts as va
      where va.attempt_id = p_attempt_id and va.use_escrow is distinct from false) then
    update private.virtual_account_refund_watches
    set state = 'completed', completed_via = 'escrow_buyer_cancel', refund_status = coalesce(p_refund_status, refund_status),
        completed_at = v_now, updated_at = v_now
    where attempt_id = p_attempt_id;
    insert into public.audit_log(actor_id, action, target, diff)
    values (null, 'system.order.virtual_account_refund_escrow_settled', 'order:' || v_watch.order_id::text,
      pg_catalog.jsonb_build_object('attemptId', p_attempt_id, 'refundStatus', p_refund_status, 'fromState', v_watch.state,
        'before', v_watch.failure_code, 'basis', 'escrow_buyer_cancel',
        'useEscrow', (select va.use_escrow from private.payment_attempt_virtual_accounts as va where va.attempt_id = p_attempt_id),
        'actor', 'system'));
    return 'completed';
  end if;

  v_failure := case
    when p_outcome = 'failed' and p_refund_status = 'PARTIAL_FAILED' then 'refund_partial_failed'
    when p_outcome = 'failed' then 'refund_failed'
    when p_outcome = 'mismatch' then 'payment_mismatch'
    when v_overdue_at <= v_now then 'refund_overdue'
  end;

  if v_failure is null then
    -- 송금 확인 전(PENDING 등) — 2시간 뒤(구매자 취소가 확인된 NONE 감시는 하루 뒤) 다시 보되, 환불 뒤 7일 경계를 넘기지 않는다.
    update private.virtual_account_refund_watches
    set refund_status = coalesce(p_refund_status, refund_status),
        next_check_at = least(
          v_now + case when v_untracked and p_escrow_buyer_canceled is true then interval '1 day' else interval '2 hours' end,
          v_overdue_at),
        updated_at = v_now
    where attempt_id = p_attempt_id;
    return v_watch.state;
  end if;

  -- 이미 실패로 올린 감시가 송금 확인 전(재환불 진행 등)으로 읽히면 처음 실패 사유를 남긴다 — 구체적 사유(실패·불일치)만 덮어쓴다.
  update private.virtual_account_refund_watches
  set state = 'failed', refund_status = coalesce(p_refund_status, refund_status),
      failure_code = case when p_outcome = 'pending' and v_watch.state = 'failed' then coalesce(v_watch.failure_code, v_failure) else v_failure end,
      failed_at = coalesce(failed_at, v_now), next_check_at = v_now + interval '6 hours', updated_at = v_now
  where attempt_id = p_attempt_id;

  if v_watch.state <> 'failed' then
    insert into private.admin_operation_alerts(event_key, category, title, href)
    values ('virtual_account_refund_failed:' || p_attempt_id::text, 'orders',
      case v_failure when 'refund_overdue' then '가상계좌 환불 송금이 7일째 확인되지 않습니다 · 주문을 확인해주세요'
        when 'payment_mismatch' then '가상계좌 환불 결제사 기록이 맞지 않습니다 · 주문을 확인해주세요'
        else '가상계좌 환불 송금이 실패했습니다 · 주문을 확인해주세요' end,
      '/admin/sales/orders/' || v_watch.order_id::text)
    on conflict (event_key) do nothing;
    insert into public.audit_log(actor_id, action, target, diff)
    values (null, 'system.order.virtual_account_refund_failed', 'order:' || v_watch.order_id::text,
      pg_catalog.jsonb_build_object('attemptId', p_attempt_id, 'failureCode', v_failure, 'refundStatus', p_refund_status, 'actor', 'system'));
  end if;
  return 'failed';
end;
$function$;
revoke all on function public.service_record_virtual_account_refund_watch(uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.service_record_virtual_account_refund_watch(uuid, text, text, boolean) to service_role;

-- 주문 패널(운영자)에 완료 근거를 더한다(나머지는 20261125110000 그대로). 구매자 조회는 'refund'를 통째로 빼므로 바뀌지 않는다.
create or replace function private.order_virtual_account_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'bankCode', va.bank_code,
    'accountNumber', va.account_number,
    'dueAt', va.due_at,
    'amount', attempt.amount,
    'useEscrow', va.use_escrow,
    'state', case
      when attempt.state = 'approved' then 'deposited'
      when attempt.state = 'awaiting_deposit' and va.due_at > pg_catalog.clock_timestamp() then 'awaiting'
      when attempt.state in ('awaiting_deposit', 'confirming', 'unknown', 'needs_review') then 'checking'
      else 'closed'
    end,
    'escrow', (
      select pg_catalog.jsonb_build_object(
        'deliveryState', job.state,
        'escrowStatus', job.escrow_status,
        'lastErrorCode', job.last_error_code)
      from private.toss_escrow_deliveries as job where job.order_id = p_order_id),
    'refund', (
      -- 조회가 멈춰 송금 확인 전으로 7일이 지난 감시는 확인 필요(지연)로 보인다 — 시스템 상태·확인 목록·처리 완료와 같은 규칙이다.
      select pg_catalog.jsonb_build_object(
        'state', case when watch.state = 'pending' and watch.refunded_at <= pg_catalog.clock_timestamp() - interval '7 days'
          then 'failed' else watch.state end,
        'refundStatus', watch.refund_status,
        'failureCode', case when watch.state = 'pending' and watch.refunded_at <= pg_catalog.clock_timestamp() - interval '7 days'
          then coalesce(watch.failure_code, 'refund_overdue') else watch.failure_code end,
        'refundedAt', watch.refunded_at,
        'checkedAt', watch.last_checked_at,
        'failedAt', watch.failed_at,
        'resolvedAt', watch.resolved_at,
        'resolutionNote', watch.resolution_note,
        'completedVia', watch.completed_via)
      from private.virtual_account_refund_watches as watch where watch.attempt_id = va.attempt_id)
  )
  from private.payment_attempt_virtual_accounts as va
  join public.payment_attempts as attempt on attempt.id = va.attempt_id
  where va.order_id = p_order_id
  order by va.issued_at desc
  limit 1;
$function$;
revoke all on function private.order_virtual_account_json(uuid) from public, anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';
