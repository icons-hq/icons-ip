-- ==========================================================================
-- ICONS · 입금된 토스 가상계좌(에스크로 아님)의 부분 취소·부분 반품·반품배송비 차감 — ADR-0049 결정 5 보강(2026-11-25)
--
-- 실운영 시나리오 SHP-129·VAC-046·VAC-047·CLM-118(2026-11-25 전수 조사): 가상계좌로 산 출고지 혼합 주문은 한쪽이 발송된 뒤 다른 쪽이
-- 품절이면 미발송 몫을 시스템 안에서 환불할 길이 없었다(운영자 전액 취소는 발송 뒤 막히고, 부분 취소·부분 반품은 가상계좌를 막았다).
-- 단순 변심 반품의 반품배송비도 차감하지 못하고 전액 환불했다.
--
-- 근거: 토스 결제 취소 가이드(/guides/v2/cancel-payment, 2026-11-25 확인) "가상계좌 입금 이후에는 부분 취소가 가능합니다" — 입금 뒤
-- 취소는 refundReceiveAccount(은행 코드·계좌번호·예금주)가 필수다. 2026-11-24 샌드박스에서 입금된 가상계좌 1,000원 부분 취소 뒤 잔액
-- 1,200원 취소가 refundReceiveAccount와 함께 성공했다(PARTIAL_CANCELED). 에스크로는 구매확정 전 부분 취소를 받지 않는다(에스크로 가이드).
--
-- 1. 판정 하나 private.toss_virtual_account_partial_cancel_ready(시도): 가상계좌 원장의 에스크로 선택이 false(결제 조회 useEscrow:false를
--    발급 때 남긴 값)이거나 작업자가 결제 조회로 에스크로가 아님을 확인했고(작업 skipped·거래 키 없음 — 계좌이체의
--    private.toss_transfer_confirmed_non_escrow와 같은 근거), 에스크로 작업이 그 밖의 상태로 남아 있지 않고, 입금 오류 되돌림이 열려 있지
--    않을 때만 참이다. 선택을 모르는 가상계좌(use_escrow null)·에스크로 결제는 지금처럼 막는다. 입금 전은 결제 원장이 paid가 아니라 원래 막힌다.
-- 2. 막는 판정 세 곳(부분 취소 private.order_partial_cancellation_blockers, 부분 반품 private.order_partial_return_order_blocker, 반품배송비
--    차감 private.return_fee_deduction_plan)의 가상계좌 조건이 이 판정을 쓴다. 부분 반품의 환급 계좌 입력 차단
--    (private.order_claim_virtual_account_refund_blocker)도 같은 판정으로 연다 — 부분 반품 환불도 결제사 부분 취소라 계좌가 필요하다.
-- 3. 은행 환불 감시: 가상계좌 부분 환불(토스 부분 취소 원장 completed)도 감시를 연다. 앞 환불의 감시가 끝났으면(completed·resolved) 새 환불로
--    다시 연다(전액 환불 트리거도 같다 — 부분 환불 뒤 남은 잔액 취소). 작업자에게 결제사에 남아야 할 잔액(expectedBalance)을 함께 준다 —
--    부분 환불 뒤면 PARTIAL_CANCELED·그 잔액이 맞는 상태다.
-- 앱(결제사 호출)은 같은 날 lib/payments/toss-gateway.server.ts가 결제 조회의 useEscrow를 다시 확인하고 refundReceiveAccount를 싣는다.
-- 기존 함수는 현재 정의(pg_get_functiondef)에서 앵커만 치환한다(앵커 개수가 다르면 실패).
-- ==========================================================================

begin;

create function private.va_partial_patch(p_function regprocedure, p_patches jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $helper$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_function);
  v_patch jsonb;
  v_found integer;
  v_expected integer;
