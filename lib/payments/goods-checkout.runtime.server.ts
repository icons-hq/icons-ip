import 'server-only';

import { sendOrderConfirmationEmail } from '../email/transactional.server';
import { sendOrderConfirmationAlimtalk } from '../kakao/alimtalk/order-notices.server';
import { createServiceClient } from '../supabase/service';
import { createGoodsPaymentCheckout } from './goods-checkout';
import { createGoodsPaymentAttemptRepository, createGoodsPaymentKeyModeRecorder } from './goods-checkout.server';
import { getPaymentGateway, tossGatewayKeyMode, type PaymentCheckoutProvider } from './runtime-gateway';
import { createRuntimeAttemptPaymentGateway, goodsReconciliationFinalizer } from '../subscriptions/payment-dispatch.server';

/**
 * Composition root kept outside the deep module so tests can supply Fake.
 * 신규 굿즈 결제의 기본 provider는 toss다(에픽 #384). nicepay는 판매 제한 상품
 * 분기(#392, 2026-11-06 코페이 대체)이고 korpay는 진행 중 콜백 drain(korpay confirm
 * 라우트)만 남았다 — 같은 조립을 provider 인자로 공유하며, 승인 메일 훅은 provider와
 * 무관한 확정 부수효과다.
 */
export function createRuntimeGoodsPaymentCheckout(
  provider: PaymentCheckoutProvider = 'toss',
) {
  const service = createServiceClient();
  return createGoodsPaymentCheckout({
    provider,
    gateway: createRuntimeAttemptPaymentGateway(service, provider, getPaymentGateway(provider)),
    repository: createGoodsPaymentAttemptRepository(service, {
      reconciliationFinalizer: attemptId => goodsReconciliationFinalizer(service, provider, attemptId),
    }),
    /* 승인 확정의 부수효과 — 주문 확인 메일(전자상거래법 서면 교부, #239·D8).
       발송 훅은 절대 throw하지 않고 email_deliveries 클레임으로 멱등이며(#180),
       이메일 env 미설정이면 조용히 건너뛰고 발송 이력에 실패로 남는다. 카카오 알림톡 주문 접수 안내도 같은 규율이다
       (기본 꺼짐, 클레임으로 한 번만 — lib/kakao/alimtalk/order-notices.server.ts). */
    onApproved: async (attempt) => {
      /* 둘 다 throw하지 않는다. 승인 응답을 기다리는 사용자를 위해 차례로가 아니라 함께 보낸다. */
      await Promise.all([sendOrderConfirmationEmail(attempt.refId), sendOrderConfirmationAlimtalk(attempt.refId)]);
    },
    /* 토스 결제 준비는 이 배포의 키 모드를 시도에 남긴다(운영 배포만 — 그 밖은 null). 운영에 테스트 키가 물린 기간의
       승인은 DB가 출고 보류한다(supabase/migrations/20261118156000_order_fulfillment_holds.sql). 나이스페이·코페이는 실 MID다. */
    providerKeyMode: provider === 'toss' ? tossGatewayKeyMode : undefined,
    recordKeyMode: createGoodsPaymentKeyModeRecorder(service),
  });
}
