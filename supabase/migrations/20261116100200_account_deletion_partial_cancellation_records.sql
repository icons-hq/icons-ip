-- ============================================================================
-- 계정 삭제 법정 기록에 얼린 버전 1 배분과 재고 부족 부분 취소 기록을 남긴다(2026-11-16, 원장 재작업 알려진 후속 3).
--
-- 전자상거래법상 계약·청약철회·대금결제 기록은 5년 보관한다. 계정 삭제 때 남기는 법정 기록(private.account_deletion_legal_snapshots)이
--  · 품목 배분을 버전 2 표(order_price_allocations)에서만 읽어, 첫 부분 취소 때 얼린 버전 1 배분(ADR-0032 보완)이 null로 남았고,
--  · 재고 부족 부분 취소 원장(order_partial_cancellations — 환불은 refunds가 아닌 이 원장에 있다)은 아예 담기지 않았다.
--
-- 바꾸는 것
--  1. 주문 기록의 품목 배분은 배분 원장 읽기(private.order_price_allocation_ledger = 버전 2 ∪ 얼린 버전 1)에서 읽는다.
--     얼린 버전 1이면 그 원장의 규칙 버전·입력 해시·얼린 시각·배송 건 선결제 배송비(allocationLedger)를 함께 남긴다. 없으면 null.
--  2. 새 기록 종류 order_partial_cancellation: 부분 취소마다 금액(결제 몫·배송비·적립금 되돌림)·품목·닫힌 배송 건·결제사 확인·송금 시각을
--     남긴다. 보존 정책(docs/account-deletion-retention-policy.md)대로 자유서술(고객 결정 요약·운영 메모·송금 증빙/메모)과 처리자 식별자,
--     환불계좌는 남기지 않는다(계좌는 별도 원장에서 30일 뒤 파기). 사유는 정규화 코드(reason_code)만 남긴다.
--     보관 기한은 부분 취소 시작 + 5년(ecommerce_transaction_v1), 삭제 흐름 재시도에도 기록은 하나다.
-- 기존 함수는 pg_get_functiondef 앵커 치환으로만 고친다(앵커가 1회가 아니면 migration을 멈춘다). 끝에서 내부 계약을 다시 등록한다.
-- ============================================================================
begin;

alter table private.account_deletion_legal_snapshots drop constraint account_deletion_legal_snapshots_record_type_check;
alter table private.account_deletion_legal_snapshots add constraint account_deletion_legal_snapshots_record_type_check check (record_type = any (array[
  'order_fulfillment', 'order_production', 'claim_fee', 'order', 'order_cancellation', 'shipment', 'payment', 'refund',
  'ticket_order', 'ticket_cancellation', 'ticket_check_in', 'subscription_contract', 'order_partial_cancellation']));

