import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * 구매자 본인 주문의 진행 중 반품·교환이 방문 회수(반품 자동 회수 접수, QNA-032)인지. DB가 본인 주문만 본다. 스위치가 꺼져 있거나 읽지
 * 못하면 false — 주문 상세는 지금 반송 안내를 그대로 둔다.
 */
export async function loadMyOrderReturnPickup(orderId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_my_order_return_pickup', { p_order_id: orderId });
  return !error && data === true;
}