begin
  for v_patch in select value from pg_catalog.jsonb_array_elements(p_patches) loop
    v_expected := coalesce((v_patch->>2)::integer, 1);
    v_found := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_patch->>0, '')))
      / pg_catalog.length(v_patch->>0);
    if v_found <> v_expected then
      raise exception 'va_partial_anchor_changed: % (% matches, expected %)', p_function, v_found, v_expected;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.va_partial_patch(regprocedure, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. 판정
-- ---------------------------------------------------------------------------
create function private.toss_virtual_account_partial_cancel_ready(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
      select 1 from private.payment_attempt_virtual_accounts as va
      where va.attempt_id = p_attempt_id
        and (va.use_escrow = false or private.toss_transfer_confirmed_non_escrow(p_attempt_id)))
    -- 에스크로 배송 등록 작업이 건너뜀(거래 키 없음) 밖의 상태로 있으면 에스크로 결제일 수 있다.
    and not exists (
      select 1 from private.toss_escrow_deliveries as job
      where job.attempt_id = p_attempt_id and (job.state <> 'skipped' or job.escrow_key is not null))
    -- 은행이 입금을 되돌린 결제는 돈이 없다(되돌림 처리가 끝날 때까지).
    and not exists (
      select 1 from private.virtual_account_deposit_reversals as reversal
      where reversal.attempt_id = p_attempt_id and reversal.state <> 'closed');
$function$;
revoke all on function private.toss_virtual_account_partial_cancel_ready(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. 막는 판정 세 곳 · 부분 반품 환급 계좌 입력
-- ---------------------------------------------------------------------------
select private.va_partial_patch('private.order_partial_cancellation_blockers(uuid)'::regprocedure,
  $p$[["(e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account' or (e.payment_method = '계좌이체' and not private.toss_transfer_confirmed_non_escrow(a.id)))", "(((e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account') and not private.toss_virtual_account_partial_cancel_ready(a.id)) or (e.payment_method = '계좌이체' and not private.toss_transfer_confirmed_non_escrow(a.id)))"]]$p$::jsonb);
select private.va_partial_patch('private.order_partial_return_order_blocker(uuid)'::regprocedure,
  $p$[["(e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account' or (e.payment_method = '계좌이체' and not private.toss_transfer_confirmed_non_escrow(a.id)))", "(((e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account') and not private.toss_virtual_account_partial_cancel_ready(a.id)) or (e.payment_method = '계좌이체' and not private.toss_transfer_confirmed_non_escrow(a.id)))"]]$p$::jsonb);
select private.va_partial_patch('private.return_fee_deduction_plan(uuid)'::regprocedure,
  $p$[["(e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account' or (e.payment_method = '계좌이체' and not private.toss_transfer_confirmed_non_escrow(a.id)))", "(((e.payment_method = '가상계좌' or e.result_code = 'DONE_virtual_account') and not private.toss_virtual_account_partial_cancel_ready(a.id)) or (e.payment_method = '계좌이체' and not private.toss_transfer_confirmed_non_escrow(a.id)))"]]$p$::jsonb);

select private.va_partial_patch(
  'private.order_claim_virtual_account_refund_blocker(public.order_cancellation_requests,public.orders)'::regprocedure,
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(
    $r$    -- 가상계좌는 부분 반품을 받지 않는다(부분 취소 불가). 지금 SQL 차단과 같은 판단이다.
    when private.claim_is_partial_return(p_claim.id) then 'refund_account_payment_unavailable'$r$,
    $r$    -- 부분 반품은 결제사 부분 취소라 에스크로가 아님이 확인된 입금 가상계좌만 받는다(20261126102000 — 부분 반품 판정과 같다).
    when private.claim_is_partial_return(p_claim.id) and not coalesce(private.toss_virtual_account_partial_cancel_ready(
        (private.order_toss_virtual_account_payment(p_order.id)->>'attemptId')::uuid), false)
      then 'refund_account_payment_unavailable'$r$)));

-- ---------------------------------------------------------------------------
-- 3. 은행 환불 감시 — 가상계좌 부분 환불도 감시하고, 끝난 감시는 새 환불로 다시 연다
-- ---------------------------------------------------------------------------
create function private.open_virtual_account_refund_watch(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into private.virtual_account_refund_watches as watch (attempt_id, order_id, payment_id, provider_payment_key)
  select attempt.id, payment.ref_id, payment.id, payment.payment_key
  from public.payments as payment
  join public.payment_attempts as attempt on attempt.payment_id = payment.id
  join private.payment_attempt_virtual_accounts as va
    on va.attempt_id = attempt.id and va.provider_payment_key = payment.payment_key
  where payment.id = p_payment_id and payment.purpose = 'order' and payment.provider = 'toss' and payment.payment_key is not null
    and payment.ref_id is not null and attempt.purpose = 'order' and attempt.provider = 'toss'
  on conflict (attempt_id) do update
  set state = 'pending', refund_status = null, failure_code = null, checks = 0, refunded_at = pg_catalog.clock_timestamp(),
      next_check_at = pg_catalog.clock_timestamp() + interval '30 minutes', last_checked_at = null, failed_at = null, completed_at = null,
      resolved_at = null, resolved_by = null, resolution_note = null, completed_via = null, updated_at = pg_catalog.clock_timestamp()
  -- 송금 확인 전·실패 감시는 그대로 둔다(실패는 운영자가 닫는다). 끝난 감시만 새 환불로 다시 연다.
  where watch.state in ('completed', 'resolved');
end;
$function$;
revoke all on function private.open_virtual_account_refund_watch(uuid) from public, anon, authenticated, service_role;

create function private.virtual_account_partial_refund_watch_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  begin
    perform private.open_virtual_account_refund_watch(new.payment_id);
  exception when others then
    raise warning 'virtual account partial refund watch failed for partial cancellation %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$;
revoke all on function private.virtual_account_partial_refund_watch_opened() from public, anon, authenticated, service_role;

-- 결제사 부분 취소를 확인해 적용한 원장(토스, 환불액 > 0)만 — 계좌 송금 부분 환불·0원은 결제사 송금이 없다.
create trigger order_partial_cancellations_virtual_account_refund_watch
after update of state on private.order_partial_cancellations
for each row
when (new.state = 'completed' and old.state is distinct from 'completed' and new.provider = 'toss' and new.refund_amount > 0)
execute function private.virtual_account_partial_refund_watch_opened();

-- 전액 환불(결제 원장 paid → refunded·canceled)도 앞 부분 환불의 끝난 감시를 다시 연다.
select private.va_partial_patch('private.virtual_account_refund_watch_opened()'::regprocedure, pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_array(
    '    on conflict (attempt_id) do nothing;',
    $r$    on conflict (attempt_id) do update
    set state = 'pending', refund_status = null, failure_code = null, checks = 0, refunded_at = pg_catalog.clock_timestamp(),
        next_check_at = pg_catalog.clock_timestamp() + interval '30 minutes', last_checked_at = null, failed_at = null, completed_at = null,
        resolved_at = null, resolved_by = null, resolution_note = null, completed_via = null, updated_at = pg_catalog.clock_timestamp()
    -- 가상계좌 부분 환불(20261126102000) 뒤 끝난 감시는 남은 잔액 환불로 다시 연다. 송금 확인 전·실패 감시는 그대로 둔다.
    where private.virtual_account_refund_watches.state in ('completed', 'resolved');$r$)));

-- 작업자에게 결제사에 남아야 할 잔액을 준다: 결제 원장이 아직 paid(부분 환불만 있었다)면 결제 금액 − 적용된 토스 부분 취소 합계, 아니면 0.
select private.va_partial_patch('public.service_claim_virtual_account_refund_watches(integer)'::regprocedure, pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_array(
    $a$'amount', attempt.amount$a$,
    $a$'amount', attempt.amount,
    'expectedBalance', coalesce((
      select case when payment.status = 'paid' and refunded.total > 0 then greatest(payment.amount - refunded.total, 0) else 0 end
      from public.payments as payment
      cross join lateral (
        select coalesce(sum(head.refund_amount), 0)::bigint as total
        from private.order_partial_cancellations as head
        where head.payment_id = payment.id and head.provider = 'toss' and head.applied_at is not null) as refunded
      where payment.id = leased.payment_id), 0)$a$)));

