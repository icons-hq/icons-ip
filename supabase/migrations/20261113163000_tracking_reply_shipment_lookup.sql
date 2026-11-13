-- ============================================================================
-- QA 라운드 2 묶음 C: 물류 계정의 표준 회신 등록 전 확인 건수.
--
-- 표준 양식 회신은 같은 배송 건에 운송장 칸을 비운 줄이 있으면 채운 줄도 등록되지 않는다. 등록 전 확인이 그 건수를 맞추려면
-- 상품주문번호 → 배송 건 연결을 읽어야 하는데, 앱이 사용자 세션으로 order_items를 읽으면 RLS(sales.read)에 막혀 물류 계정(sales.dispatch)은
-- 0행을 받고 예전 건수로 돌아갔다. 출고 권한(sales.dispatch)으로 열리는 읽기 RPC를 새로 둔다.
-- 돌려주는 것은 회신에 쓴 상품주문번호(또는 줄 id)와 배송 건 id뿐이다 — 구매자·금액·상품 정보는 읽지 않는다.
-- 같은 migration에서 발송 대기 행의 '부분 취소 진행 중' 표시도 읽는다(QA2 물류 6번): 재고 부족 부분 취소가 결제사 확인 중이면(order_partial_cancel_in_flight)
-- 출고지시가 'order cancellation in progress'로 거절되는데, 물류 화면에는 그 이유가 없었다. 돌려주는 것은 배송 건 id뿐이다(금액·구매자 없음, T05).
-- 새 함수라 기존 함수 재정의가 없다. 운영자 계약(RPC)은 같은 migration에서 등록한다.
-- ============================================================================
begin;

create function public.admin_tracking_reply_shipment_links(p_references text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  refs text[];
  result jsonb;
begin
  if auth.uid() is null or not public.has_operator_capability('sales.dispatch', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_references is null or coalesce(array_length(p_references, 1), 0) > 2000 then
    raise exception using message = 'tracking_reply_references_invalid';
  end if;
  select coalesce(array_agg(distinct pg_catalog.lower(btrim(ref))), array[]::text[]) into refs
  from unnest(p_references) as ref where ref is not null and btrim(ref) <> '';
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('reference', found.reference, 'shipmentId', found.shipment_id)), '[]'::jsonb) into result
  from (
    select distinct on (match.reference, link.shipment_id) match.reference, link.shipment_id
    from (
      select pg_catalog.lower(i.product_order_number) as reference, i.id as item_id
      from public.order_items i where pg_catalog.lower(i.product_order_number) = any(refs)
      union all
      select i.id::text, i.id from public.order_items i where i.id::text = any(refs)
    ) match
    join public.order_shipment_items link on link.order_item_id = match.item_id
  ) found;
  return result;
end $$;

alter function public.admin_tracking_reply_shipment_links(text[]) owner to postgres;
revoke all on function public.admin_tracking_reply_shipment_links(text[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_tracking_reply_shipment_links(text[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_tracking_reply_shipment_links(text[])'::regprocedure, 'sales.dispatch', 'read', false);

create function public.admin_shipment_partial_cancel_flags(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_operator_capability('sales.dispatch', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) > 1000 then
    raise exception using message = 'shipment_ids_invalid';
  end if;
  select coalesce(pg_catalog.jsonb_agg(s.id order by s.id), '[]'::jsonb) into result
  from public.order_shipments s
  where s.id = any(p_ids) and private.order_partial_cancel_in_flight(s.order_id);
  return result;
end $$;

alter function public.admin_shipment_partial_cancel_flags(uuid[]) owner to postgres;
revoke all on function public.admin_shipment_partial_cancel_flags(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_shipment_partial_cancel_flags(uuid[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_shipment_partial_cancel_flags(uuid[])'::regprocedure, 'sales.dispatch', 'read', false);
notify pgrst, 'reload schema';
commit;