create function private.snapshot_order_partial_cancellations(p_deletion_event uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.account_deletion_legal_snapshots(deletion_event_id, record_type, record_ref, snapshot_data, legal_basis, retain_until)
  select p_deletion_event, 'order_partial_cancellation', c.id::text, jsonb_build_object(
      'partialCancellationRef', c.id, 'orderRef', c.order_id, 'paymentRef', c.payment_id, 'sequence', c.sequence,
      'provider', c.provider, 'state', c.state, 'reasonCode', c.reason_code,
      'warehouseStopConfirmed', c.warehouse_stop_confirmed, 'paymentAmount', c.payment_amount, 'balanceBefore', c.balance_before,
      'goodsRefundAmount', c.goods_refund_amount, 'shippingRefundAmount', c.shipping_refund_amount, 'refundAmount', c.refund_amount,
      'storeCreditRestoreAmount', c.store_credit_restore_amount,
      'items', coalesce((select jsonb_agg(jsonb_build_object('orderItemRef', i.order_item_id, 'qty', i.qty, 'grossAmount', i.gross_amount,
          'volumeDiscount', i.volume_discount, 'couponDiscount', i.coupon_discount, 'storeCreditDiscount', i.store_credit_discount,
          'goodsRefundAmount', i.goods_refund_amount) order by i.order_item_id)
        from private.order_partial_cancellation_items i where i.partial_cancellation_id = c.id), '[]'::jsonb),
      'closedShipments', coalesce((select jsonb_agg(jsonb_build_object('shipmentRef', s.shipment_id, 'shippingFeeRefund', s.shipping_fee_refund)
          order by s.shipment_id)
        from private.order_partial_cancellation_shipments s where s.partial_cancellation_id = c.id), '[]'::jsonb),
      'requestedAt', c.created_at, 'appliedAt', c.applied_at, 'providerConfirmedAt', c.provider_confirmed_at, 'completedAt', c.completed_at,
      'rejectedAt', c.rejected_at, 'filedAt', c.filed_at, 'resolution', c.resolution, 'resolvedAt', c.resolved_at,
      'transfer', case when c.transferred_at is null then null else jsonb_build_object('operationRef', c.transfer_operation_id,
        'transferredAt', c.transferred_at) end),
    'ecommerce_transaction_v1', c.created_at + interval '5 years'
  from private.order_partial_cancellations c
  join public.orders o on o.id = c.order_id
  where o.user_id = p_actor and c.created_at + interval '5 years' > clock_timestamp()
  on conflict (deletion_event_id, record_type, record_ref) do update
    set snapshot_data = excluded.snapshot_data,
      retain_until = greatest(private.account_deletion_legal_snapshots.retain_until, excluded.retain_until)
    where private.account_deletion_legal_snapshots.destroyed_at is null;
end $$;
revoke all on function private.snapshot_order_partial_cancellations(uuid, uuid) from public, anon, authenticated, service_role;

do $patch$
declare definition text; pair text[]; replacements text[][] := array[
  array[$old$from private.order_price_allocations a where a.order_item_id=item.id and a.order_id=order_record.id)$old$,
        $new$from private.order_price_allocation_ledger a where a.order_item_id=item.id and a.order_id=order_record.id)$new$],
  array[$old$'calculationVersion',order_record.calculation_version,'volumeDiscount',order_record.volume_discount_total,$old$,
        $new$'calculationVersion',order_record.calculation_version,
      'allocationLedger',(select jsonb_build_object('sourceCalculationVersion',h.source_calculation_version,'ruleVersion',h.rule_version,
       'inputHash',h.input_hash,'frozenAt',h.frozen_at,'paymentAmount',h.payment_amount,'paidGoodsTotal',h.paid_goods_total,'shippingTotal',h.shipping_total,
       'shipments',coalesce((select jsonb_agg(jsonb_build_object('shipmentRef',v.shipment_id,'prepaidShippingFee',v.prepaid_shipping_fee) order by v.shipment_id)
        from private.order_v1_shipment_allocations v where v.order_id=order_record.id),'[]'::jsonb))
       from private.order_v1_price_allocation_heads h where h.order_id=order_record.id),
      'volumeDiscount',order_record.volume_discount_total,$new$],
  array[$old$perform private.snapshot_order_fulfillment_contracts(p_deletion_event_id,p_user_id);$old$,
        $new$perform private.snapshot_order_fulfillment_contracts(p_deletion_event_id,p_user_id);
 perform private.snapshot_order_partial_cancellations(p_deletion_event_id,p_user_id);$new$]
];
begin
  definition := pg_get_functiondef('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
  foreach pair slice 1 in array replacements loop
    if (length(definition) - length(replace(definition, pair[1], ''))) / length(pair[1]) <> 1 then
      raise exception 'account_deletion_partial_cancellation_anchor_changed %', pair[1];
    end if;
    definition := replace(definition, pair[1], pair[2]);
  end loop;
  execute definition;
end $patch$;

select private.register_operator_internal_contract('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.snapshot_order_partial_cancellations(uuid,uuid)'::regprocedure);
commit;
