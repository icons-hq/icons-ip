import 'server-only';

import { after } from 'next/server';
import { sendDepositReversalCanceledEmail, sendDepositReversalEmail } from '../email/transactional.server';
import { createServiceClient } from '../supabase/service';
import { createRuntimeAttemptPaymentGateway } from '../subscriptions/payment-dispatch.server';
import type { PaymentAttempt } from './gateway';
import {
  createGoodsDepositReversal,
  parseDepositReversalCloseResult,
  parseOpenDepositReversal,
  type OpenDepositReversal,
} from './goods-deposit-reversal.server';
import { loadGoodsPaymentKeyHint } from './goods-payment-key-hint.server';
import { getPaymentGateway } from './runtime-gateway';

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * 부수효과(안내 메일·취소 요청 이어 닫기)를 응답 뒤로 미룬다 — 토스 웹훅은 10초 안에 응답해야 한다. 요청 범위 밖(자동 재확인 cron·시험)에서는
 * after()가 던지므로 그때는 직접 기다린다. 작업 실패는 결제 판정을 흔들지 않는다(메일은 발송 이력, 취소 요청은 결제확인필요로 남는다).
 */
function runAfterResponse(label: string, work: () => Promise<unknown>): Promise<void> {
  const guarded = async () => {
    try {
      await work();
    } catch {
      console.error(`[payments/deposit-reversal] ${label} failed`);
    }
  };
  try {
    after(guarded);
    return Promise.resolve();
  } catch {
    return guarded();
  }
}

/** service RPC·테이블이 돌려준 굿즈 결제 시도 행을 좁힌다(토스 굿즈만). 형식이 계약과 다르면 null. */
export function parseGoodsPaymentAttemptRow(value: unknown): PaymentAttempt | null {
  const row = value as Record<string, unknown> | null;
  if (
    !row
    || typeof row !== 'object'
    || row.provider !== 'toss'
    || row.purpose !== 'order'
    || typeof row.id !== 'string'
    || typeof row.ref_id !== 'string'
    || typeof row.amount !== 'number'
    || typeof row.currency !== 'string'
    || typeof row.idempotency_key !== 'string'
    || typeof row.provider_order_id !== 'string'
    || typeof row.provider_product_code !== 'string'
    || typeof row.expires_at !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id,
    provider: 'toss',
    purpose: 'order',
    refId: row.ref_id,
    amount: row.amount,
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    providerOrderId: row.provider_order_id,
    providerProductCode: row.provider_product_code,
    expiresAt: row.expires_at,
  };
}

/** 자동 재확인이 뽑은 되돌림(`service_claim_deposit_reversal_checks`)을 좁힌다. 하나라도 형식이 어긋나면 null — 이번 회차를 건너뛴다. */
export function parseDepositReversalClaims(
  value: unknown,
  limit: number,
): Array<{ readonly reversal: OpenDepositReversal; readonly attempt: PaymentAttempt }> | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const claims: Array<{ reversal: OpenDepositReversal; attempt: PaymentAttempt }> = [];
  for (const row of value) {
    const reversal = parseOpenDepositReversal(row);
    const attempt = row && typeof row === 'object' ? parseGoodsPaymentAttemptRow((row as Record<string, unknown>).attempt) : null;
    if (!reversal || !attempt || attempt.id !== reversal.attemptId || attempt.refId !== reversal.orderId) return null;
    claims.push({ reversal, attempt });
  }
  return claims;
}

async function loadGoodsPaymentAttempt(service: ServiceClient, attemptId: string): Promise<PaymentAttempt | null> {
  const { data, error } = await service
    .from('payment_attempts')
    .select('id,provider,purpose,ref_id,amount,currency,idempotency_key,provider_order_id,provider_product_code,expires_at')
    .eq('id', attemptId)
    .maybeSingle();
  if (error) throw new Error('payment attempt lookup failed');
  return parseGoodsPaymentAttemptRow(data);
}

/** 열린 되돌림(없으면 null). 조회 실패는 throw — 호출자가 '모름'을 '없음'으로 읽지 않게. */
export async function loadOpenDepositReversal(service: ServiceClient, attemptId: string): Promise<OpenDepositReversal | null> {
  const { data, error } = await service.rpc('service_goods_deposit_reversal', { p_attempt_id: attemptId });
  if (error) throw new Error('deposit reversal lookup failed');
  if (data === null || data === undefined) return null;
  const reversal = parseOpenDepositReversal(data);
  if (!reversal) throw new Error('invalid deposit reversal');
  return reversal;
}

