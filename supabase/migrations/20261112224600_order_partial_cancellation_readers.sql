-- 재고 부족 부분 취소(QNA-020, ADR-0032) — 기존 판정·출고·재고·환불·보고가 '적용된 부분 취소'를 읽게 한다.
--
-- 앞 migration(20261112224500)의 원장을 기존 함수에 잇는다. 부분 취소가 없으면(스위치가 꺼져 있었으면) 모든 치환은 지금과
-- 같은 값을 만든다 — 취소 수량 0, 부분 환불액 0, 처리 중 아님, 닫힌 배송 건 없음.
--  * 처리 중(결제사 확인 대기)인 부분 취소가 있으면 그 주문의 출고지시·묶음 출고·발송 상태 전이·다른 취소를 막는다.
--  * 품목의 '살아 있는 수량' = 주문 수량 − 적용된 부분 취소 수량. 배송 건 품목(order_shipment_items.qty)은 이 수량이다.
--    출고 파일·배송완료 판정·반품 접수 판정은 이 수량과 대조하고, 부분 취소로 닫힌 배송 건은 주문 상태 계산에서 뺀다.
--  * 뒤의 주문 전체 취소는 이미 복원한 수량을 빼고 남은 수량만 재고로 되돌린다. 환불 원장·결제사 취소는 남은 잔액이다
--    (오케스트레이터가 잔액 기대값으로 부분 취소, finalizer는 '결제액 − 부분 환불 − 차감').
--  * 반품배송비 차감(ADR-0031)은 남은 잔액을 기준으로 판정·차감한다.
--  * PG 정산 대사는 부분 취소 거래키를 그 부분 취소 금액과 맞춘다. 매출 보고·스토어 분석은 부분 취소 금액·수량을 뺀다.
--    적립 기준액은 취소된 굿즈 금액을 뺀다. 무통장 부분 취소 환불계좌는 클레임 환불계좌와 같은 일정으로 지운다.
--  * 결제사 확인·송금을 기다리는 부분 취소 환불은 계정 삭제를 막는 미결 환불이다.
begin;

create function private.t12b_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't12b patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 처리 중인 부분 취소가 있으면 출고·발송·다른 취소를 막는다.
select private.t12b_patch_function('private.assert_order_dispatch_allowed(uuid)'::regprocedure, array[
$a$    or exists(select 1 from public.order_cancellation_claims where order_id=target_order) then$a$,
$a$    or exists(select 1 from public.order_cancellation_claims where order_id=target_order)
    or private.order_partial_cancel_in_flight(target_order) then$a$
]);

select private.t12b_patch_function('private.admin_shipment_export_before_preorder(uuid[])'::regprocedure, array[
$a$ or exists(select 1 from public.order_cancellation_claims c join public.order_shipments s on s.order_id=c.order_id where s.id=any(target_ids)) then raise check_violation using message='order cancellation in progress';end if;$a$,
$a$ or exists(select 1 from public.order_cancellation_claims c join public.order_shipments s on s.order_id=c.order_id where s.id=any(target_ids))
 or exists(select 1 from public.order_shipments s where s.id=any(target_ids) and private.order_partial_cancel_in_flight(s.order_id)) then raise check_violation using message='order cancellation in progress';end if;$a$,
-- 줄 수량은 배송 건 품목 수량이다(부분 취소가 없으면 주문 수량과 같다).
$a$'qty',i.qty,'unitPrice',i.unit_price,$a$,
$a$'qty',link.qty,'unitPrice',i.unit_price,$a$
]);

select private.t12b_patch_function('public.admin_origin_pending_export_ids(uuid)'::regprocedure, array[
$a$   and not exists(select 1 from public.order_cancellation_claims c where c.order_id=o.id)$a$,
$a$   and not exists(select 1 from public.order_cancellation_claims c where c.order_id=o.id)
   and not private.order_partial_cancel_in_flight(o.id)$a$
]);

select private.t12b_patch_function('private.shipment_pack_ready(uuid)'::regprocedure, array[
$a$(a.order_id<>o.id or i.order_id<>o.id or a.qty<>i.qty))$a$,
$a$(a.order_id<>o.id or i.order_id<>o.id or a.qty<>private.order_item_active_qty(i.id)))$a$,
$a$  or exists(select 1 from public.order_cancellation_claims where order_id=o.id)$a$,
$a$  or exists(select 1 from public.order_cancellation_claims where order_id=o.id)
  or private.order_partial_cancel_in_flight(o.id)$a$
]);

