-- 10/27 회의 D5②(R24) 보강 — 랜덤 판매 굿즈의 주문 품목 행 분할을 고객에게 숨긴다(T7 리뷰 RV-1).
--
-- 주문 코어는 배정 옵션마다 order_items 행을 나눠 넣는다(3개 주문이 A·B·C로 나오면 1+1+1 세 행, A만 나오면 3 한 행).
-- 20261028160100의 my_order_items는 그 행을 1:1로 돌려줬고, 고객은 order_shipment_items(order_item_id·qty)도 직접 읽었다.
-- 그래서 행 수·행별 수량으로 "모두 다른 옵션이 나왔는지(중복이 없는지)"가 결제 전에 드러났고, 결제 대기 주문은 다시
-- 주문하면 비용 없이 닫히므로(supersede) 원하는 조합이 나올 때까지 다시 뽑을 수 있었다.
--
--   1. public.my_order_items: 같은 주문·같은 굿즈의 랜덤 행을 한 줄로 합친다. id·상품주문번호·배송 건은 가장 작은 배정 행 id의
--      것, 수량은 합계, variant_id는 장바구니 키(지금 기본 옵션, 없으면 주문 때 키), 옵션명 '랜덤', 코드 null.
--      새 열 shipment_id: 고객이 배송 건 품목에서 랜덤 행을 못 읽으므로 화면이 이 값으로 합친 줄을 배송 건에 붙인다.
--   2. order_shipment_items: restrictive 정책으로 랜덤 배정 행을 고객 직접 읽기에서 뺀다(운영자 sales.read는 그대로).
-- 남는 단서(이 migration 범위 밖): 상품주문번호는 일자별 연속 번호라, 랜덤 굿즈 뒤에 다른 품목이 있는 주문은 번호 간격으로
-- 숨은 행 수를 짐작할 수 있다. 결제 뒤(배송·교환 재출고 이력)에는 실물과 함께 옵션이 드러나는 것이 정상이다.
begin;

-- 1. 고객 주문 품목 마스킹 조회 --------------------------------------------------------------------------------
drop function public.my_order_items(uuid[]);
create function public.my_order_items(p_order_ids uuid[]) returns table(
  id uuid, order_id uuid, product_order_number text, good_id text, qty integer, unit_price integer,
  good_name_snapshot text, good_type_snapshot text, variant_id uuid, variant_name_snapshot text, variant_code_snapshot text,
  custom_inputs_snapshot jsonb, supply_source text, preorder_expected_ship_date date, option_sale_mode text, shipment_id uuid)
language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare actor uuid:=auth.uid();
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  if p_order_ids is null or cardinality(p_order_ids)>1000 then raise invalid_parameter_value using message='invalid_order_item_ids'; end if;
  return query
  with owned as (
    select item.id item_id,item.order_id item_order_id,item.good_id item_good_id,item.qty item_qty,item.option_sale_mode_snapshot item_mode
    from public.order_items item
    join public.orders o on o.id=item.order_id
    where item.order_id=any(p_order_ids) and o.user_id=actor and private.gift_direct_order_read_allowed(o.id,actor)
  ), random_groups as (
    select (array_agg(owned.item_id order by owned.item_id))[1] representative_id,least(sum(owned.item_qty::bigint),2147483647)::integer total_qty
    from owned where owned.item_mode='random' group by owned.item_order_id,owned.item_good_id
  ), visible as (
    select owned.item_id visible_id,owned.item_qty visible_qty,false visible_random from owned where owned.item_mode is null
    union all
    select random_groups.representative_id,random_groups.total_qty,true from random_groups
  )
  select item.id,item.order_id,item.product_order_number,item.good_id,visible.visible_qty,item.unit_price,item.good_name_snapshot,item.good_type_snapshot,
    case when visible.visible_random then coalesce((select key_variant.id from public.goods_variants key_variant
        where key_variant.good_id=item.good_id and key_variant.is_default and key_variant.archived_at is null limit 1),allocation.cart_variant_id)
      else item.variant_id end,
    case when visible.visible_random then '랜덤' else item.variant_name_snapshot end,
    case when visible.visible_random then null else item.variant_code_snapshot end,
    item.custom_inputs_snapshot,item.supply_source,item.preorder_expected_ship_date,
    case when visible.visible_random then 'random' else 'select' end,
    shipment_item.shipment_id
  from visible
  join public.order_items item on item.id=visible.visible_id
  left join private.order_item_random_allocations allocation on allocation.order_item_id=item.id
  left join public.order_shipment_items shipment_item on shipment_item.order_item_id=item.id;
end $$;
revoke all on function public.my_order_items(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.my_order_items(uuid[]) to authenticated;
comment on function public.my_order_items(uuid[]) is
  '고객 주문 품목(D5②). 랜덤 배정 행은 주문·굿즈마다 한 줄(가장 작은 행 id, 수량 합계, 장바구니 키, 옵션명 랜덤)로 합친다. shipment_id = 그 줄의 배송 건.';

-- 2. 배송 건 품목의 랜덤 행 은닉 --------------------------------------------------------------------------------
-- 정책 안에서 order_items를 그대로 읽으면 고객에게는 랜덤 행이 이미 안 보여(random_items_private_read) 판정이 뒤집힌다.
-- 그래서 판정만 하는 정의자 함수를 둔다(선물 주문 선례 public.gift_direct_order_read_allowed와 같은 모양).
create function public.order_item_random_hidden(p_order_item_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.order_items item where item.id=p_order_item_id and item.option_sale_mode_snapshot='random');
$$;
revoke all on function public.order_item_random_hidden(uuid) from public,anon,authenticated,service_role;
grant execute on function public.order_item_random_hidden(uuid) to authenticated;
comment on function public.order_item_random_hidden(uuid) is
  '배송 건 품목 고객 읽기 정책용(D5②). 랜덤 배정 품목이면 true. 고객 화면은 my_order_items.shipment_id로 배송 건을 맞춘다.';
select private.register_operator_internal_contract('public.order_item_random_hidden(uuid)'::regprocedure);

create policy random_shipment_items_private_read on public.order_shipment_items as restrictive for select to authenticated
  using ((select public.has_operator_capability('sales.read')) or not public.order_item_random_hidden(order_item_id));
select private.register_operator_policy_contract('public.order_shipment_items'::regclass,'random_shipment_items_private_read','sales.read');

commit;
notify pgrst,'reload schema';