-- ---------------------------------------------------------------------------
-- 4. 운영자 계약 재등록(재정의한 함수)
-- ---------------------------------------------------------------------------
do $register$
declare
  v_function regprocedure;
  v_contract record;
begin
  foreach v_function in array array[
    'private.order_partial_cancellation_blockers(uuid)'::regprocedure,
    'private.order_partial_return_order_blocker(uuid)'::regprocedure,
    'private.return_fee_deduction_plan(uuid)'::regprocedure,
    'private.order_claim_virtual_account_refund_blocker(public.order_cancellation_requests,public.orders)'::regprocedure,
    'private.virtual_account_refund_watch_opened()'::regprocedure,
    'public.service_claim_virtual_account_refund_watches(integer)'::regprocedure
  ] loop
    select * into v_contract from private.operator_rpc_contracts as contract
    where contract.signature::regprocedure = v_function;
    if found then
      perform private.register_operator_rpc_contract(
        v_function, v_contract.capability, v_contract.guard_kind, v_contract.legacy_admin_only);
    end if;
    if exists (select 1 from private.operator_internal_contracts as contract where contract.signature::regprocedure = v_function) then
      perform private.register_operator_internal_contract(v_function);
    end if;
  end loop;
end;
$register$;

drop function private.va_partial_patch(regprocedure, jsonb);

commit;

notify pgrst, 'reload schema';
