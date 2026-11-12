-- 반품배송비 차감(QNA-033, ADR-0031) — 환불 원장·finalizer를 '원결제 전액'에서 '확정 환불액'으로.
--
-- 앞 migration(20261112223000)의 차감 결정을 환불 경로에 잇는다. 결정이 없으면(스위치가 꺼져 있었거나 단순 변심 반품이
-- 아니면) 모든 치환은 지금과 같은 값을 만든다 — 차감 0, 덧붙일 필드 '{}', 알림 문구 null → 기존 문구.
--
--  * 환불 접수(admin_record_order_claim_refund filed, 입고완료 → 처리중)가 차감을 결정하고 환불 원장 금액을 '결제액 − 차감액'으로 연다.
--  * 카드(토스): 오케스트레이터가 결정을 읽어 결제사 부분 취소를 발행하고, 취소 뒤 조회로 잔액을 확인하면
--    service_record_order_claim_partial_refund로 확인을 적는다(provider_confirmed). 결제사가 부분 취소를 받지 않는 결제면
--    service_fallback_order_claim_refund_deduction으로 전액 환불로 돌린 뒤(not_applied) 지금처럼 전액 취소한다.
--    finalizer는 부분 취소 확인 없이 차감이 남아 있으면 확정하지 않는다(refund_deduction_evidence_required).
--  * 무통장: 송금액(bank_transfer_claim_refunds.amount)이 '결제액 − 차감액'이다. 송금 대기 목록·송금 엑셀은 이 금액을 읽는다.
--  * 같은 요청에 차감을 결정하면 배송비 청구를 새로 만들 수 없다(이중 청구 방지).
begin;

-- 함수 본문 치환 도우미(이 migration 안에서만 쓰고 지운다). 앵커마다 정확히 한 번 나와야 한다.
create function private.t12a_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't12a patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 접수 전 단계에서 보이는 예상 차감(일괄 확인창의 환불 금액). 접수 뒤에는 환불 원장 금액이 진실원이다.
create function private.claim_refund_preview_deduction(p_claim_id uuid, p_payment_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select (view->>'deductionAmount')::bigint
    from (select private.claim_refund_deduction_view(p_claim_id) as view) source
    where (view->>'applicable')::boolean and view->>'paymentId' = p_payment_id::text), 0)::bigint;
$$;
revoke all on function private.claim_refund_preview_deduction(uuid, uuid) from public, anon, authenticated, service_role;

-- 1. 환불 접수·완료 기록: 접수 때 차감을 결정하고 원장 금액을 확정 환불액으로 연다. 감사·구매자 알림에 차감을 남긴다.
select private.t12a_patch_function('public.admin_record_order_claim_refund(uuid,text,text,text)'::regprocedure, array[
$a$      on conflict (order_id) do nothing;

      insert into public.refunds ($a$,
$a$      on conflict (order_id) do nothing;

      -- 반품배송비 차감(QNA-033, ADR-0031): 단순 변심 반품이고 스위치가 켜져 있으면 여기서 한 번 결정한다.
      -- 환불 원장 금액은 '결제액 − 차감액'으로 연다. 결정이 없으면 차감 0 — 지금과 같은 전액이다.
      perform private.record_return_fee_deduction(p_claim_id, v_actor);

      insert into public.refunds ($a$,
$a$        payment.id,
        payment.amount,
        v_claim.reason,$a$,
$a$        payment.id,
        payment.amount - private.claim_refund_active_deduction(payment.id),
        v_claim.reason,$a$,
$a$        reason = coalesce(public.refunds.reason, excluded.reason),
        status = case$a$,
$a$        reason = coalesce(public.refunds.reason, excluded.reason),
        amount = case
          when public.refunds.status <> 'done' and private.claim_refund_active_deduction(public.refunds.payment_id) > 0
            then excluded.amount
          else public.refunds.amount
        end,
        status = case$a$,
$a$        'from', v_claim.stage,
        'to', 'processing'
      )
    );$a$,
$a$        'from', v_claim.stage,
        'to', 'processing'
      ) || private.claim_refund_deduction_audit(p_claim_id)
    );$a$,
