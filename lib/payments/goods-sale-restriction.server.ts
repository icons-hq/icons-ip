import 'server-only';

import { createServiceClient } from '../supabase/service';
import type { PaymentCheckoutProvider } from './runtime-gateway';

/**
 * 판매 제한(19금) 상품이 담긴 굿즈 주문의 카드 PG. 2026-11-05 결정으로 코페이에서
 * 나이스페이로 바뀌었다 — 코페이는 취소·조회 API가 없어 수동 취소만 됐다. DB
 * prepare_goods_payment_attempt가 같은 값을 강제하므로 둘을 함께 바꾼다
 * (20261106100100_nicepay_goods_payment_seam.sql).
 */
export const RESTRICTED_GOODS_CARD_PROVIDER = 'nicepay' satisfies PaymentCheckoutProvider;

/**
 * 주문 단위 카드 provider 파생(#392). 판매 제한(19금) 상품이 하나라도 담긴
 * 주문은 전용 PG(RESTRICTED_GOODS_CARD_PROVIDER), 아니면 toss다. 이 함수는 라우팅용
 * 파생일 뿐이고 최종 강제는 prepare_goods_payment_attempt RPC가 같은 규칙으로 수행한다 —
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
  return (data ?? []).length > 0 ? RESTRICTED_GOODS_CARD_PROVIDER : 'toss';
}
