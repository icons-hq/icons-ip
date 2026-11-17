import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseOrderPaymentDisplay, type OrderPaymentDisplay } from './payment-display';

/**
 * 본인 주문의 결제수단 표시를 읽는다(`get_my_order_payment_display`). 결제 근거는 private 스키마에 있어
 * 이 RPC만이 method·마스킹 표기를 꺼낸다. 읽기 실패·형식 불일치·결제 없음은 모두 null이다 —
 * 화면은 대체 라벨('카드·간편결제')로 그리고 주문 상세 자체는 막지 않는다.
 */
export async function loadMyOrderPaymentDisplay(orderId: string): Promise<OrderPaymentDisplay | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_my_order_payment_display', { p_order_id: orderId });
    if (error) {
      console.error('[orders] payment display unavailable', error.code ?? 'rpc_error');
      return null;
    }
    return parseOrderPaymentDisplay(data);
  } catch {
    console.error('[orders] payment display unavailable', 'client_error');
    return null;
  }
}