select private.t12b_patch_function('public.guard_order_transition_during_cancellation()'::regprocedure, array[
$a$AS $function$
begin
$a$,
$a$AS $function$
begin
  -- 결제사 확인을 기다리는 재고 부족 부분 취소(ADR-0032)가 있으면 발송·배송완료로 넘어가지 않는다.
  if new.status is distinct from old.status and new.status in ('shipping', 'delivered', 'done')
    and private.order_partial_cancel_in_flight(old.id) then
    raise exception using errcode = '23514', message = 'order cancellation in progress';
  end if;
$a$
]);

select private.t12b_patch_function('private.order_cancel_eligible(uuid)'::regprocedure, array[
$a$ select private.order_cancel_eligible_before_digital(target_order) or exists($a$,
$a$ select not private.order_partial_cancel_in_flight(target_order) and (private.order_cancel_eligible_before_digital(target_order) or exists($a$,
$a$s.delivered_at is not null)));
$function$$a$,
$a$s.delivered_at is not null))));
$function$$a$
]);

-- 운영자 전액 취소: 처리 중인 부분 취소가 있으면 시작하지 않고, 환불 의도 금액은 남은 잔액이다.
select private.t12b_patch_function('public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure, array[
$a$    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) then
    raise check_violation using message = 'order_claim_in_progress';$a$,
$a$    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) or private.order_partial_cancel_in_flight(p_order_id) then
    raise check_violation using message = 'order_claim_in_progress';$a$,
$a$    payment.id,
    payment.amount,
    '운영자 전액 취소 · ' || v_reason_label,$a$,
$a$    payment.id,
    payment.amount - private.payment_partial_refunded_amount(payment.id),
    '운영자 전액 취소 · ' || v_reason_label,$a$
]);

select private.t12b_patch_function('private.request_order_claim_for_parties(uuid,uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure, array[
$a$      payment.id,
      payment.amount,
      p_reason,$a$,
$a$      payment.id,
      payment.amount - private.payment_partial_refunded_amount(payment.id),
      p_reason,$a$
]);

select private.t12b_patch_function('private.decide_order_claim(uuid,text,text)'::regprocedure, array[
$a$      payment.id,
      payment.amount,
      v_claim.reason,$a$,
$a$      payment.id,
      payment.amount - private.payment_partial_refunded_amount(payment.id),
      v_claim.reason,$a$
]);

select private.t12b_patch_function('public.admin_decide_order_cancellation(uuid,text,text)'::regprocedure, array[
$a$    payment.id,
    payment.amount,
    v_request.reason,$a$,
$a$    payment.id,
    payment.amount - private.payment_partial_refunded_amount(payment.id),
    v_request.reason,$a$
]);

-- 2. 살아 있는 수량. 배송완료·반품 접수·연락처 보존 판정은 배송 건 품목 수량을 주문 수량이 아니라 살아 있는 수량과 맞춘다.
select private.t12b_patch_function('private.order_all_items_delivered(uuid)'::regprocedure, array[
$a$link.order_item_id=i.id and link.order_id=i.order_id),0)<>i.qty)$a$,
$a$link.order_item_id=i.id and link.order_id=i.order_id),0)<>private.order_item_active_qty(i.id))$a$,
$a$s.status='delivered' and s.delivered_at is not null),0)<>i.qty)$a$,
$a$s.status='delivered' and s.delivered_at is not null),0)<>private.order_item_active_qty(i.id))$a$
]);

select private.t12b_patch_function('private.order_return_intake_eligible(uuid)'::regprocedure, array[
$a$and not exists(select 1 from public.order_shipments s where s.order_id=o.id and s.status='canceled')$a$,
$a$and not exists(select 1 from public.order_shipments s where s.order_id=o.id and s.status='canceled' and not private.shipment_closed_by_partial_cancel(s.id))$a$,
$a$s.status in ('ready','shipping','delivered')),0)<>i.qty)$a$,
$a$s.status in ('ready','shipping','delivered')),0)<>private.order_item_active_qty(i.id))$a$
]);

