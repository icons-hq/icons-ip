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

-- 재고 대조: 출고 대기 수량은 살아 있는 수량이다. 부분 취소의 복원은 별도 감사 액션(order.option_stock_partially_restored)이라
-- '취소·환불 복원'(order.option_stock_restored)으로 세지 않는다(창고를 떠난 적 없는 수량이라 출고 대기에서 이미 빠졌다).
select private.t12b_patch_function('private.stock_reconcile_flows(uuid[],timestamp with time zone)'::regprocedure, array[
$a$select oi.id as item_id,oi.order_id,oi.qty::bigint as qty,m.holder_id,$a$,
$a$select oi.id as item_id,oi.order_id,(oi.qty-private.order_item_partially_canceled_qty(oi.id))::bigint as qty,m.holder_id,$a$
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
        -(select c.gross_amount from private.order_item_partial_cancel_totals(item.id) c)) as revenue$a$,
-- 모두 취소된 굿즈만 있으면 순위에서 뺀다(수량 0 줄을 만들지 않는다).
$a$    group by item.good_id
    order by revenue desc, qty desc, item.good_id$a$,
$a$    group by item.good_id having sum(private.order_item_active_qty(item.id)) > 0
    order by revenue desc, qty desc, item.good_id$a$
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

-- 11. 반품·교환: 회수 완료 판정은 회수 수량을 살아 있는 수량과 맞춘다(회수 스냅샷은 부분 취소로 줄어든 배송 건 품목 수량이다).
select private.t12b_patch_function('private.claim_collections_complete(uuid)'::regprocedure, array[
$a$where x.claim_id=c.id and (j->>'orderItemId')::uuid=i.id),0)<>i.qty))$a$,
$a$where x.claim_id=c.id and (j->>'orderItemId')::uuid=i.id),0)<>private.order_item_active_qty(i.id)))$a$
]);

-- 교환 재출고는 살아 있는 수량만 보낸다(배송된 수량). 묶음 재출고는 모두 취소된 품목을 넣지 않는다.
-- T14a(20261113000100)의 collection_waiver_partially_received 앵커(회수 생략 줄)와 겹치지 않게 item.qty 주변만 바꾼다.
select private.t12b_patch_function('private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure, array[
$a$selected_variant,variant.name,variant.code,item.qty,record_id);$a$,
$a$selected_variant,variant.name,variant.code,private.order_item_active_qty(item.id),record_id);$a$,
$a$'variantName',choice.variant_name,'variantCode',choice.variant_code,'qty',item.qty));$a$,
$a$'variantName',choice.variant_name,'variantCode',choice.variant_code,'qty',private.order_item_active_qty(item.id)));$a$
]);

select private.t12b_patch_function('private.record_group_claim_reshipment(uuid,text,text,jsonb)'::regprocedure, array[
$a$ for item in select * from public.order_items where order_id=claim.order_id order by good_id,id loop$a$,
$a$ for item in select * from public.order_items where order_id=claim.order_id and private.order_item_active_qty(id)>0 order by good_id,id loop$a$,
$a$'variantName',choice.variant_name,'variantCode',choice.variant_code,'qty',item.qty));$a$,
$a$'variantName',choice.variant_name,'variantCode',choice.variant_code,'qty',private.order_item_active_qty(item.id)));$a$
]);

-- 클레임 상세의 주문 품목은 살아 있는 수량이고, 모두 취소된 품목은 보이지 않는다.
select private.t12b_patch_function('private.admin_order_claim_detail_before_operational_fee(uuid)'::regprocedure, array[
$a$            'qty', item.qty,$a$,
$a$            'qty', private.order_item_active_qty(item.id),$a$,
$a$          from public.order_items as item
          where item.order_id = orders.id
        ), '[]'::jsonb)$a$,
$a$          from public.order_items as item
          where item.order_id = orders.id and private.order_item_active_qty(item.id) > 0
        ), '[]'::jsonb)$a$
]);

-- 12. 회원 누적 구매 한도는 취소된 수량을 세지 않는다(품절로 일부 취소된 고객이 다시 살 수 있게).
select private.t12b_patch_function('private.member_goods_reserved_qty(uuid,text)'::regprocedure, array[
$a$  select coalesce(sum(item.qty::bigint),0)
  from public.order_items item join public.orders orders on orders.id=item.order_id$a$,
$a$  select coalesce(sum(private.order_item_active_qty(item.id)::bigint),0)
  from public.order_items item join public.orders orders on orders.id=item.order_id$a$
]);

select private.t12b_patch_function('private.member_variant_reserved_qty(uuid,uuid)'::regprocedure, array[
$a$  select coalesce(sum(item.qty::bigint),0)::bigint$a$,
$a$  select coalesce(sum(private.order_item_active_qty(item.id)::bigint),0)::bigint$a$
]);