$a$      '환불 접수가 완료됐어요',
      case$a$,
$a$      '환불 접수가 완료됐어요',
      coalesce(private.claim_refund_deduction_notice(p_claim_id,
        case when p_method = 'bank_transfer' then 'filed_bank_transfer' else 'filed' end), case$a$,
$a$        else '결제사에 결제 취소를 접수했습니다. 카드사 처리 일정에 따라 반영 시점이 다를 수 있습니다.'
      end
    );$a$,
$a$        else '결제사에 결제 취소를 접수했습니다. 카드사 처리 일정에 따라 반영 시점이 다를 수 있습니다.'
      end)
    );$a$,
$a$      'refundRows', v_refund_count,
      'settlementNote', p_note
    )
  );$a$,
$a$      'refundRows', v_refund_count,
      'settlementNote', p_note
    ) || private.claim_refund_deduction_audit(p_claim_id)
  );$a$,
$a$    '환불이 완료됐어요',
    '환급 처리가 완료됐습니다. 결제수단에 따라 반영 시점이 다를 수 있습니다.'
  );$a$,
$a$    '환불이 완료됐어요',
    coalesce(private.claim_refund_deduction_notice(p_claim_id, 'completed'),
      '환급 처리가 완료됐습니다. 결제수단에 따라 반영 시점이 다를 수 있습니다.')
  );$a$
]);

-- 2. 카드 finalizer: 환불 원장 금액은 확정 환불액이다. 부분 취소 확인이 없는 차감이 남아 있으면 확정하지 않는다.
select private.t12a_patch_function('public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[])'::regprocedure, array[
$a$    payment.id,
    payment.amount,
    p_reason,
    'done'$a$,
$a$    payment.id,
    -- 확정 환불액(ADR-0031): 차감 결정이 없거나 전액 환불로 돌렸으면 결제액, 결제사 부분 취소를 확인했으면 '결제액 − 차감액'.
    private.claim_refund_settled_amount(payment.id),
    p_reason,
    'done'$a$,
$a$  update public.payments as payment
  set status = 'refunded'$a$,
$a$  update private.claim_refund_deductions as deduction
  set state = 'applied', applied_at = coalesce(deduction.applied_at, clock_timestamp())
  where deduction.order_id = p_order_id
    and deduction.state = 'provider_confirmed';

  update public.payments as payment
  set status = 'refunded'$a$
]);

-- 3. 취소 요청 완료: 감사에 차감을, 구매자 알림에 부분 취소 금액을 남긴다.
select private.t12a_patch_function('public.complete_order_cancellation_request(uuid,text[],uuid)'::regprocedure, array[
$a$      'providerRefundCount', v_provider_refund_count
    ) || case when p_actor_id is null$a$,
$a$      'providerRefundCount', v_provider_refund_count
    ) || private.claim_refund_deduction_audit(p_request_id) || case when p_actor_id is null$a$,
$a$      '결제 금액 전액을 결제사에서 취소했습니다. 카드사 처리 일정에 따라 환급 반영 시점이 다를 수 있습니다.'$a$,
$a$      coalesce(private.claim_refund_deduction_notice(p_request_id, 'provider_completed'),
        '결제 금액 전액을 결제사에서 취소했습니다. 카드사 처리 일정에 따라 환급 반영 시점이 다를 수 있습니다.')$a$
]);

