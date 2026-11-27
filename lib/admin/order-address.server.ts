import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { orderAddressDestinationLocked, parseOrderAddressContext, parseOrderAddressReceipt, type OrderAddressContext } from './order-address';

/**
 * 우편번호·기본 주소를 바꿀 수 없는 주문인지 읽는다(읽기 전용). DB의 배송지 조회는 주문 상태로 막히는 이유만 알려 주고, 이 조건은 저장할 때에야
 * 거절로 알 수 있다 — 화면이 두 칸을 미리 잠그도록 같은 조건을 주문·배송 건에서 읽어 판정한다. 읽지 못하면 undefined(잠그지 않고 DB가 판정).
 */
async function readDestinationLocked(client: Awaited<ReturnType<typeof createClient>>, orderId: string): Promise<boolean | undefined> {
  try {
    const [order, shipments] = await Promise.all([
      client.from('orders').select('calculation_version').eq('id', orderId).maybeSingle(),
      client.from('order_shipments').select('origin_id,delivery_method,shipping_fee,shipping_fee_snapshot').eq('order_id', orderId),
    ]);
    if (order.error || shipments.error || !order.data || !Array.isArray(shipments.data)) return undefined;
    return orderAddressDestinationLocked((order.data as { calculation_version?: unknown }).calculation_version, shipments.data);
  } catch { return undefined; }
}

export async function getOrderAddressContext(orderId: string): Promise<OrderAddressContext> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_order_address_context', { p_order_id: orderId });
  const parsed = parseOrderAddressContext(data); if (error || !parsed || parsed.orderId !== orderId) throw new Error('Failed to read order address context');
  /* 바꿀 수 없는 주문은 입력 칸을 그리지 않으므로 읽지 않는다. */
  const destinationLocked = parsed.allowed ? await readDestinationLocked(client, orderId) : undefined;
  return destinationLocked === undefined ? parsed : { ...parsed, destinationLocked };
}
export async function getOrderAddressReceipt(id: string) {
  const client = await createClient(); const { data, error } = await client.rpc('admin_get_order_address_change', { p_operation_id: id });
  if (error) throw new Error('Failed to read order address receipt');
  if (data === null) return null;
  const parsed = parseOrderAddressReceipt(data); if (!parsed || parsed.id !== id) throw new Error('Invalid order address receipt'); return parsed;
}
