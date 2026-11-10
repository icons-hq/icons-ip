-- R26(D4①): 고객 화면의 배송 묶음 이름을 출고지 기본 택배사로 부른다('한진택배 배송', '우체국택배 배송').
--
-- 고객은 public.fulfillment_origins를 읽지 못한다(staff 전용 RLS). legacy 견적 주소 래퍼가 SECURITY DEFINER
-- 안에서 묶음마다 이미 싣고 있는 carrierCode(출고지 default_carrier)에 택배사 표시 이름을 덧붙인다.
-- 택배사가 없거나 꺼져 있으면 null이고 화면은 '택배 배송'으로 부른다.
--
-- 견적 전용 래퍼에서만 붙인다. 주문 스냅샷(orders.shipping_fee_breakdown)은 private.goods_shipping_fee_for가
-- private.apply_shipping_region_quote를 직접 불러 만들므로 바뀌지 않는다. public.quote_goods_sales·place_order*·
-- private.calculate_goods_shipping은 재정의하지 않는다.
--
-- 기준 본문: 20260910100643_sales_shipping_regions.sql:344-357(이후 재정의 없음, pg_get_functiondef로 확인).
create or replace function public.quote_goods_sales_for_address(items jsonb, destination jsonb)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare quote jsonb; shipping jsonb; lines jsonb;
begin
  quote:=public.quote_goods_sales(items);
  select coalesce(jsonb_agg(jsonb_build_object('origin_id',good.origin_id,'good_id',good.id,'fee_type',good.shipping_fee_type)),'[]') into lines
    from jsonb_to_recordset(items) line("goodId" text,"variantId" uuid,qty integer) join public.goods good on good.id=line."goodId";
  shipping:=private.apply_shipping_region_quote(quote->'shipping',lines,destination,statement_timestamp());
  shipping:=shipping||jsonb_build_object('groups',(
    select coalesce(jsonb_agg(grp.value||jsonb_build_object('carrierLabel',carrier.label) order by grp.ordinality),'[]'::jsonb)
    from jsonb_array_elements(shipping->'groups') with ordinality as grp(value,ordinality)
    left join public.shipping_carriers carrier on carrier.code=grp.value->>'carrierCode' and carrier.is_active));
  return quote||jsonb_build_object('shipping',shipping,
    'nextChangeAt',least((quote->>'nextChangeAt')::timestamptz,(shipping->>'nextChangeAt')::timestamptz),
    'coupon',private.quote_selected_coupon(quote->'lines',(quote->>'subtotal')::bigint,(shipping->>'totalFee')::bigint));
end $function$;

revoke all on function public.quote_goods_sales_for_address(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_goods_sales_for_address(jsonb,jsonb) to anon,authenticated,postgres;
