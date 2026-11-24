-- ==========================================================================
-- ICONS · 자동 발주확인 — 가상계좌 주문은 입금 확인 뒤 1시간이 지나야 대상이다 (ADR-0025 보강, ADR-0049 결정 4)
--
-- 일부 은행(특히 신한)은 실제로 입금되지 않았는데 입금 통보(DONE)를 먼저 보내고, 1~2초에서 2분 남짓 뒤에 취소
-- 통보(WAITING_FOR_DEPOSIT)를 보낸다(토스 「가상계좌(무통장입금) 총정리」). 그 사이 자동 발주확인이 돌면 주문이
-- 발주확인되고, 운영자가 언제든 내보내는 출고지시 파일로 창고에 넘어갈 수 있다. 창고에 넘어간 뒤의 되돌림은 출고 보류가
-- 운송장 등록만 막을 뿐 물건을 붙잡지 못한다. 그래서 자동 발주확인은 가상계좌 주문을 마지막 입금 확인 뒤 1시간이
-- 지나야 확정한다.
--   · 마지막 입금 확인 = 결제완료 시각(order_paid_marks)과, 재입금 확인으로 풀린 입금 되돌림 출고 보류
--     (reason deposit_reversed · release_kind deposit_confirmed)의 해제 시각 중 늦은 쪽. 재입금도 다시 되돌아갈 수 있다.
--   · 판정 기준은 실행의 마감 시각(run.cutoff_at)이다. 묶음이 여러 틱에 걸쳐도 같은 결론이 나온다. 마감 1시간 전보다
--     늦게 입금된 가상계좌 주문은 신규주문에 남고 실행 기록에 'deposit_settling'으로 남으며 다음 날 실행이 다시 본다.
--     정확히 1시간 전 입금은 대상이다.
--   · 카드·계좌이체·무통장 입금(법인계좌)은 그대로다. 운영자의 직접 발주확인도 막지 않는다(운영자 판단).
--
-- 실행 함수는 현재 정의(pg_get_functiondef)에서 제외 판정 호출 두 곳(잠금 전·잠금 뒤)만 바꾼다(개수가 다르면 실패).
-- 바꾼 함수는 모두 운영자 계약 레지스트리 밖이다.
-- ==========================================================================

begin;

-- 1. 가상계좌로 결제된 주문의 마지막 입금 확인 시각. 가상계좌 결제가 아니면 null이다.
--    주문당 굿즈 결제 시도는 하나다(payment_attempts_one_goods_order_idx). 가상계좌 판정은 계좌 원장 행 또는 승인 증거의
--    결제수단('가상계좌')이다 — 발급 콜백이 입금 대기 확정 전에 실패하고 구매자가 바로 입금하면 재정합이 처음 본 DONE을 일반
--    승인 finalizer로 확정해 계좌 원장 행이 생기지 않는다(lib/payments/toss-gateway.server.ts settleDonePayment).
create function private.order_virtual_account_deposit_confirmed_at(p_order_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $function$
  select case when exists (
      select 1
      from public.payment_attempts as attempt
      where attempt.purpose = 'order' and attempt.ref_id = p_order_id and attempt.state = 'approved'
        and (
          exists (select 1 from private.payment_attempt_virtual_accounts as account where account.attempt_id = attempt.id)
          or exists (
            select 1 from private.payment_provider_evidence as evidence
            where evidence.payment_attempt_id = attempt.id and evidence.payment_method = '가상계좌')))
    then greatest(
      (select mark.paid_at from private.order_paid_marks as mark where mark.order_id = p_order_id),
      (select pg_catalog.max(hold.released_at) from private.order_fulfillment_holds as hold
        where hold.order_id = p_order_id and hold.reason = 'deposit_reversed' and hold.release_kind = 'deposit_confirmed'))
  end;
$function$;
revoke all on function private.order_virtual_account_deposit_confirmed_at(uuid) from public, anon, authenticated, service_role;

-- 2. 실행의 제외 판정. 기존 사유(취소 요청·출고 보류·예약 입고 전)가 먼저고, 그다음이 가상계좌 입금 직후다.
create function private.auto_order_confirmation_run_blocker(p_order_id uuid, p_cutoff_at timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    private.auto_order_confirmation_blocker(p_order_id),
    case when private.order_virtual_account_deposit_confirmed_at(p_order_id) > p_cutoff_at - interval '1 hour'
      then 'deposit_settling' end);
$function$;
revoke all on function private.auto_order_confirmation_run_blocker(uuid, timestamptz) from public, anon, authenticated, service_role;

-- 3. 실행 기록의 새 사유.
alter table private.auto_order_confirmation_outcomes drop constraint auto_order_confirmation_outcomes_outcome_check;
alter table private.auto_order_confirmation_outcomes add constraint auto_order_confirmation_outcomes_outcome_check
  check (outcome in ('confirmed', 'cancellation_in_progress', 'fulfillment_hold', 'preorder_unallocated', 'deposit_settling',
    'status_changed', 'locked', 'failed'));

-- 4. 실행이 새 판정을 부른다(잠금 전 사전 판정과 잠금 뒤 재판정 두 곳).
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef('private.run_auto_order_confirmation(timestamptz,integer)'::regprocedure);
  v_anchor constant text := 'private.auto_order_confirmation_blocker(candidate.id)';
  v_found integer;
begin
  v_found := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, '')))
    / pg_catalog.length(v_anchor);
  if v_found <> 2 then
    raise exception 'auto_order_confirmation_anchor_changed: % matches, expected 2', v_found;
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, 'private.auto_order_confirmation_run_blocker(candidate.id,run.cutoff_at)');
end
$patch$;

commit;