select private.t12b_patch_function('private.contact_order_obligations(uuid)'::regprocedure, array[
$a$s.shipped_at is not null and s.delivered_at is not null),0)<>i.qty)) then return 'operational_unknown';end if;$a$,
$a$s.shipped_at is not null and s.delivered_at is not null),0)<>private.order_item_active_qty(i.id))) then return 'operational_unknown';end if;$a$
]);

-- 부분 취소로 닫힌 배송 건(품목 없음, 취소)은 주문 발송·배송완료 상태 계산에서 뺀다.
select private.t12b_patch_function('private.derive_order_shipment_status(uuid)'::regprocedure, array[
$a$s.order_id=o.id and s.status<>'delivered') then 'delivered'::public.order_status$a$,
$a$s.order_id=o.id and s.status<>'delivered' and not private.shipment_closed_by_partial_cancel(s.id)) then 'delivered'::public.order_status$a$
]);

select private.t12b_patch_function('private.refresh_order_fulfillment(uuid)'::regprocedure, array[
$a$    into first_shipped,last_delivered from public.order_shipments where order_id=target_order;$a$,
$a$    into first_shipped,last_delivered from public.order_shipments where order_id=target_order and not private.shipment_closed_by_partial_cancel(id);$a$
]);

-- 3. 출고 파일: 줄 수량·금액은 남은 몫이다(부분 취소 누계를 뺀다).
select private.t12b_patch_function('public.admin_smartstore_shipment_export(uuid[])'::regprocedure, array[
$a$where link.shipment_id=any(p_ids) and link.qty<>item.qty$a$,
$a$where link.shipment_id=any(p_ids) and link.qty<>private.order_item_active_qty(item.id)$a$,
$a$'itemTotal',case when allocation.order_item_id is not null then allocation.paid_goods_total$a$,
$a$'itemTotal',case when allocation.order_item_id is not null then allocation.paid_goods_total-(select c.paid_amount from private.order_item_partial_cancel_totals(item.id) c)$a$,
$a$(item.regular_unit_price_snapshot-item.unit_price)::bigint*item.qty+allocation.volume_discount+allocation.coupon_discount+allocation.store_credit_discount$a$,
$a$(item.regular_unit_price_snapshot-item.unit_price)::bigint*private.order_item_active_qty(item.id)+allocation.volume_discount+allocation.coupon_discount+allocation.store_credit_discount
          -(select c.volume_discount+c.coupon_discount+c.store_credit_discount from private.order_item_partial_cancel_totals(item.id) c)$a$
]);

select private.t12b_patch_function('public.admin_delivery_list_export_lines(uuid[])'::regprocedure, array[
$a$where link.shipment_id=any(p_ids) and (link.qty<>item.qty or link.order_id<>item.order_id)) then$a$,
$a$where link.shipment_id=any(p_ids) and (link.qty<>private.order_item_active_qty(item.id) or link.order_id<>item.order_id)) then$a$,
$a$'itemTotal',case when allocation.order_item_id is not null then allocation.paid_goods_total$a$,
$a$'itemTotal',case when allocation.order_item_id is not null then allocation.paid_goods_total-(select c.paid_amount from private.order_item_partial_cancel_totals(item.id) c)$a$,
$a$(item.regular_unit_price_snapshot-item.unit_price)::bigint*item.qty+allocation.volume_discount+allocation.coupon_discount+allocation.store_credit_discount$a$,
$a$(item.regular_unit_price_snapshot-item.unit_price)::bigint*private.order_item_active_qty(item.id)+allocation.volume_discount+allocation.coupon_discount+allocation.store_credit_discount
          -(select c.volume_discount+c.coupon_discount+c.store_credit_discount from private.order_item_partial_cancel_totals(item.id) c)$a$
]);

