-- 10/14 회의 A5: 품목별 쿠폰·적립금 배분 후 금액을 주문 상세·상품주문별 화면·엑셀에 표시한다.
-- 배분 규칙은 앱의 공통 함수(lib/admin/item-allocation.ts, 거래확정 엑셀과 같은 규칙) 하나다.
-- 이 RPC는 그 계산에 필요한 주문 당시 기록만 돌려준다 — 계산 버전, 주문 쿠폰·적립금·복수구매 합계,
-- 버전 1 주문의 첫 적용 쿠폰(대상·대상 품목 합계), 품목의 단가·수량·당시 정가와 버전 2 배분 원장.
-- 현재 상품가·쿠폰 정의는 읽지 않는다. 읽기 전용이며 주문 상세와 같은 sales.read 권한이다.
begin;

create function public.admin_order_item_allocation_inputs(p_order_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_operator_capability('sales.read',false);
  if p_order_ids is null or cardinality(p_order_ids) not between 1 and 1000 or array_position(p_order_ids,null) is not null then
    raise invalid_parameter_value using message='invalid_order_allocation_ids';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'orderId',o.id,'calculationVersion',o.calculation_version,
      'couponDiscount',o.discount_total,'storeCredits',o.store_credit_total,'volumeDiscount',o.volume_discount_total,
      'coupon',(select jsonb_build_object('discountAmount',r.discount_amount,'eligibleSubtotal',r.eligible_subtotal,'terms',r.terms_snapshot)
        from public.coupon_redemptions r where r.order_id=o.id and r.status='applied' and r.benefit_kind='goods' and o.calculation_version=1
        order by r.application_index limit 1),
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'goodId',i.good_id,'qty',i.qty,'unitPrice',i.unit_price,
          'regularUnitPrice',i.regular_unit_price_snapshot,
          'allocation',case when a.order_item_id is null then null else jsonb_build_object('volumeDiscount',a.volume_discount,
            'couponDiscount',a.coupon_discount,'storeCreditDiscount',a.store_credit_discount,'paidGoodsTotal',a.paid_goods_total) end)
          order by i.id)
        from public.order_items i
        left join private.order_price_allocations a on a.order_item_id=i.id and a.order_id=o.id
        where i.order_id=o.id),'[]'::jsonb)
    ) order by o.id),'[]'::jsonb)
    from public.orders o where o.id=any(p_order_ids)
  );
end $$;

revoke all on function public.admin_order_item_allocation_inputs(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_item_allocation_inputs(uuid[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_order_item_allocation_inputs(uuid[])'::regprocedure,'sales.read','read',false);

commit;
notify pgrst,'reload schema';