-- 판매 분석: 굿즈 순위·시간대 보고·홈 랭킹은 매출 보고와 같이 부분 취소 몫을 뺀다. 구매 고객 세그먼트는 모두 취소된 품목을 구매로 세지 않는다.
select private.t12b_patch_function('public.admin_sales_goods_page(timestamp with time zone,timestamp with time zone,text,integer,integer)'::regprocedure, array[
$a$      sum(item.qty) as qty,$a$,
$a$      sum(private.order_item_active_qty(item.id)) as qty,$a$,
$a$where allocation.order_item_id=item.id),0)) as revenue$a$,
$a$where allocation.order_item_id=item.id),0)
        -(select c.gross_amount from private.order_item_partial_cancel_totals(item.id) c)) as revenue$a$,
-- 모두 취소된 굿즈만 있으면 순위에서 뺀다(수량 0 줄을 만들지 않는다).
$a$    group by item.good_id
  ), totals as ($a$,
$a$    group by item.good_id having sum(private.order_item_active_qty(item.id)) > 0
  ), totals as ($a$
]);

select private.t12b_patch_function('public.admin_sales_hourly_report(date,text,timestamp with time zone)'::regprocedure, array[
$a$    select r.side,r.day_starts_at,r.ends_at,o.id,o.total,o.created_at$a$,
$a$    select r.side,r.day_starts_at,r.ends_at,o.id,o.total-private.order_partial_refunded_amount(o.id) as total,o.created_at$a$,
$a$max(item.good_ip_id_snapshot) as ip_id,sum(item.qty) as qty,$a$,
$a$max(item.good_ip_id_snapshot) as ip_id,sum(private.order_item_active_qty(item.id)) as qty,$a$,
$a$where allocation.order_item_id=item.id),0)) as revenue$a$,
$a$where allocation.order_item_id=item.id),0)
      -(select c.gross_amount from private.order_item_partial_cancel_totals(item.id) c)) as revenue$a$,
-- 모두 취소된 굿즈만 있으면 순위에서 뺀다(수량 0 줄을 만들지 않는다).
$a$    group by w.period,s.side,item.good_id
  ), ranked as ($a$,
$a$    group by w.period,s.side,item.good_id having sum(private.order_item_active_qty(item.id)) > 0
  ), ranked as ($a$
]);

select private.t12b_patch_function('public.get_home_sales_rankings()'::regprocedure, array[
$a$    select period,item.good_id,sum(item.qty::bigint) quantity$a$,
$a$    select period,item.good_id,sum(private.order_item_active_qty(item.id)::bigint) quantity$a$
]);

select private.t12b_patch_function('private.customer_segment_members(jsonb,timestamp with time zone)'::regprocedure, array[
$a$exists(select 1 from public.order_items i join scope_goods g on g.id=i.good_id where i.order_id=o.id)))$a$,
$a$exists(select 1 from public.order_items i join scope_goods g on g.id=i.good_id where i.order_id=o.id and private.order_item_active_qty(i.id)>0)))$a$,
$a$item.qty>0
    and item.created_at<=p_at and (days is null or item.created_at>=p_at-make_interval(days=>days))
    and not exists(select 1 from valid_orders o join public.order_items i on i.order_id=o.id where o.user_id=c.id and i.good_id=item.good_id and o.created_at>=item.created_at))$a$,
$a$item.qty>0
    and item.created_at<=p_at and (days is null or item.created_at>=p_at-make_interval(days=>days))
    and not exists(select 1 from valid_orders o join public.order_items i on i.order_id=o.id where o.user_id=c.id and i.good_id=item.good_id and o.created_at>=item.created_at
      and private.order_item_active_qty(i.id)>0))$a$,
$a$where item.user_id=c.id
    and item.created_at<=p_at and (days is null or item.created_at>=p_at-make_interval(days=>days))
    and not exists(select 1 from valid_orders o join public.order_items i on i.order_id=o.id where o.user_id=c.id and i.good_id=item.good_id and o.created_at>=item.created_at))$a$,
$a$where item.user_id=c.id
    and item.created_at<=p_at and (days is null or item.created_at>=p_at-make_interval(days=>days))
    and not exists(select 1 from valid_orders o join public.order_items i on i.order_id=o.id where o.user_id=c.id and i.good_id=item.good_id and o.created_at>=item.created_at
      and private.order_item_active_qty(i.id)>0))$a$
]);

