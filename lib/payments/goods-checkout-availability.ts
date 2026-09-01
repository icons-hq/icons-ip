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

export function goodsCheckoutPaymentsEnabled(userId?: string) {
  return goodsPaymentConfirmationAvailable('toss')
    && newPaymentCheckoutEnabled('order', userId, 'toss');
}