-- 4. 재고: 주문 전체 취소의 복원은 부분 취소로 이미 복원한 수량을 빼고 남은 수량만 되돌린다.
select private.t12b_patch_function('private.restore_order_item_supply(uuid,text)'::regprocedure, array[
$a$ if not found then raise no_data_found using message='order_item_not_found';end if;$a$,
$a$ if not found then raise no_data_found using message='order_item_not_found';end if;
 -- 재고 부족 부분 취소(ADR-0032)로 이미 복원한 수량은 다시 복원하지 않는다. 부분 취소가 없으면 그대로 주문 수량이다.
 item.qty:=item.qty-private.order_item_partially_canceled_qty(item.id);
 if item.qty<=0 then return;end if;$a$
]);

-- 재고 대조: 출고 대기 수량은 살아 있는 수량이고, 부분 취소의 복원 기록은 '취소·환불 복원'(창고를 떠난 뒤 돌아옴)으로 세지 않는다
-- (창고를 떠난 적 없는 수량이라 출고 대기에서 이미 빠졌다).
select private.t12b_patch_function('private.stock_reconcile_flows(uuid[],timestamp with time zone)'::regprocedure, array[
$a$select oi.id as item_id,oi.order_id,oi.qty::bigint as qty,m.holder_id,$a$,
$a$select oi.id as item_id,oi.order_id,(oi.qty-private.order_item_partially_canceled_qty(oi.id))::bigint as qty,m.holder_id,$a$,
$a$and a.action='order.option_stock_restored'
      and a.diff->>'orderItemId'=u.item_id::text$a$,
$a$and a.action='order.option_stock_restored'
      and a.diff->>'orderItemId'=u.item_id::text and a.diff->>'partialCancellationId' is null$a$
]);

-- 5. 환불 금액: 뒤의 전액 취소·반품은 남은 잔액(결제액 − 부분 환불)을 돌려준다.
select private.t12b_patch_function('private.claim_refund_settled_amount(uuid)'::regprocedure, array[
$a$  select p.amount into amount from public.payments p where p.id = p_payment_id;$a$,
$a$  select p.amount into amount from public.payments p where p.id = p_payment_id;
  -- 재고 부족 부분 취소(ADR-0032)로 이미 돌려준 금액은 빼고 남은 잔액이 확정 환불액이다(차감 결정의 금액은 이미 잔액 기준).
  amount := amount - private.payment_partial_refunded_amount(p_payment_id);$a$
]);

-- 무통장·환불 접수 경로가 '결제액 − 이 값'으로 송금액·환불 원장 금액을 정한다. 반품배송비 차감에 부분 환불액을 더한다.
select private.t12b_patch_function('private.claim_refund_active_deduction(uuid)'::regprocedure, array[
$a$    where d.payment_id = p_payment_id and d.state in ('planned', 'provider_confirmed', 'applied')), 0)::bigint;$a$,
$a$    where d.payment_id = p_payment_id and d.state in ('planned', 'provider_confirmed', 'applied')), 0)::bigint
    -- 재고 부족 부분 취소(ADR-0032)로 이미 돌려준 금액도 이번 환불에서 빠진다.
    + private.payment_partial_refunded_amount(p_payment_id);$a$
]);

-- 반품배송비 차감은 남은 잔액 기준이다(결정의 payment_amount = 결정 때 잔액, refund_amount = 잔액 − 차감).
select private.t12b_patch_function('private.return_fee_deduction_plan(uuid)'::regprocedure, array[
$a$    when fee >= pay.amount then 'fee_exceeds_payment'$a$,
$a$    when fee >= pay.amount - private.payment_partial_refunded_amount(pay.id) then 'fee_exceeds_payment'$a$,
$a$    'paymentAmount', pay.amount,$a$,
$a$    'paymentAmount', pay.amount - private.payment_partial_refunded_amount(pay.id),$a$,
$a$    'refundAmount', case when reason is null then pay.amount - fee else pay.amount end,$a$,
$a$    'refundAmount', case when reason is null then pay.amount - private.payment_partial_refunded_amount(pay.id) - fee
      else pay.amount - private.payment_partial_refunded_amount(pay.id) end,$a$
]);

select private.t12b_patch_function('public.service_fallback_order_claim_refund_deduction(uuid,uuid,uuid)'::regprocedure, array[
$a$  update public.refunds set amount = pay.amount where payment_id = pay.id and status <> 'done';$a$,
$a$  update public.refunds set amount = pay.amount - private.payment_partial_refunded_amount(pay.id) where payment_id = pay.id and status <> 'done';$a$,
$a$      'deductionAmount', d.deduction_amount, 'refundAmount', pay.amount));$a$,
$a$      'deductionAmount', d.deduction_amount, 'refundAmount', pay.amount - private.payment_partial_refunded_amount(pay.id)));$a$
]);

