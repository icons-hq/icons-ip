import 'server-only';

import { createServiceClient } from '../supabase/service';
import type { PaymentCheckoutProvider } from './runtime-gateway';

/**
 * 판매 제한(19금) 상품이 담긴 굿즈 주문의 카드 PG. 2026-11-25 사용자 결정으로 토스페이먼츠다
 * (ADR-0053 — "19금 상품은 일단은 전부 토스페이먼츠로 판매 진행한다 토스에서도 딱히 상관없다고 했다").
 * 그 전에는 전용 PG 나이스페이(2026-11-05 코페이 대체)였는데 운영 MID·키가 없어 19금 상품을 결제할 수
 * 없었다. DB prepare_goods_payment_attempt는 판매 제한 주문에 toss·nicepay를 모두 받으므로
 * (20261126100000_adult_goods_toss_card_provider.sql) 나이스페이로 되돌릴 때는 이 상수만 바꾼다.
 */
export const RESTRICTED_GOODS_CARD_PROVIDER = 'toss' satisfies PaymentCheckoutProvider;

/**
 * 주문 단위 카드 provider 파생(#392). 판매 제한(19금) 상품이 하나라도 담긴
 * 주문은 RESTRICTED_GOODS_CARD_PROVIDER(지금은 toss — ADR-0053), 아니면 toss다. 이 함수는 라우팅용
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

const GOOD_ID = /^[a-z0-9][a-z0-9-]{0,199}$/;

/**
 * 주문을 만들기 전, 담긴 굿즈로 같은 파생을 미리 한다(ADR-0024). 성인 상품이 섞인
 * 카트의 카드 주문은 RESTRICTED_GOODS_CARD_PROVIDER의 gate를 봐야 한다 — 그 PG가 토스와 다를 때
 * 토스 gate만 보면 닫힌 PG로 결제할 수 없는 주문이 생긴다(지금은 둘 다 toss — ADR-0053). 확정 파생은 여전히 주문 뒤 deriveGoodsOrderProvider와 DB prepare다.
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
  return (data ?? []).length > 0 ? RESTRICTED_GOODS_CARD_PROVIDER : 'toss';
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
  return (data ?? []).length > 0 ? RESTRICTED_GOODS_CARD_PROVIDER : 'toss';
}
