import 'server-only';

import { sendOrderConfirmationEmail } from '../email/transactional.server';
import { createServiceClient } from '../supabase/service';
import { createGoodsPaymentCheckout } from './goods-checkout';
import { createGoodsPaymentAttemptRepository } from './goods-checkout.server';
import { getPaymentGateway } from './runtime-gateway';

/** Composition root kept outside the deep module so tests can supply Fake. */
export function createRuntimeGoodsPaymentCheckout() {
  return createGoodsPaymentCheckout({
    provider: 'korpay',
    gateway: getPaymentGateway(),
    repository: createGoodsPaymentAttemptRepository(createServiceClient()),
    /* 승인 확정의 부수효과 — 주문 확인 메일(전자상거래법 서면 교부, #239·D8).
       발송 훅은 절대 throw하지 않고 email_deliveries 클레임으로 멱등이며(#180),
       이메일 env 미설정이면 조용히 건너뛰고 발송 이력에 실패로 남는다. */
    onApproved: async (attempt) => {
      await sendOrderConfirmationEmail(attempt.refId);
    },
  });
}
