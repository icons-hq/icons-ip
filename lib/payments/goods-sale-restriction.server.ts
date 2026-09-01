import 'server-only';

import { createServiceClient } from '../supabase/service';
import type { PaymentCheckoutProvider } from './runtime-gateway';

/**
 * 주문 단위 카드 provider 파생(#392). 판매 제한(19금) 상품이 하나라도 담긴
 * 주문은 전용 PG(korpay), 아니면 toss다. 이 함수는 라우팅용 파생일 뿐이고
 * 최종 강제는 prepare_goods_payment_attempt RPC가 같은 규칙으로 수행한다 —
 * 클라이언트 신호는 물론 이 서버 파생도 진실원이 아니다.
 */
export async function deriveGoodsOrderProvider(
  orderId: string,
): Promise<PaymentCheckoutProvider> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('order_items')
    .select('good_id,goods!inner(sale_restriction)')
    .eq('order_id', orderId)
    .neq('goods.sale_restriction', 'none')
    .limit(1);
  if (error) throw new Error('sale restriction lookup failed');
  return (data ?? []).length > 0 ? 'korpay' : 'toss';
}
