import 'server-only';

import { getServiceRoleConfig } from '../supabase/service';
import {
  newPaymentCheckoutEnabled,
  paymentProviderConfigured,
  type PaymentCheckoutProvider,
} from './runtime-gateway';

/**
 * Goods reservations are created only when the provider-neutral server path is
 * ready. 신규 결제의 기본 provider는 toss다(에픽 #384). 콜백 drain은 provider별
 * 자격 증명 기준이라 korpay 콜백 라우트는 'korpay'를 명시해 호출한다 — rollout
 * gate가 닫혀도 진행 중 콜백은 계속 처리돼야 한다.
 */
export function goodsPaymentConfirmationAvailable(
  provider: PaymentCheckoutProvider = 'toss',
) {
  return getServiceRoleConfig().isConfigured && paymentProviderConfigured(provider);
}

/**
 * 신규 결제 시작 gate. provider는 주문의 도메인 사실(판매 제한 상품 포함 여부)
 * 에서 파생된다(#392) — 일반 주문은 toss, 제한 주문은 korpay gate를 본다.
 */
export function goodsCheckoutPaymentsEnabled(
  userId?: string,
  provider: PaymentCheckoutProvider = 'toss',
) {
  return goodsPaymentConfirmationAvailable(provider)
    && newPaymentCheckoutEnabled('order', userId, provider);
}
