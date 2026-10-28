/**
 * 테스트 전용: `public.my_order_items(uuid[])`(20261028160300)의 계약을 흉내 낸다.
 *
 * 원본 픽스처 행은 `order_items` 모양에 `option_sale_mode_snapshot`·`cart_variant_id`(배정 증빙의 장바구니 키)·`shipment_id`
 * (배송 건 품목 join 결과)를 얹은 것이다. 랜덤 배정 행은 같은 주문·같은 굿즈마다 한 줄로 합친다: id·배송 건 = 가장 작은 행 id의
 * 것, 수량 = 합계, variant_id = 장바구니 키, 옵션명 '랜덤', 코드 null. 선택 판매 행은 그대로(`option_sale_mode`='select')다.
 */
export function myOrderItemsFixture(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const visible: Record<string, unknown>[] = [];
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const { option_sale_mode_snapshot: mode, cart_variant_id: _cartVariantId, ...rest } = row;
    if (mode !== 'random') { visible.push({ ...rest, option_sale_mode: 'select', shipment_id: row.shipment_id ?? null }); continue; }
    const key = JSON.stringify([row.order_id, row.good_id]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    const sorted = [...group].sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const { option_sale_mode_snapshot: _mode, cart_variant_id: cartVariantId, ...first } = sorted[0];
    visible.push({ ...first, qty: sorted.reduce((total, row) => total + Number(row.qty), 0), variant_id: cartVariantId ?? null,
      variant_name_snapshot: '랜덤', variant_code_snapshot: null, option_sale_mode: 'random', shipment_id: first.shipment_id ?? null });
  }
  return visible;
}
