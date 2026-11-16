-- ============================================================================
-- 무통장 잔액 0원 뒤 전체 취소를 송금 원장에 남긴다(2026-11-16, 원장 재작업 알려진 후속 2).
--
-- 재고 부족 부분 취소들이 무통장 결제액을 모두 돌려준 뒤(잔액 0원) 남은 품목(전액 할인)을 취소하면, 취소 확정은
-- 송금 대기 없이 환불 0원으로 닫히지만(ADR-0032) 송금 원장(private.bank_transfer_claim_refunds)에는 아무것도 남지 않았다.
--  · 운영자가 적은 취소 확정 근거(확인 일시·증빙·메모·운영자)가 원장·법정 증빙(bank_transfer_refund_legal_proof)에 없었다.
--  · 어드민 무통장 환불 칸은 확정 뒤에도 '취소 확정 전'·'결제 불가'로 읽혔고, 확정 전에는 주문 금액을 '환불 전액'으로,
--    확정 안내를 '환불은 송금대기로 남습니다'로 보여 이미 돌려준 금액을 다시 송금할 위험이 있었다.
--
-- 바꾸는 것
--  1. 송금 원장이 '송금 없이 완료(0원)' 행을 받는다: amount = 0이면 state = completed이고 송금 칸(transfer_*)은 모두 비어 있어야 한다.
--     금액이 있는 행의 규칙(송금 대기 → 송금 증빙으로 완료)은 그대로다.
--  2. admin_record_bank_transfer_refund의 잔액 0원 확정 분기가 확정 근거로 그 행을 남긴다. 송금 대기 목록(state = awaiting_transfer)에는 나오지 않는다.
--  3. admin_bank_transfer_refund_context가 앞선 부분 취소가 있을 때만 partialRefund { refundedAmount, refundAmount }를 싣는다.
--     refundAmount는 송금 원장에 들어갈 금액(결제액 − 부분 취소 환불 − 반품배송비 차감, 0 이상)과 같다. 부분 취소가 없으면 지금 모양 그대로다.
--  4. 취소 확정 감사 기록에 송금할 금액(transferAmount)을 함께 남긴다(amount는 지금처럼 결제액).
--
-- 부분 취소 스위치는 운영에서 꺼져 있어(2026-11-13 확인) 이미 닫힌 0원 건이 없으므로 되채움은 하지 않는다.
-- 기존 함수는 pg_get_functiondef 앵커 치환으로만 고친다(앵커가 1회가 아니면 migration을 멈춘다). 끝에서 운영자 계약을 다시 등록한다.
-- ============================================================================
begin;

alter table private.bank_transfer_claim_refunds drop constraint bank_transfer_claim_refunds_amount_check;
alter table private.bank_transfer_claim_refunds add constraint bank_transfer_claim_refunds_amount_check
  check (amount > 0 or amount = 0 and state = 'completed');
alter table private.bank_transfer_claim_refunds drop constraint bank_transfer_claim_refunds_check;
alter table private.bank_transfer_claim_refunds add constraint bank_transfer_claim_refunds_check check (
  (state = 'awaiting_transfer' and transfer_operation_id is null and transferred_by is null and transferred_at is null
    and transfer_evidence is null and transfer_note is null)
  or (state = 'completed' and amount > 0 and transfer_operation_id is not null and transferred_by is not null and transferred_at is not null
    and transfer_evidence is not null and transfer_note is not null
    and char_length(transfer_evidence) between 2 and 300 and char_length(transfer_note) between 2 and 300)
  -- 송금 없이 완료(0원): 앞선 부분 취소들이 결제액을 모두 돌려줘 송금할 돈이 없다. 송금 증빙을 지어내지 않는다.
  or (state = 'completed' and amount = 0 and transfer_operation_id is null and transferred_by is null and transferred_at is null
    and transfer_evidence is null and transfer_note is null));

create function private.zero_refund_ledger_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 'zero refund ledger patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 2·4. 잔액 0원 확정이 확정 근거를 송금 원장에 남기고, 확정 감사에 송금할 금액을 싣는다.
select private.zero_refund_ledger_patch_function('public.admin_record_bank_transfer_refund(uuid,uuid,uuid,text,integer,integer,timestamp with time zone,text,text,boolean,uuid,uuid)'::regprocedure, array[
$a$  perform public.complete_order_cancellation_request(claim.id,array[payment.payment_key],p_expected_actor_id);
  perform public.admin_record_order_claim_refund(claim.id,'bank_transfer','completed',p_note);
 elsif p_kind='confirm_cancellation' then$a$,
$a$  perform public.complete_order_cancellation_request(claim.id,array[payment.payment_key],p_expected_actor_id);
  perform public.admin_record_order_claim_refund(claim.id,'bank_transfer','completed',p_note);
  -- 송금할 돈이 없어도 취소 확정 근거는 송금 원장에 '송금 없이 완료(0원)'로 남긴다(송금 대기 목록에는 나오지 않는다).
  insert into private.bank_transfer_claim_refunds(claim_id,order_id,payment_id,payer_id,amount,state,confirmation_operation_id,
   confirmed_by,confirmed_at,confirmation_evidence,confirmation_note)
  values(claim.id,purchase.id,payment.id,purchase.user_id,0,'completed',p_operation_id,
   p_expected_actor_id,p_occurred_at,p_evidence,p_note);
 elsif p_kind='confirm_cancellation' then$a$,
$a$'resultRevision',result_revision)||private.claim_refund_deduction_audit(claim.id));$a$,
$a$'resultRevision',result_revision)
  ||case when p_kind='confirm_cancellation' then jsonb_build_object('transferAmount',(select l.amount from private.bank_transfer_claim_refunds l where l.claim_id=claim.id)) else '{}'::jsonb end
  ||private.claim_refund_deduction_audit(claim.id));$a$
]);

-- 3. 무통장 환불 칸 문맥: 앞선 부분 취소가 있으면 이미 돌려준 금액과 송금할 환불액을 싣는다.
select private.zero_refund_ledger_patch_function('public.admin_bank_transfer_refund_context(uuid,uuid,uuid,uuid)'::regprocedure, array[
$a$'gift',exists(select 1 from private.gift_intents where order_id=purchase.id))||private.claim_refund_deduction_field(claim.id);$a$,
$a$'gift',exists(select 1 from private.gift_intents where order_id=purchase.id))||private.claim_refund_deduction_field(claim.id)
  ||case when coalesce(private.payment_partial_refunded_amount(payment.id),0)>0 then jsonb_build_object('partialRefund',jsonb_build_object(
    'refundedAmount',private.payment_partial_refunded_amount(payment.id),
    'refundAmount',greatest(payment.amount-private.claim_refund_active_deduction(payment.id),0))) else '{}'::jsonb end;$a$
]);

drop function private.zero_refund_ledger_patch_function(regprocedure, text[]);

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'public.admin_record_bank_transfer_refund(uuid,uuid,uuid,text,integer,integer,timestamp with time zone,text,text,boolean,uuid,uuid)'::regprocedure,
    'public.admin_bank_transfer_refund_context(uuid,uuid,uuid,uuid)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    else raise exception 'contract missing for %', fn;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
