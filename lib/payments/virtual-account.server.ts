import 'server-only';

import { createClient } from '../supabase/server';
import { parseOrderVirtualAccount, type OrderVirtualAccount } from './virtual-account';

/**
 * 구매자 본인 주문의 가상계좌 입금 안내를 읽는다(RPC `get_my_order_virtual_account` — 주문 소유자만 값이 있다).
 * 읽지 못하면 null이다. 화면은 계좌를 단정하지 않고 주문 상세로 보낸다.
 */
export async function loadMyOrderVirtualAccount(orderId: string): Promise<OrderVirtualAccount | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_my_order_virtual_account', { p_order_id: orderId });
    if (error) return null;
    return parseOrderVirtualAccount(data);
  } catch {
    return null;
  }
}