/**
 * 가상계좌 입금 오류 되돌림 처리의 런타임 조립(ADR-0049 결정 4). 웹훅·자동 재확인 cron·취소 오케스트레이터가 같은 판정을 쓴다.
 * 결제사 조회·반납은 결제 시도 게이트웨이(코어 API, 결제 위젯 시크릿 키)로 한다.
 */
export function createRuntimeDepositReversal(service: ServiceClient = createServiceClient()) {
  const gateway = createRuntimeAttemptPaymentGateway(service, 'toss', getPaymentGateway('toss'));
  return createGoodsDepositReversal({
    loadAttempt: (attemptId) => loadGoodsPaymentAttempt(service, attemptId),
    loadPaymentKey: loadGoodsPaymentKeyHint,
    loadOpenReversal: (attemptId) => loadOpenDepositReversal(service, attemptId),
    inspect: (attempt, paymentKey) => gateway.inspectBalance
      ? gateway.inspectBalance(attempt, paymentKey)
      : Promise.resolve({ kind: 'not_supported' as const }),
    async release(attempt, paymentKey) {
      // 반납 결과는 뒤따르는 조회가 판정한다 — 반납 메서드가 없으면 조회가 여전히 입금 전이라 다음 회차에 다시 본다.
      if (gateway.releaseVirtualAccount) await gateway.releaseVirtualAccount(attempt, paymentKey);
    },
    async flag({ attemptId, paymentKey, transactionRef, caseRef, dueAt }) {
      const { data, error } = await service.rpc('service_flag_goods_deposit_reversal', {
        p_attempt_id: attemptId,
        p_payment_key: paymentKey,
        p_transaction_ref: transactionRef,
        p_case_ref: caseRef,
        p_due_at: dueAt,
      });
      if (error || typeof data !== 'string') throw new Error('deposit reversal flag failed');
      return data;
    },
    async recordCheck({ attemptId, outcome, dueAt }) {
      const { data, error } = await service.rpc('service_record_deposit_reversal_check', {
        p_attempt_id: attemptId,
        p_outcome: outcome,
        p_due_at: dueAt,
      });
      if (error || typeof data !== 'string') throw new Error('deposit reversal check record failed');
      return data;
    },
    async resolveRedeposited({ attemptId, paymentKey, caseRef, sequence }) {
      const { data, error } = await service.rpc('service_resolve_deposit_reversal_redeposited', {
        p_attempt_id: attemptId,
        p_payment_key: paymentKey,
        p_case_ref: caseRef,
        p_sequence: sequence,
      });
      if (error || typeof data !== 'string') throw new Error('deposit reversal redeposit failed');
      return data;
    },
    async close({ attemptId, paymentKey, evidence, caseRef, sequence }) {
      const { data, error } = await service.rpc('service_close_deposit_reversal', {
        p_attempt_id: attemptId,
        p_payment_key: paymentKey,
        p_evidence: evidence,
        p_case_ref: caseRef,
        p_sequence: sequence,
      });
      if (error) throw new Error('deposit reversal close failed');
      return parseDepositReversalCloseResult(data);
    },
    notifyReversal: (orderId) => runAfterResponse('reversal email', () => sendDepositReversalEmail(orderId)),
    notifyCanceled: (orderId) => runAfterResponse('cancel email', () => sendDepositReversalCanceledEmail(orderId)),
    continueCancellation: ({ requestId, requestStatus }) => runAfterResponse('cancellation continue', async () => {
      if (requestStatus === 'needs_review') {
        const { data, error } = await service.rpc('service_begin_deposit_reversal_cancellation', { p_request_id: requestId });
        if (error || data !== 'started') return;
      }
      // 오케스트레이터는 이 모듈을 쓰므로 순환 import를 피해 부를 때 읽는다. 결제사 조회가 반납(CANCELED)을 확인하고 취소 확정이
      // 반납 증거를 읽어 환불 없이 주문을 닫는다. 실패는 요청을 결제확인필요로 남기고, 다음 회차가 다시 이어 간다.
      const { reconcileOrderCancellation } = await import('../orders/cancellation-orchestrator.server');
      await reconcileOrderCancellation({ requestId, actorId: null });
    }),
    now: () => new Date(),
  });
}
