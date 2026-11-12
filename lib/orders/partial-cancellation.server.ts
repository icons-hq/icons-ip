import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { parseOrderPartialCancellationRecords, type OrderPartialCancellationRecord } from './partial-cancellation';

/**
 * 구매자 본인 주문의 적용된 재고 부족 부분 취소(ADR-0032). DB가 본인 주문의 적용된 건만 돌려준다(결제사 확인 전·진행하지 않은
 * 건은 없다). 없거나 읽지 못하면 빈 배열 — 주문 상세의 다른 내용은 그대로 보인다.
 */
export async function loadMyOrderPartialCancellations(orderId: string): Promise<OrderPartialCancellationRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_my_order_partial_cancellations', { p_order_id: orderId });
  if (error) return [];
  try {
    return parseOrderPartialCancellationRecords(data);
  } catch {
    return [];
  }
}