select private.t12b_patch_function('private.order_claim_bulk_context_row(uuid)'::regprocedure, array[
$a$coalesce(ref.amount,pay.amount-private.claim_refund_preview_deduction(c.id,pay.id))$a$,
$a$coalesce(ref.amount,pay.amount-private.payment_partial_refunded_amount(pay.id)-private.claim_refund_preview_deduction(c.id,pay.id))$a$
]);

-- 6. PG 정산 대사: 결제사 취소 거래키가 적용된 부분 취소의 거래키면 그 부분 취소 금액과 맞춘다. 부분 취소 거래는 결제 전체 환불
--    원장(refunds, 결제당 한 줄)의 개수·합계 판정에서 뺀다. 부분 취소가 없으면 지금과 같다.
select private.t12b_patch_function('private.pg_settlement_match(jsonb)'::regprocedure, array[
$a$  if not exists(select 1 from private.payment_provider_evidence e where e.payment_attempt_id=a.id and e.evidence_kind='refund_approved'
   and e.provider_payment_key=p.payment_key and e.provider_transaction_id=p_record->>'transactionKey') then reason:='transaction_evidence_missing';$a$,
$a$  if exists(select 1 from private.order_partial_cancellations pc where pc.payment_id=p.id and pc.state='completed'
   and pc.provider_transaction_key=p_record->>'transactionKey') then
   if (p_record#>>'{cancel,cancelAmount}')::numeric<>(select pc.refund_amount from private.order_partial_cancellations pc
     where pc.payment_id=p.id and pc.state='completed' and pc.provider_transaction_key=p_record->>'transactionKey') then reason:='refund_amount_mismatch';end if;
  elsif not exists(select 1 from private.payment_provider_evidence e where e.payment_attempt_id=a.id and e.evidence_kind='refund_approved'
   and e.provider_payment_key=p.payment_key and e.provider_transaction_id=p_record->>'transactionKey') then reason:='transaction_evidence_missing';$a$,
$a$   if (select count(distinct provider_transaction_id) from private.payment_provider_evidence where payment_attempt_id=a.id and evidence_kind='refund_approved')<>1 then reason:='ambiguous_refund';$a$,
$a$   if (select count(distinct e2.provider_transaction_id) from private.payment_provider_evidence e2 where e2.payment_attempt_id=a.id and e2.evidence_kind='refund_approved'
     and not exists(select 1 from private.order_partial_cancellations pc where pc.payment_id=p.id
       and pc.provider_transaction_key=e2.provider_transaction_id))<>1 then reason:='ambiguous_refund';$a$
]);

-- 7. 매출 보고: 주문 매출은 결제액 − 부분 환불, 굿즈 순위의 수량·매출은 부분 취소 몫을 뺀다.
select private.t12b_patch_function('public.admin_sales_report(timestamp with time zone,timestamp with time zone,text)'::regprocedure, array[
$a$      orders.total,
      orders.payment_method,$a$,
$a$      orders.total - private.order_partial_refunded_amount(orders.id) as total,
      orders.payment_method,$a$,
$a$      sum(item.qty) as qty,$a$,
$a$      sum(private.order_item_active_qty(item.id)) as qty,$a$,
$a$where allocation.order_item_id=item.id),0)) as revenue$a$,
$a$where allocation.order_item_id=item.id),0)
        -(select c.gross_amount from private.order_item_partial_cancel_totals(item.id) c)) as revenue$a$
]);

select private.t12b_patch_function('private.store_analytics_paid_orders(timestamp with time zone,timestamp with time zone)'::regprocedure, array[
$a$coalesce((select sum(r.amount) from public.refunds r where r.payment_id=p.id and r.status='done'),0)::bigint$a$,
$a$(coalesce((select sum(r.amount) from public.refunds r where r.payment_id=p.id and r.status='done'),0)
  +private.payment_partial_refunded_amount(p.id))::bigint$a$
]);