-- 4. 무통장 finalizer: 송금액 = 결제액 − 차감액. 송금 완료 증빙으로 끝날 때 차감 결정을 확정한다.
select private.t12a_patch_function('private.finalize_bank_transfer_claim_refund(uuid,text)'::regprocedure, array[
$a$purchase.total<>lifecycle.amount then$a$,
$a$purchase.total-private.claim_refund_active_deduction(lifecycle.payment_id)<>lifecycle.amount then$a$,
$a$or payment.amount<>lifecycle.amount or payment.status not in('paid','refunded') then$a$,
$a$or payment.amount-private.claim_refund_active_deduction(payment.id)<>lifecycle.amount or payment.status not in('paid','refunded') then$a$,
$a$values(payment.id,payment.amount,p_reason,case when lifecycle.state='completed'$a$,
$a$values(payment.id,lifecycle.amount,p_reason,case when lifecycle.state='completed'$a$,
$a$ if lifecycle.state='completed' then update public.payments set status='refunded' where id=payment.id and status<>'refunded';end if;$a$,
$a$ if lifecycle.state='completed' then update private.claim_refund_deductions set state='applied',applied_at=coalesce(applied_at,clock_timestamp())
  where payment_id=payment.id and state='planned';end if;
 if lifecycle.state='completed' then update public.payments set status='refunded' where id=payment.id and status<>'refunded';end if;$a$
]);

select private.t12a_patch_function('private.bank_transfer_refund_blocker(public.order_cancellation_requests,public.orders,text)'::regprocedure, array[
$a$or refund.amount<>payment.amount$a$,
$a$or refund.amount<>payment.amount-private.claim_refund_active_deduction(payment.id)$a$,
$a$or lifecycle.amount<>payment.amount$a$,
$a$or lifecycle.amount<>payment.amount-private.claim_refund_active_deduction(payment.id)$a$
]);

select private.t12a_patch_function('public.admin_record_bank_transfer_refund(uuid,uuid,uuid,text,integer,integer,timestamp with time zone,text,text,boolean,uuid,uuid)'::regprocedure, array[
$a$values(claim.id,purchase.id,payment.id,purchase.user_id,payment.amount,'awaiting_transfer',$a$,
$a$values(claim.id,purchase.id,payment.id,purchase.user_id,payment.amount-private.claim_refund_active_deduction(payment.id),'awaiting_transfer',$a$,
$a$'revision',p_expected_revision,'resultRevision',result_revision));$a$,
$a$'revision',p_expected_revision,'resultRevision',result_revision)||private.claim_refund_deduction_audit(claim.id));$a$
]);

select private.t12a_patch_function('public.admin_bank_transfer_refund_context(uuid,uuid,uuid,uuid)'::regprocedure, array[
$a$'gift',exists(select 1 from private.gift_intents where order_id=purchase.id));$a$,
$a$'gift',exists(select 1 from private.gift_intents where order_id=purchase.id))||private.claim_refund_deduction_field(claim.id);$a$
]);

-- 5. 일괄 확인창(T11b): 환불 금액은 차감 뒤 금액이다(접수 전에는 판정, 접수 뒤에는 환불 원장).
select private.t12a_patch_function('private.order_claim_bulk_context_row(uuid)'::regprocedure, array[
$a$'refundAmount',case when pay.id is null then null else coalesce(ref.amount,pay.amount) end,$a$,
$a$'refundAmount',case when pay.id is null then null else coalesce(ref.amount,pay.amount-private.claim_refund_preview_deduction(c.id,pay.id)) end,$a$,
$a$'refundBlocker',blocker);$a$,
$a$'refundBlocker',blocker)||private.claim_refund_deduction_field(c.id);$a$
]);

-- 6. 운영 상세: 환불 단계가 차감·환불액을 보인다(없으면 필드를 싣지 않는다).
select private.t12a_patch_function('public.admin_order_claim_detail(uuid)'::regprocedure, array[
$a$  return result || jsonb_build_object('sellerIntake', private.seller_claim_intake_json(p_claim_id),'gift',private.gift_admin_claim_party(p_claim_id));$a$,
$a$  -- 반품배송비 차감(QNA-033): 결정 또는 접수 전 판정. 스위치가 꺼져 있고 결정이 없으면 덧붙이지 않는다.
  result := result || private.claim_refund_deduction_field(p_claim_id);
  return result || jsonb_build_object('sellerIntake', private.seller_claim_intake_json(p_claim_id),'gift',private.gift_admin_claim_party(p_claim_id));$a$
]);

