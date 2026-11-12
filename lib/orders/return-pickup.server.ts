import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { NO_RETURN_PICKUP, parseOrderReturnPickup, type OrderReturnPickup } from './return-pickup';

/**
 * 구매자 본인 주문의 진행 중 반품·교환 회수 묶음 중 방문 회수(반품 자동 회수 접수, QNA-032)와 직접 발송 묶음 수. DB가 본인 주문(선물이면
 * 받는 분)만 본다. 스위치가 꺼져 있거나 읽지 못하면 둘 다 0 — 주문 상세는 지금 반송 안내를 그대로 둔다.
 */
export async function loadMyOrderReturnPickup(orderId: string): Promise<OrderReturnPickup> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_my_order_return_pickup', { p_order_id: orderId });
  return (!error && parseOrderReturnPickup(data)) || NO_RETURN_PICKUP;
}
