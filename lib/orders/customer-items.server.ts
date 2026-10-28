import 'server-only';
import { readCompleteIdPages } from '@/lib/supabase/complete-id-pages';

/**
 * 고객 주문 품목 읽기(D5②). 고객 세션 클라이언트로 `order_items`를 직접 select하면 랜덤 배정 행이
 * restrictive RLS(`random_items_private_read`)에 걸려 빠진다. 고객 화면은 이 함수로 `public.my_order_items(uuid[])`를 읽는다.
 *
 * 열 이름은 `order_items`와 같다. 선택 판매 행은 `order_items`와 1:1이다. 랜덤 배정 행은 DB가 같은 주문·같은 굿즈마다
 * 한 줄로 합친다(배정 옵션마다 나뉜 행 수·행별 수량도 배정 결과라서다): id·상품주문번호 = 가장 작은 배정 행의 것,
 * `qty` = 합계, `variant_id` = 장바구니 키(기본 옵션), `variant_name_snapshot`='랜덤', `variant_code_snapshot`=null,
 * `option_sale_mode`='random'(그 밖의 행은 'select'). `shipment_id` = 그 줄의 배송 건(고객은 배송 건 품목의 랜덤 행을 읽지
 * 못하므로 `attachRandomItemsToShipments`로 붙인다). 본인 주문만 돌려준다(선물 수령 주문은 제외 — 기존 직접 읽기와 같은 범위).
 */
export const MY_ORDER_ITEM_COLUMNS = 'id,order_id,product_order_number,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,'
  + 'variant_id,variant_name_snapshot,variant_code_snapshot,custom_inputs_snapshot,supply_source,preorder_expected_ship_date,option_sale_mode,shipment_id';

export interface MyOrderItemRow {
  id: string;
  order_id: string;
  product_order_number: string | null;
  good_id: string;
  qty: number;
  unit_price: number;
  good_name_snapshot: string;
  good_type_snapshot: string;
  variant_id: string | null;
  variant_name_snapshot: string | null;
  variant_code_snapshot: string | null;
  custom_inputs_snapshot: unknown;
  supply_source: string | null;
  preorder_expected_ship_date: string | null;
  option_sale_mode: 'select' | 'random';
  shipment_id: string | null;
}

interface RpcPage<T> { data: T[] | null; error: { message: string } | null; count: number | null }
interface RpcFilter<T> extends PromiseLike<RpcPage<T>> {
  select(columns: string): RpcFilter<T>;
  order(column: string, options: { ascending: boolean }): RpcFilter<T>;
  limit(count: number): RpcFilter<T>;
  gt(column: string, value: string): RpcFilter<T>;
}
/** createClient()가 돌려주는 클라이언트의 rpc 부분만 요구한다(테스트에서 흉내 내기 쉽게). */
export interface MyOrderItemsClient {
  rpc(fn: 'my_order_items', args: { p_order_ids: string[] }, options: { count: 'exact' }): unknown;
}

export async function readMyOrderItems<T extends { id: string } = MyOrderItemRow>(
  supabase: MyOrderItemsClient,
  orderIds: readonly string[],
  columns: string = MY_ORDER_ITEM_COLUMNS,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  if (!orderIds.length) return { data: [], error: null };
  return readCompleteIdPages<T>((afterId, pageSize) => {
    let query = (supabase.rpc('my_order_items', { p_order_ids: [...orderIds] }, { count: 'exact' }) as RpcFilter<T>)
      .select(columns).order('id', { ascending: true }).limit(pageSize);
    if (afterId) query = query.gt('id', afterId);
    return query;
  });
}

/**
 * 고객 배송 건에 합친 랜덤 줄을 붙인다(D5②). 고객 세션은 `order_shipment_items`의 랜덤 배정 행을 읽지 못해
 * (restrictive RLS `random_shipment_items_private_read` — 행 수·행별 수량이 배정 결과다) 배송 건 품목 id에 랜덤 줄이 없다.
 * `my_order_items`가 준 `shipment_id`로 그 줄 id를 해당 배송 건 끝에 더한다. 이미 있으면 두지 않는다.
 */
export function attachRandomItemsToShipments<S extends { id: string; orderItemIds: string[] }>(
  shipments: readonly S[],
  items: readonly { id: string; option_sale_mode?: unknown; shipment_id?: string | null }[],
): S[] {
  return shipments.map((shipment) => {
    const added = items.filter((item) => item.option_sale_mode === 'random' && item.shipment_id === shipment.id
      && !shipment.orderItemIds.includes(item.id)).map((item) => item.id);
    return added.length ? { ...shipment, orderItemIds: [...shipment.orderItemIds, ...added] } : shipment;
  });
}

/**
 * service role 경로(메일) 전용: 같은 주문·같은 굿즈·같은 단가의 랜덤 배정 행을 첫 행(가장 작은 id) 하나로 합친다.
 * 고객 세션 화면은 `my_order_items`가 DB에서 이미 합치므로 쓰지 않는다. service role은 `order_items`를 그대로 읽어
 * 배정 옵션마다 나뉜 행을 받으므로, 그대로 보이면 "2개 + 1개"처럼 나뉜 모양이 배정 결과의 일부를 드러낸다.
 * 합친 행의 id는 첫 행 id다(`my_order_items`와 같은 대표 행) — service role 배송 건 품목에는 모든 배정 행 id가 있으므로
 * 배송 건 대응이 유지된다. 선택 판매 행은 건드리지 않는다. 행 순서는 첫 등장 순서다.
 */
export function mergeRandomOrderItemRows<T extends { id: string; good_id: string; qty: number; order_id?: string; unit_price?: number }>(
  rows: readonly T[],
  isRandom: (row: T) => boolean = (row) => (row as { option_sale_mode?: unknown }).option_sale_mode === 'random',
): T[] {
  const merged: T[] = [];
  const firstByKey = new Map<string, number>();
  for (const row of rows) {
    if (!isRandom(row)) { merged.push(row); continue; }
    const key = JSON.stringify([row.order_id ?? null, row.good_id, row.unit_price ?? null]);
    const index = firstByKey.get(key);
    if (index === undefined) {
      firstByKey.set(key, merged.length);
      merged.push({ ...row });
    } else {
      merged[index] = { ...merged[index], qty: merged[index].qty + row.qty };
    }
  }
  return merged;
}
