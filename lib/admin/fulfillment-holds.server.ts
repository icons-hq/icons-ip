import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  parseOrderFulfillmentHoldList,
  parseOrderFulfillmentHolds,
  type OrderFulfillmentHold,
  type OrderFulfillmentHoldList,
} from './fulfillment-holds';

type Client = Awaited<ReturnType<typeof createClient>>;

/** 주문들의 출고 보류(주문 조회 권한). 보류가 없는 주문은 지도에 없다. 읽지 못하면 throw — 보류를 숨긴 채 목록을 열지 않는다. */
export async function loadOrderFulfillmentHolds(orderIds: readonly string[], client?: Client): Promise<Map<string, OrderFulfillmentHold[]>> {
  if (!orderIds.length) return new Map();
  const supabase = client ?? await createClient();
  const result = new Map<string, OrderFulfillmentHold[]>();
  for (let start = 0; start < orderIds.length; start += 200) {
    const page = orderIds.slice(start, start + 200);
    const { data, error } = await supabase.rpc('admin_order_fulfillment_holds', { p_order_ids: page });
    const parsed = error ? null : parseOrderFulfillmentHolds(data, page);
    if (!parsed) throw new Error('출고 보류 상태를 확인하지 못했습니다.');
    for (const [orderId, holds] of parsed) result.set(orderId, holds);
  }
  return result;
}

/** 보류 중인 주문 목록(오래된 순, 최대 limit건)과 전체 건수. */
export async function listOrderFulfillmentHolds(limit = 50): Promise<OrderFulfillmentHoldList> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_order_fulfillment_holds', { p_limit: limit });
  const parsed = error ? null : parseOrderFulfillmentHoldList(data);
  if (!parsed) throw new Error('출고 보류 주문을 불러오지 못했습니다.');
  return parsed;
}
