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

const GOOD_ID = /^[a-z0-9][a-z0-9-]{0,199}$/;

/**
 * 주문을 만들기 전, 담긴 굿즈로 같은 파생을 미리 한다(ADR-0024). 성인 상품이 섞인
 * 카트의 카드 주문은 코페이 gate를 봐야 한다 — 토스 gate만 보면 코페이가 닫혀 있을 때
 * 결제할 수 없는 주문이 생기고, 반대로 토스가 닫혀 있으면 열린 코페이 주문을 막는다.
 * 확정 파생은 여전히 주문 뒤 deriveGoodsOrderProvider와 DB prepare다.
 */
export async function deriveGoodsCartProvider(
  goodIds: readonly string[],
): Promise<PaymentCheckoutProvider> {
  const ids = [...new Set(goodIds)].filter((id) => GOOD_ID.test(id));
  if (!ids.length) return 'toss';
  const service = createServiceClient();
  const { data, error } = await service
    .from('goods')
    .select('id')
    .in('id', ids.slice(0, 1000))
    .neq('sale_restriction', 'none')
    .limit(1);
  if (error) throw new Error('sale restriction lookup failed');
  return (data ?? []).length > 0 ? 'korpay' : 'toss';
}

/** 서버 장바구니 기준 파생. 주문서 첫 화면과 이어서 주문하기처럼 카트 목록이 요청에 없을 때 쓴다. */
export async function deriveUserCartProvider(userId: string): Promise<PaymentCheckoutProvider> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('cart_items')
    .select('good_id,goods!inner(sale_restriction)')
    .eq('user_id', userId)
    .neq('goods.sale_restriction', 'none')
    .limit(1);
  if (error) throw new Error('sale restriction lookup failed');
  return (data ?? []).length > 0 ? 'korpay' : 'toss';
}
