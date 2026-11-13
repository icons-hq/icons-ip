-- 1014-084 물류 착불, 사용자 결정 2026-11-12 "착불 금액은 보이게 (Recommended)"(decisions.md 묶음 21)의 화면 쪽.
-- 이 결정은 출고지시 파일뿐 아니라 발송·배송현황 화면에도 적용한다(오케스트레이터 판단, 위임 원칙 ①: 결정 원문이
-- "물류 계정에도 착불 배송비·합포장 착불 합계·수납 방법은 보인다"로 파일에만 한정하지 않는다).
--
-- 발송·배송현황 목록이 배송 건별 착불 배송비와 착불 수납 정보(착불 수납 주체·수납 방법·고객 안내·착불 환급 문의)를 읽는 요약.
-- 값과 출처는 출고지시 파일(admin_smartstore_shipment_export·admin_shipment_export의 shippingCollectFee·collector,
-- 창고 양식 '배송 운영 안내' 시트)과 같다: 착불 배송비는 order_shipments.shipping_collect_fee, 수납 정보는 주문 영수증
-- (order_goods_transactions.original_receipt의 display.shipping)에서 그 배송 건 출고지 묶음의 collector다.
-- 합포장 착불 합계는 이미 admin_shipment_pack_summaries가 준다(20261112200100). 선결제 배송비·주문 총액·결제 정보는 담지 않는다.
-- 읽기 전용이다. 합포장 생성·해제와 착불 수납·환급 기록은 지금처럼 sales.manage다.
-- 가드는 출고 RPC와 같은 sales.dispatch(sales.manage가 함의)이고, 가드가 운영자 행을 잠그므로 VOLATILE이다(PostgREST 읽기·쓰기 트랜잭션).
begin;

create function public.admin_shipment_collect_summaries(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_operator_capability('sales.dispatch',false);
 if cardinality(p_ids) is null or cardinality(p_ids) not between 1 and 1000 or array_position(p_ids,null) is not null then raise invalid_parameter_value;end if;
 -- 착불이 없는 배송 건은 null, 없는 id는 키가 없다. 영수증 모양이 배열이 아니면 수납 정보만 null로 둔다(목록 전체를 깨지 않는다).
 return (select coalesce(jsonb_object_agg(s.id,case when s.shipping_collect_fee>0 then jsonb_build_object(
    'collectFee',s.shipping_collect_fee,
    'collector',(select group_value->'collector' from jsonb_array_elements(case when jsonb_typeof(t.original_receipt#>'{display,shipping}')='array'
       then t.original_receipt#>'{display,shipping}' else '[]'::jsonb end) group_value
      where group_value->>'originId'=s.origin_id::text and jsonb_typeof(group_value->'collector')='object' limit 1)) end),'{}'::jsonb)
  from public.order_shipments s left join private.order_goods_transactions t on t.order_id=s.order_id
  where s.id=any(p_ids));
end $$;
revoke all on function public.admin_shipment_collect_summaries(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_shipment_collect_summaries(uuid[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_shipment_collect_summaries(uuid[])'::regprocedure,'sales.dispatch','read',false);

do $check$
begin
  if (select count(*) from private.operator_rpc_contracts where capability='sales.dispatch')<>27 then
    raise exception 'shipment_collect_summaries_contract_count: %',(select count(*) from private.operator_rpc_contracts where capability='sales.dispatch');
  end if;
end $check$;

notify pgrst, 'reload schema';
commit;