-- 13. 거래확정 엑셀(수집 함수)·주문 품목 조회: 부분 취소가 있을 때만 취소 수량·남은 수량·부분 취소 몫을 덧붙인다.
select private.t12b_patch_function('private.collect_settled_export_for_search(date,date,text,text,text)'::regprocedure, array[
$a$    'shippingCollectFee',s.shipping_collect_fee,'collectState',(select obligation.state from private.shipping_collect_obligations obligation where obligation.shipment_id=s.id)
   ) order by s.id)$a$,
$a$    'shippingCollectFee',s.shipping_collect_fee,'collectState',(select obligation.state from private.shipping_collect_obligations obligation where obligation.shipment_id=s.id)
   ) || case when private.shipment_closed_by_partial_cancel(s.id) then jsonb_build_object('closedByPartialCancel', true) else '{}'::jsonb end order by s.id)$a$,
$a$    'erpCode',identity.erp_code,'erpName',identity.erp_name,'barcode',identity.barcode,'erpCapturedAt',identity.captured_at
   ) order by assignment.shipment_id nulls last,item.id)$a$,
$a$    'erpCode',identity.erp_code,'erpName',identity.erp_name,'barcode',identity.barcode,'erpCapturedAt',identity.captured_at
   ) || private.order_item_partial_cancel_report_fields(item.id) order by assignment.shipment_id nulls last,item.id)$a$,
$a$    where item.order_id=o.id),'[]')
  ) order by o.created_at desc,o.id desc)$a$,
$a$    where item.order_id=o.id),'[]')
  ) || private.order_partial_cancel_report_fields(o.id) order by o.created_at desc,o.id desc)$a$
]);

select private.t12b_patch_function('public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)'::regprocedure, array[
$a$   i.qty,i.unit_price,i.qty::bigint*i.unit_price::bigint amount,$a$,
$a$   private.order_item_active_qty(i.id) qty,i.unit_price,private.order_item_active_qty(i.id)::bigint*i.unit_price::bigint amount,$a$,
$a$'stage',claim.stage) end) document$a$,
$a$'stage',claim.stage) end) || private.order_item_partial_cancel_console_fields(i.id) document$a$
]);

-- 14. 환불 송금 대기 목록(T03): 무통장 부분 취소의 송금 대기를 같은 줄 순서(대기 시작 시각)로 합친다. 없으면 지금과 같다.
select private.t12b_patch_function('public.admin_list_bank_transfer_refunds_numbered(integer,integer)'::regprocedure, array[
$a$ select count(*) into total from private.bank_transfer_claim_refunds where state='awaiting_transfer';$a$,
$a$ select count(*)+(select count(*) from private.order_partial_cancellations where provider='bank_transfer' and state='awaiting_transfer')
  into total from private.bank_transfer_claim_refunds where state='awaiting_transfer';$a$,
$a$  where lifecycle.state='awaiting_transfer' order by lifecycle.confirmed_at,lifecycle.claim_id limit p_limit offset p_offset$a$,
$a$  where lifecycle.state='awaiting_transfer'
  union all
  select head.applied_at,head.id,jsonb_build_object('kind','partial_cancellation','partialCancellationId',head.id,'orderId',purchase.id,
   'orderNumber',purchase.order_number,'sequence',head.sequence,'amount',head.refund_amount,'confirmedAt',head.applied_at,'filedAt',head.filed_at,
   'updatedAt',head.updated_at,'gift',exists(select 1 from private.gift_intents g where g.order_id=purchase.id),'payerName',payer.nickname) row_data
  from private.order_partial_cancellations head join public.orders purchase on purchase.id=head.order_id
  left join public.profiles payer on payer.id=purchase.user_id
  where head.provider='bank_transfer' and head.state='awaiting_transfer'
  order by 1,2 limit p_limit offset p_offset$a$
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
    'private.account_deletion_blockers(uuid)'::regprocedure,
    'private.claim_collections_complete(uuid)'::regprocedure,
    'private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure,
    'private.record_group_claim_reshipment(uuid,text,text,jsonb)'::regprocedure,
    'private.admin_order_claim_detail_before_operational_fee(uuid)'::regprocedure,
    'private.member_goods_reserved_qty(uuid,text)'::regprocedure,
    'private.member_variant_reserved_qty(uuid,uuid)'::regprocedure,
    'public.admin_sales_goods_page(timestamp with time zone,timestamp with time zone,text,integer,integer)'::regprocedure,
    'public.admin_sales_hourly_report(date,text,timestamp with time zone)'::regprocedure,
    'public.get_home_sales_rankings()'::regprocedure,
    'private.customer_segment_members(jsonb,timestamp with time zone)'::regprocedure,
    'private.collect_settled_export_for_search(date,date,text,text,text)'::regprocedure,
    'public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)'::regprocedure,
    'public.admin_list_bank_transfer_refunds_numbered(integer,integer)'::regprocedure] loop
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