-- 8. 구매 적립 기준액(결제액 − 배송비)에서 부분 취소된 굿즈 금액을 뺀다.
select private.t12b_patch_function('private.store_credit_order_transition()'::regprocedure, array[
$a$    basis:=greatest(0,new.total-new.shipping_fee);$a$,
$a$    basis:=greatest(0,new.total-new.shipping_fee-private.order_partial_canceled_goods_amount(new.id));$a$
]);

-- 9. 무통장 부분 취소 환불계좌 원문도 클레임 환불계좌와 같은 일정(송금 완료 30일 뒤)으로 지운다.
select private.t12b_patch_function('public.purge_expired_claim_refund_accounts()'::regprocedure, array[
$a$  get diagnostics v_count = row_count;
  return v_count;$a$,
$a$  get diagnostics v_count = row_count;
  with purged as (
    update private.order_partial_cancellation_refund_accounts as account
    set bank_name = null, account_number = null, account_holder = null, purged_at = now()
    where account.purged_at is null and account.purge_after is not null and account.purge_after <= now()
    returning 1
  ) select v_count + count(*) into v_count from purged;
  return v_count;$a$
]);

-- 10. 계정 삭제: 결제사 확인을 기다리거나 송금을 기다리는 부분 취소 환불은 미결 환불이다(ADR-0010의 미결 환불 차단과 같다).
select private.t12b_patch_function('private.account_deletion_blockers(uuid)'::regprocedure, array[
$a$      and refund.status in ('requested', 'failed', 'awaiting_transfer')
  ),$a$,
$a$      and refund.status in ('requested', 'failed', 'awaiting_transfer')
    union all
    select head.id::text as blocker_ref, payment.purpose
    from private.order_partial_cancellations as head
    join public.payments as payment on payment.id = head.payment_id
    where payment.user_id = p_user_id
      and head.state in ('processing', 'needs_review', 'awaiting_transfer')
  ),$a$
]);

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'private.assert_order_dispatch_allowed(uuid)'::regprocedure,
    'private.admin_shipment_export_before_preorder(uuid[])'::regprocedure,
    'public.admin_origin_pending_export_ids(uuid)'::regprocedure,
    'private.shipment_pack_ready(uuid)'::regprocedure,
    'public.guard_order_transition_during_cancellation()'::regprocedure,
    'private.order_cancel_eligible(uuid)'::regprocedure,
    'public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure,
    'private.request_order_claim_for_parties(uuid,uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure,
    'private.decide_order_claim(uuid,text,text)'::regprocedure,
    'public.admin_decide_order_cancellation(uuid,text,text)'::regprocedure,
    'private.order_all_items_delivered(uuid)'::regprocedure,
    'private.order_return_intake_eligible(uuid)'::regprocedure,
    'private.contact_order_obligations(uuid)'::regprocedure,
    'private.derive_order_shipment_status(uuid)'::regprocedure,
    'private.refresh_order_fulfillment(uuid)'::regprocedure,
    'public.admin_smartstore_shipment_export(uuid[])'::regprocedure,
    'public.admin_delivery_list_export_lines(uuid[])'::regprocedure,
    'private.restore_order_item_supply(uuid,text)'::regprocedure,
    'private.stock_reconcile_flows(uuid[],timestamp with time zone)'::regprocedure,
    'private.claim_refund_settled_amount(uuid)'::regprocedure,
    'private.claim_refund_active_deduction(uuid)'::regprocedure,
    'private.return_fee_deduction_plan(uuid)'::regprocedure,
    'public.service_fallback_order_claim_refund_deduction(uuid,uuid,uuid)'::regprocedure,
    'private.order_claim_bulk_context_row(uuid)'::regprocedure,
    'private.pg_settlement_match(jsonb)'::regprocedure,
    'public.admin_sales_report(timestamp with time zone,timestamp with time zone,text)'::regprocedure,
    'private.store_analytics_paid_orders(timestamp with time zone,timestamp with time zone)'::regprocedure,
    'private.store_credit_order_transition()'::regprocedure,
    'public.purge_expired_claim_refund_accounts()'::regprocedure,
    'private.account_deletion_blockers(uuid)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.t12b_patch_function(regprocedure, text[]);

commit;
notify pgrst, 'reload schema';
