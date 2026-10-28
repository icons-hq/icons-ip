import 'server-only';
import { readCompleteIdPages } from '@/lib/supabase/complete-id-pages';

/**
 * 고객 주문 품목 읽기(D5②). 고객 세션 클라이언트로 `order_items`를 직접 select하면 랜덤 배정 행이
 * restrictive RLS(`random_items_private_read`)에 걸려 빠진다. 고객 화면은 이 함수로 `public.my_order_items(uuid[])`를 읽는다.
 *
 * 반환 행은 `order_items`와 1:1이고(배송 건의 `order_item_id`와 맞는다) 열 이름도 같다. 랜덤 행만 가린다:
 * `variant_name_snapshot`='랜덤', `variant_id`=주문 때의 장바구니 키(기본 옵션), `variant_code_snapshot`=null,
 * `option_sale_mode`='random'(그 밖의 행은 'select'). 본인 주문만 돌려준다(선물 수령 주문은 제외 — 기존 직접 읽기와 같은 범위).
 */
export const MY_ORDER_ITEM_COLUMNS = 'id,order_id,product_order_number,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,'
  + 'variant_id,variant_name_snapshot,variant_code_snapshot,custom_inputs_snapshot,supply_source,preorder_expected_ship_date,option_sale_mode';

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
