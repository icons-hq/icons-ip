-- 고객 주문내역 목록의 품목 줄 표시값을 한 번에 읽는 배치 RPC(MD-0036 수정 라운드 F1).
--
-- 목록 `/orders`는 품목 줄마다 정가·복수구매 단가 할인·부분 취소 뒤 남은 수량이 필요하다. 지금은 주문마다
-- `get_my_goods_transaction_receipt`를 불러(주문 수에 비례) 정가를 얻고, 부분 취소는 아예 반영하지 못한다.
-- 정가·복수구매 단가 할인은 v2 첫 버전부터 `order_items`에 스냅숏으로 있다(regular_unit_price_snapshot·volume_unit_discount).
-- 남은 수량은 부분 취소 원장(private.order_item_active_qty, ADR-0032)이 준다. 이 함수가 셋을 주문 한 묶음 단위로 돌려준다.
--
--  * 줄 집합은 `public.my_order_items`와 같다 — 그 함수를 그대로 부르므로 본인 주문만, 선물 주문은 제외(기존 직접 읽기와 같은 범위),
--    랜덤 판매 굿즈의 배정 행은 주문·굿즈마다 가장 작은 행 id 한 줄로 합쳐진다(행 수·행별 수량이 배정 결과라서).
--    합쳐진 줄의 남은 수량은 그 배정 행들의 합이고, 정가·복수구매 단가 할인은 배정 행이 모두 같은 값일 때만 돌려준다(다르면 null).
--  * v2(calculation_version 2) 주문만 정가·복수구매 단가 할인을 돌려준다. v1 주문은 정가 null·복수구매 할인 0 — 주문 단가가 구매가다.
--  * 결제 키·결과 코드·부분 취소 사유·고객 결정 기록은 내보내지 않는다. 남은 수량만 낸다.
create function public.my_order_item_display(p_order_ids uuid[]) returns table(
  item_id uuid, regular_unit_price integer, volume_unit_discount integer, active_qty integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare actor uuid := auth.uid();
begin
  if actor is null then raise insufficient_privilege using message = 'auth required'; end if;
  if p_order_ids is null or cardinality(p_order_ids) > 1000 then raise invalid_parameter_value using message = 'invalid_order_item_ids'; end if;
  return query
  select visible.id,
    case when parent.calculation_version = 2 and grouped.uniform then grouped.regular_price end,
    case when parent.calculation_version = 2 and grouped.uniform and grouped.regular_price is not null then grouped.volume_discount
         else 0 end,
    greatest(grouped.remaining, 0)
  from public.my_order_items(p_order_ids) visible
  join public.orders parent on parent.id = visible.order_id
  cross join lateral (
    select
      sum(private.order_item_active_qty(member.id))::integer as remaining,
      min(member.regular_unit_price_snapshot) as regular_price,
      min(member.volume_unit_discount)::integer as volume_discount,
      (count(distinct member.regular_unit_price_snapshot) <= 1
        and count(member.regular_unit_price_snapshot) in (0, count(*))
        and count(distinct member.volume_unit_discount) = 1
        and count(distinct member.unit_price) = 1) as uniform
    from public.order_items member
    where member.order_id = visible.order_id
      and (member.id = visible.id
        or (visible.option_sale_mode = 'random' and member.good_id = visible.good_id and member.option_sale_mode_snapshot = 'random'))
  ) grouped;
end $$;
revoke all on function public.my_order_item_display(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.my_order_item_display(uuid[]) to authenticated;
comment on function public.my_order_item_display(uuid[]) is
  '고객 주문내역 품목 줄 표시값(MD-0036). my_order_items와 같은 줄에 정가(v2)·복수구매 단가 할인·부분 취소 뒤 남은 수량을 붙인다. 랜덤 배정 행은 합친 줄 기준.';