-- 7. 배송비 청구: 차감을 결정한 요청에는 새 청구를 만들 수 없다(같은 반품배송비를 두 번 받지 않는다).
select private.t12a_patch_function('private.claim_fee_document(uuid,uuid,boolean)'::regprocedure, array[
$a$   and not exists(select 1 from private.claim_fee_invoices where claim_id=c.id and state in('unpaid','reported','paid')),$a$,
$a$   and not exists(select 1 from private.claim_fee_invoices where claim_id=c.id and state in('unpaid','reported','paid'))
   and not exists(select 1 from private.claim_refund_deductions d where d.claim_id=c.id and d.state in('planned','provider_confirmed','applied')),$a$
]);

-- 8. 오케스트레이터(service_role) 경로.
-- 8-1. 요청의 차감 결정(카드 부분 취소 대상). 없으면 null.
create function public.service_order_claim_refund_deduction(p_request_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('claimId', d.claim_id, 'paymentId', d.payment_id, 'provider', d.provider, 'state', d.state,
    'paymentAmount', d.payment_amount, 'deductionAmount', d.deduction_amount, 'refundAmount', d.refund_amount)
  from private.claim_refund_deductions d where d.claim_id = p_request_id;
$$;
revoke all on function public.service_order_claim_refund_deduction(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_order_claim_refund_deduction(uuid) to service_role;

-- 8-2. 결제사 부분 취소를 조회로 확인한 결과를 적는다. 같은 확인의 재전송은 같은 결과다.
create function public.service_record_order_claim_partial_refund(p_request_id uuid, p_payment_id uuid, p_refunded_amount bigint,
  p_provider_payment_key text, p_provider_transaction_key text, p_actor_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare claim public.order_cancellation_requests; pay public.payments; d private.claim_refund_deductions;
begin
  if p_actor_id is not null and not private.can_finish_operator_cancellation(p_request_id, p_actor_id) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_refunded_amount is null or p_refunded_amount <= 0 or p_provider_payment_key is null
    or (p_provider_transaction_key is not null and p_provider_transaction_key !~ '^[\x21-\x7e]{1,64}$') then
    raise invalid_parameter_value using message = 'refund_deduction_evidence_invalid';
  end if;
  select * into claim from public.order_cancellation_requests where id = p_request_id;
  if not found then raise no_data_found using message = 'cancellation_request_not_found'; end if;
  perform id from public.orders where id = claim.order_id for update;
  select * into claim from public.order_cancellation_requests where id = p_request_id for update;
  if p_actor_id is null and claim.claim_type <> 'cancel' then
    raise insufficient_privilege using message = 'staff required';
  end if;
  select * into pay from public.payments where id = p_payment_id and purpose = 'order' and ref_id = claim.order_id for update;
  select * into d from private.claim_refund_deductions where claim_id = p_request_id for update;
  if d.claim_id is null or pay.id is null or d.payment_id <> pay.id or pay.provider <> 'toss' then
    raise check_violation using message = 'refund_deduction_not_found';
  end if;
  if pay.payment_key is distinct from p_provider_payment_key or p_refunded_amount <> d.refund_amount then
    raise check_violation using message = 'refund_deduction_evidence_mismatch';
  end if;
  if d.state in ('provider_confirmed', 'applied') then return d.state; end if;
  if d.state <> 'planned' or claim.status not in ('processing', 'needs_review') then
    raise check_violation using message = 'refund_deduction_not_planned';
  end if;
  update private.claim_refund_deductions set state = 'provider_confirmed', provider_confirmed_at = clock_timestamp(),
    provider_transaction_key = p_provider_transaction_key where claim_id = p_request_id;
  insert into public.audit_log(actor_id, action, target, diff)
  values (p_actor_id, case when p_actor_id is null then 'system.order.claim_refund_deduction_confirmed' else 'admin.order.claim_refund_deduction_confirmed' end,
    'order:' || claim.order_id::text,
    jsonb_build_object('claimId', p_request_id, 'paymentId', pay.id, 'refundedAmount', p_refunded_amount,
      'deductionAmount', d.deduction_amount, 'paymentAmount', d.payment_amount));
  return 'provider_confirmed';
end $$;
revoke all on function public.service_record_order_claim_partial_refund(uuid, uuid, bigint, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_record_order_claim_partial_refund(uuid, uuid, bigint, text, text, uuid) to service_role;

-- 8-3. 결제사가 부분 취소를 받지 않는 결제(조회로 확인, 돈이 움직이기 전)는 차감하지 않고 전액 환불로 돌린다.
--      결제사 부분 취소를 이미 확인한 결정은 되돌리지 않는다.
create function public.service_fallback_order_claim_refund_deduction(p_request_id uuid, p_payment_id uuid, p_actor_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare claim public.order_cancellation_requests; pay public.payments; d private.claim_refund_deductions;
begin
  if p_actor_id is not null and not private.can_finish_operator_cancellation(p_request_id, p_actor_id) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  select * into claim from public.order_cancellation_requests where id = p_request_id;
  if not found then raise no_data_found using message = 'cancellation_request_not_found'; end if;
  perform id from public.orders where id = claim.order_id for update;
  select * into claim from public.order_cancellation_requests where id = p_request_id for update;
  if p_actor_id is null and claim.claim_type <> 'cancel' then
    raise insufficient_privilege using message = 'staff required';
  end if;
  select * into pay from public.payments where id = p_payment_id and purpose = 'order' and ref_id = claim.order_id for update;
  perform r.id from public.refunds r where r.payment_id = p_payment_id for update;
  select * into d from private.claim_refund_deductions where claim_id = p_request_id for update;
  if d.claim_id is null or pay.id is null or d.payment_id <> pay.id or pay.provider <> 'toss' then
    raise check_violation using message = 'refund_deduction_not_found';
  end if;
  if d.state = 'not_applied' then return d.state; end if;
  if d.state <> 'planned' then raise check_violation using message = 'refund_deduction_already_confirmed'; end if;
  update private.claim_refund_deductions set state = 'not_applied', not_applied_reason = 'partial_cancel_unavailable',
    not_applied_at = clock_timestamp() where claim_id = p_request_id;
  update public.refunds set amount = pay.amount where payment_id = pay.id and status <> 'done';
  insert into public.audit_log(actor_id, action, target, diff)
  values (p_actor_id, case when p_actor_id is null then 'system.order.claim_refund_deduction_not_applied' else 'admin.order.claim_refund_deduction_not_applied' end,
    'order:' || claim.order_id::text,
    jsonb_build_object('claimId', p_request_id, 'paymentId', pay.id, 'reason', 'partial_cancel_unavailable',
      'deductionAmount', d.deduction_amount, 'refundAmount', pay.amount));
  return 'not_applied';
end $$;
revoke all on function public.service_fallback_order_claim_refund_deduction(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_fallback_order_claim_refund_deduction(uuid, uuid, uuid) to service_role;

select private.register_operator_rpc_contract('public.service_record_order_claim_partial_refund(uuid,uuid,bigint,text,text,uuid)'::regprocedure, 'sales.manage', 'service_finish', false);
select private.register_operator_rpc_contract('public.service_fallback_order_claim_refund_deduction(uuid,uuid,uuid)'::regprocedure, 'sales.manage', 'service_finish', false);

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'public.admin_record_order_claim_refund(uuid,text,text,text)'::regprocedure,
    'public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[])'::regprocedure,
    'public.complete_order_cancellation_request(uuid,text[],uuid)'::regprocedure,
    'private.finalize_bank_transfer_claim_refund(uuid,text)'::regprocedure,
    'private.bank_transfer_refund_blocker(public.order_cancellation_requests,public.orders,text)'::regprocedure,
    'public.admin_record_bank_transfer_refund(uuid,uuid,uuid,text,integer,integer,timestamp with time zone,text,text,boolean,uuid,uuid)'::regprocedure,
    'public.admin_bank_transfer_refund_context(uuid,uuid,uuid,uuid)'::regprocedure,
    'private.order_claim_bulk_context_row(uuid)'::regprocedure,
    'public.admin_order_claim_detail(uuid)'::regprocedure,
    'private.claim_fee_document(uuid,uuid,boolean)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.t12a_patch_function(regprocedure, text[]);

commit;
notify pgrst, 'reload schema';
