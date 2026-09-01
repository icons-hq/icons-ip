import { randomUUID } from 'node:crypto';
import {
  GoodsPaymentReconciliationInProgressError,
} from '@/lib/payments/goods-checkout';
import { createRuntimeGoodsPaymentCheckout } from '@/lib/payments/goods-checkout.runtime.server';
import { paymentProviderConfigured } from '@/lib/payments/runtime-gateway';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';
import { TicketPaymentReconciliationInProgressError } from '@/lib/payments/ticket-checkout';
import { createRuntimeTicketPaymentCheckout } from '@/lib/payments/ticket-checkout.runtime.server';
import {
  TossWebhookInvalidError,
  parseTossWebhook,
  tossWebhookCaseRef,
} from '@/lib/payments/toss-webhook.server';

interface WebhookAttemptRow {
  readonly id: string;
  readonly purpose: 'order' | 'ticket';
  readonly state: string;
}

interface TossWebhookHandlerDependencies {
  readonly available: () => boolean;
  readonly loadAttempt: (providerOrderId: string) => Promise<WebhookAttemptRow | null>;
  readonly reconcileGoods: (input: { attemptId: string; caseRef: string }) => Promise<unknown>;
  readonly reconcileTicket: (input: { attemptId: string; caseRef: string }) => Promise<unknown>;
  readonly createCaseRefFallback?: () => string;
}

const RECONCILABLE_STATES = new Set(['confirming', 'unknown', 'needs_review']);

function acknowledged() {
  return Response.json({ received: true }, { status: 200 });
}

/**
 * 토스 웹훅(같은 URL에 문서 기반 재작성 — #390). 웹훅은 확정의 진실원이 아니라
 * 재정합 트리거다: 본문에서 orderId만 읽어 해당 attempt를 조회 API 기반
 * reconcile seam에 태우고, 반영은 전부 DB 멱등 finalizer가 한다. 종결된
 * attempt에 대한 웹훅(중복 수신·상태 역전 신호)은 no-op 200이다 — 원장을
 * 웹훅으로 되돌리는 경로는 존재하지 않는다.
 */
export function createTossWebhookHandler({
  available,
  loadAttempt,
  reconcileGoods,
  reconcileTicket,
  createCaseRefFallback = randomUUID,
}: TossWebhookHandlerDependencies) {
  return async function handleTossWebhook(request: Request) {
    if (!available()) {
      // 자격 증명·service 미구성 — 재전송(최대 7회)이 복구 후 재시도하게 한다.
      return Response.json({ error: 'unavailable' }, { status: 503 });
    }

    let parsed;
    try {
      parsed = await parseTossWebhook(request);
    } catch (error) {
      if (error instanceof TossWebhookInvalidError) {
        return Response.json({ error: 'invalid_webhook' }, { status: 400 });
      }
      throw error;
    }
    if (parsed.kind !== 'payment_status_changed') return acknowledged();

    const attempt = await loadAttempt(parsed.providerOrderId).catch(() => null);
    // 미지 식별자는 재전송해도 처리할 것이 없다 — 우리 원장의 결제가 아니다.
    if (!attempt) return acknowledged();
    // prepared는 TTL 스윕 소관이고, 종결 상태는 웹훅이 건드릴 수 없다(멱등).
    if (!RECONCILABLE_STATES.has(attempt.state)) return acknowledged();

    const caseRef = tossWebhookCaseRef(request, createCaseRefFallback);
    if (!caseRef) return acknowledged();

    try {
      if (attempt.purpose === 'order') {
        await reconcileGoods({ attemptId: attempt.id, caseRef });
      } else {
        await reconcileTicket({ attemptId: attempt.id, caseRef });
      }
    } catch (error) {
      if (
        error instanceof GoodsPaymentReconciliationInProgressError
        || error instanceof TicketPaymentReconciliationInProgressError
      ) {
        return acknowledged();
      }
      // 재정합 실패 — 재전송이 다시 시도하도록 5xx로 남긴다.
      return Response.json({ error: 'reconciliation_failed' }, { status: 500 });
    }
    return acknowledged();
  };
}

async function loadTossAttempt(providerOrderId: string): Promise<WebhookAttemptRow | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('payment_attempts')
    .select('id,purpose,state')
    .eq('provider', 'toss')
    .eq('provider_order_id', providerOrderId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || (row.purpose !== 'order' && row.purpose !== 'ticket')
    || typeof row.state !== 'string'
  ) {
    return null;
  }
  return { id: row.id, purpose: row.purpose, state: row.state };
}

export const POST = createTossWebhookHandler({
  // 굿즈·티켓 공통 수신부라 purpose별 파사드 대신 판정 요소(service role +
  // toss 자격 증명)를 직접 조합한다.
  available: () => getServiceRoleConfig().isConfigured && paymentProviderConfigured('toss'),
  loadAttempt: loadTossAttempt,
  reconcileGoods: (input) => createRuntimeGoodsPaymentCheckout('toss').reconcilePayment(input),
  reconcileTicket: (input) => createRuntimeTicketPaymentCheckout('toss').reconcilePayment(input),
});
