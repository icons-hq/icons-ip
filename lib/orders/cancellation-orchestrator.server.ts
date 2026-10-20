import 'server-only';

import type { PaymentAttempt, RefundOutcome } from '../payments/gateway';
import { getPaymentGateway, type PaymentCheckoutProvider } from '../payments/runtime-gateway';
import { createServiceClient } from '../supabase/service';
import { createRuntimeAttemptPaymentGateway } from '../subscriptions/payment-dispatch.server';

export type CancellationRequestStatus =
  | 'requested'
  | 'processing'
  | 'needs_review'
  | 'completed'
  | 'rejected';

export type CancellationPaymentStatus =
  | 'pending'
  | 'paid'
  | 'canceled'
  | 'failed'
  | 'refunded';

export type CancellationPaymentProvider = PaymentCheckoutProvider;

export interface CancellationReconciliationContext {
  requestId: string;
  orderId: string;
  status: CancellationRequestStatus;
  payments: Array<{
    id: string;
    provider: CancellationPaymentProvider;
    status: CancellationPaymentStatus;
    amount: number;
    paymentKey: string | null;
    /**
     * durable 환불 원장이 이 결제를 계좌 송금으로 접수했는가
     * (refunds.method='bank_transfer'). 환불계좌는 카드 주문에도 fallback 안전망으로
     * 수집되므로 provider와 무관하게 참일 수 있다 — 참이면 운영자가 이미 송금했을
     * 수 있어 카드 취소 API를 추가로 발행하면 이중 환불이 된다.
     */
    bankTransferRefundFiled: boolean;
  }>;
}

/**
 * 게이트웨이 refund가 needs_review·unknown 등으로 돌려준 사유 코드(`provider_*`).
 *
 * 그대로 needs_review 사유(`last_error_code`)와 감사 로그에 남긴다. 사유마다 운영
 * 조치가 다르다 — 취소 거절은 원인 해소 뒤 수동 복구로 닫히지만, 상점(MID) 불일치·결제
 * 대조 실패는 상점관리자에서 취소해도 다음 조회가 같은 결과라 닫히지 않는다
 * (docs/runbooks/order-claim-intake.md "결제확인필요 재시도와 멱등키"). 게이트웨이가
 * 정규화한 내부 코드만 담고 provider 원문 코드(evidence.resultCode)는 옮기지 않는다.
 */
export type ProviderRefundReviewCode = `provider_${string}`;

/* provider_* 코드 일부는 더 이상 새로 기록되지 않지만, 과거 요청 행이 이미
 * 이 코드들을 담고 있어 DB 계약과 읽기 표면을 위해 유지한다.
 * provider_cancel_failed는 2026-10-12부터 게이트웨이 사유 코드가 없거나 형식 밖일 때의
 * 대체 코드다 — 그 전 행에는 모든 명시 거절이 이 코드로 남아 있다. */
export type CancellationReconciliationCode =
  | 'request_not_found'
  | 'request_not_ready'
  | 'local_state_unavailable'
  | 'payment_evidence_invalid'
  | 'provider_unavailable'
  | 'provider_mismatch'
  | 'provider_cancel_failed'
  | 'provider_cancellation_incomplete'
  | 'bank_transfer_refund_filed'
  | 'local_finalize_failed'
  | ProviderRefundReviewCode;

export type CancellationReconciliationResult =
  | { ok: true; status: 'completed' | 'already_completed' | 'in_progress' }
  | { ok: false; code: CancellationReconciliationCode };

export type ExpiredPreparedGoodsReconciliation =
  | 'completed'
  | 'in_progress'
  | 'not_applicable';

export type CancellationReconciliationPreflight = 'allowed' | 'completed' | 'not_allowed';

/**
 * 정합화를 실행하는 주체. 문자열은 staff/admin 사용자 id, null은 시스템(서버 자동
 * 발행)이다 — 고객이 연 자동 승인처럼 사람이 누르지 않은 취소를 서버가 바로 닫을 때만
 * 쓴다. DB는 null actor를 취소(claim_type='cancel') 요청에만 허용하고 감사 로그를
 * system.order.* 액션으로 남긴다(20261013110000).
 */
export type CancellationActorId = string | null;

export interface CancellationReconciliationDependencies {
  loadContext(requestId: string): Promise<CancellationReconciliationContext | null>;
  preflightReconciliation(input: {
    requestId: string;
    actorId: CancellationActorId;
  }): Promise<CancellationReconciliationPreflight>;
  reconcileExpiredPreparedGoods(input: {
    requestId: string;
    actorId: CancellationActorId;
  }): Promise<ExpiredPreparedGoodsReconciliation>;
  /**
   * toss 유상 캡처의 전액 취소. 게이트웨이가 취소 API 발행 후 fresh 조회로
   * 전액 취소를 검증한 결과(5-outcome)를 그대로 돌려준다(#389).
   */
  refundTossPayment(input: {
    paymentId: string;
    amount: number;
    reason: string;
    /** 원장 `payments.payment_key` — 게이트웨이가 이 키로 조회·취소한다. */
    paymentKey: string;
  }): Promise<RefundOutcome>;
  completeRequest(input: {
    requestId: string;
    actorId: CancellationActorId;
    verifiedPaymentKeys: string[];
  }): Promise<void>;
  markNeedsReview(input: {
    requestId: string;
    actorId: CancellationActorId;
    code: CancellationReconciliationCode;
  }): Promise<void>;
}

const REQUEST_STATUSES = new Set<CancellationRequestStatus>([
  'requested',
  'processing',
  'needs_review',
  'completed',
  'rejected',
]);
const PAYMENT_STATUSES = new Set<CancellationPaymentStatus>([
  'pending',
  'paid',
  'canceled',
  'failed',
  'refunded',
]);
const PREFLIGHT_REJECTIONS = new Set([
  'claim_collections_incomplete',
  'cancellation_request_not_processing',
  'claim_on_hold',
  'order_not_cancelable',
  'staff required',
  'cancellation_request_not_found',
]);
/*
 * 보존할 게이트웨이 사유 코드의 형식. DB `last_error_code` 검사(`^[a-z0-9_]{1,64}$`)
 * 안쪽이면서 `provider_` 접두가 붙은 내부 코드만 받는다 — 대문자 provider 원문 코드나
 * 길이 밖 값은 DB가 거부해 needs_review 전이 자체가 실패하므로 대체 코드로 바꾼다.
 */
const PROVIDER_REFUND_REVIEW_CODE = /^provider_[a-z0-9_]{1,55}$/;

/**
 * 완료로 닫지 못한 refund 결과의 needs_review 사유.
 *
 * 게이트웨이 사유 코드를 그대로 쓴다. 사유가 없거나 형식 밖이면 종전 대체 코드로
 * 남긴다 — 모호(unknown)는 provider_unavailable, 그 밖은 provider_cancel_failed.
 * approved인데 금액이 맞지 않는 결과는 사유 코드가 '취소 확인'이라 옮기면 오해를
 * 부르므로 대체 코드로 남긴다.
 */
function refundReviewCode(refund: RefundOutcome): CancellationReconciliationCode {
  if (
    refund.outcome !== 'approved'
    && typeof refund.reasonCode === 'string'
    && PROVIDER_REFUND_REVIEW_CODE.test(refund.reasonCode)
  ) {
    return refund.reasonCode as ProviderRefundReviewCode;
  }
  return refund.outcome === 'unknown' ? 'provider_unavailable' : 'provider_cancel_failed';
}

function createDefaultDependencies(): CancellationReconciliationDependencies {
  const service = createServiceClient();

  return {
    async preflightReconciliation(input) {
      const { data, error } = await service.rpc('assert_order_cancellation_reconciliation_allowed', {
        p_request_id: input.requestId,
        p_actor_id: input.actorId,
      });
      if (error && PREFLIGHT_REJECTIONS.has(error.message)) return 'not_allowed';
      if (error || (data !== 'allowed' && data !== 'completed')) {
        throw new Error('cancellation preflight unavailable');
      }
      return data;
    },
    async loadContext(requestId) {
      const { data: requestData, error: requestError } = await service
        .from('order_cancellation_requests')
        .select('id,order_id,status')
        .eq('id', requestId)
        .maybeSingle();

      if (requestError) throw new Error('cancellation request lookup failed');
      if (!requestData) return null;

      const request = requestData as Record<string, unknown>;
      if (
        typeof request.id !== 'string'
        || typeof request.order_id !== 'string'
        || typeof request.status !== 'string'
        || !REQUEST_STATUSES.has(request.status as CancellationRequestStatus)
      ) {
        throw new Error('invalid cancellation request state');
      }

      // 카드 provider 원장만 본다(무통장 환불은 별도 계좌 환불 경로 — ADR-0010).
      // toss는 취소 API 자동화 경로(#389), korpay는 수동 복구 seam이 정합화 경로다.
      const { data: paymentData, error: paymentError } = await service
        .from('payments')
        .select('id,provider,status,amount,payment_key')
        .in('provider', ['toss', 'korpay'])
        .eq('purpose', 'order')
        .eq('ref_id', request.order_id)
        .order('id', { ascending: true });

      if (paymentError) throw new Error('cancellation payment lookup failed');

      const paymentRows = (paymentData ?? []).map((paymentDataRow) => {
        const payment = paymentDataRow as Record<string, unknown>;
        if (
          typeof payment.id !== 'string'
          || (payment.provider !== 'toss' && payment.provider !== 'korpay')
          || typeof payment.status !== 'string'
          || !PAYMENT_STATUSES.has(payment.status as CancellationPaymentStatus)
          || typeof payment.amount !== 'number'
          || !Number.isSafeInteger(payment.amount)
          || (payment.payment_key !== null && typeof payment.payment_key !== 'string')
        ) {
          throw new Error('invalid cancellation payment state');
        }
        return {
          id: payment.id,
          provider: payment.provider as CancellationPaymentProvider,
          status: payment.status as CancellationPaymentStatus,
          amount: payment.amount,
          paymentKey: payment.payment_key as string | null,
        };
      });

      /*
       * durable 환불 원장의 수단을 함께 읽는다.
       *
       * admin_record_order_claim_refund의 filed 단계가 refunds.method를
       * first-write-wins로 적는다. 'bank_transfer'가 적혀 있으면 운영자가 환불계좌로
       * 송금하는 흐름을 이미 시작한 것이고, 여기서 카드 취소까지 발행하면 구매자가
       * 두 번 환불받는다. refunds에는 unique(payment_id)가 있어 결제당 최대 한 줄이다.
       */
      const bankTransferPaymentIds = new Set<string>();
      if (paymentRows.length > 0) {
        const { data: refundData, error: refundError } = await service
          .from('refunds')
          .select('payment_id,method')
          .in('payment_id', paymentRows.map((payment) => payment.id))
          .order('payment_id', { ascending: true });

        if (refundError) throw new Error('cancellation refund ledger lookup failed');

        for (const refundDataRow of refundData ?? []) {
          const refund = refundDataRow as Record<string, unknown>;
          if (
            typeof refund.payment_id !== 'string'
            || (refund.method !== null && typeof refund.method !== 'string')
          ) {
            throw new Error('invalid cancellation refund ledger state');
          }
          if (refund.method === 'bank_transfer') bankTransferPaymentIds.add(refund.payment_id);
        }
      }

      const payments = paymentRows.map((payment) => ({
        ...payment,
        bankTransferRefundFiled: bankTransferPaymentIds.has(payment.id),
      }));

      return {
        requestId: request.id,
        orderId: request.order_id,
        status: request.status as CancellationRequestStatus,
        payments,
      };
    },
    async refundTossPayment({ paymentId, amount, reason, paymentKey }) {
      const { data, error } = await service
        .from('payment_attempts')
        .select('id,provider,purpose,ref_id,amount,currency,idempotency_key,provider_order_id,provider_product_code,expires_at')
        .eq('payment_id', paymentId)
        .maybeSingle();
      if (error) throw new Error('payment attempt lookup failed');
      // provider-neutral 원장 이전(라이브 첫날) 결제는 attempt 행이 없을 수 있다
      // — 자동 취소 근거가 없으므로 수동 검토로 승격시킨다.
      if (!data) throw new Error('payment attempt missing');
      const row = data as Record<string, unknown>;
      if (
        row.provider !== 'toss'
        || row.purpose !== 'order'
        || typeof row.id !== 'string'
        || typeof row.ref_id !== 'string'
        || typeof row.amount !== 'number'
        || row.amount !== amount
        || typeof row.currency !== 'string'
        || typeof row.idempotency_key !== 'string'
        || typeof row.provider_order_id !== 'string'
        || typeof row.provider_product_code !== 'string'
        || typeof row.expires_at !== 'string'
      ) {
        throw new Error('invalid payment attempt state');
      }
      const attempt: PaymentAttempt = {
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
      return createRuntimeAttemptPaymentGateway(service, 'toss', getPaymentGateway('toss')).refund({
        attempt,
        idempotencyKey: `refund:${attempt.id}`,
        amount,
        reason,
        // 원장 결제 키로 조회·취소한다 — paymentKey 조회는 주문서형 시크릿 키(gsk)에
        // 명시된 조회이고 orderId 조회는 아니다(토스 공식문서 122). 게이트웨이가 조회
        // 응답의 키·주문·상점(MID)을 다시 대조한다.
        providerPaymentKey: paymentKey,
      });
    },
    async reconcileExpiredPreparedGoods({ requestId, actorId }) {
      const { data, error } = await service.rpc(
        'reconcile_expired_prepared_goods_cancellation',
        {
          p_actor_id: actorId,
          p_request_id: requestId,
        },
      );
      if (error
        || (data !== 'completed'
          && data !== 'in_progress'
          && data !== 'not_applicable')
      ) {
        throw new Error('prepared goods cancellation reconciliation failed');
      }
      return data;
    },
    async completeRequest({ requestId, actorId, verifiedPaymentKeys }) {
      const { error } = await service.rpc('complete_order_cancellation_request', {
        p_request_id: requestId,
        p_provider_payment_keys: verifiedPaymentKeys,
        p_actor_id: actorId,
      });
      if (error) throw new Error('cancellation completion failed');
    },
    async markNeedsReview({ requestId, actorId, code }) {
      const { error } = await service.rpc('mark_order_cancellation_needs_review', {
        p_request_id: requestId,
        p_actor_id: actorId,
        p_error_code: code,
      });
      if (error) throw new Error('cancellation review transition failed');
    },
  };
}

async function markNeedsReview(
  dependencies: CancellationReconciliationDependencies,
  input: { requestId: string; actorId: CancellationActorId },
  code: CancellationReconciliationCode,
): Promise<CancellationReconciliationResult> {
  try {
    await dependencies.markNeedsReview({ ...input, code });
    return { ok: false, code };
  } catch {
    return { ok: false, code: 'local_finalize_failed' };
  }
}

/**
 * 승인된 주문 취소 요청을 정합화한다. 호출자는 인증된 actor/request id만
 * 전달하며 결제 키·금액은 service DB에서만 읽는다.
 *
 * toss 유상 캡처는 게이트웨이 refund(취소 API 발행 + fresh 조회 검증)로 자동
 * 취소하고, 검증된 키만 완료 RPC에 넘긴다(#389). korpay 유상 캡처는 취소 API가
 * 없어 수동 복구 seam(goods-manual-recovery)이 정상 경로이므로 여기서는 수동
 * 검토로 승격한다. 실패·모호는 자동 종결하지 않는다.
 *
 * 승인 직후 서버가 곧바로 부르는 것이 정상 경로다 — 고객 자동 승인은
 * cancellation-auto.server.ts가 시스템 actor(null)로, 클레임 콘솔·주문 콘솔 승인과
 * 운영자 전액 취소는 그 staff actor로 부른다. 클레임 상세의 '환불 완료 확정'과 주문
 * 패널의 '처리 상태 확인'·'상태 다시 확인'은 같은 함수를 다시 부르는 재시도 표면이다.
 */
export async function reconcileOrderCancellation(
  input: { requestId: string; actorId: CancellationActorId },
  providedDependencies?: CancellationReconciliationDependencies,
): Promise<CancellationReconciliationResult> {
  let dependencies: CancellationReconciliationDependencies;
  try {
    dependencies = providedDependencies ?? createDefaultDependencies();
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }

  let context: CancellationReconciliationContext | null;
  try {
    context = await dependencies.loadContext(input.requestId);
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }

  if (!context) return { ok: false, code: 'request_not_found' };
  if (context.status === 'completed') return { ok: true, status: 'already_completed' };
  if (context.status !== 'processing' && context.status !== 'needs_review') {
    return { ok: false, code: 'request_not_ready' };
  }

  // Approval can predate the current intake policy, or a claim can be held after
  // the context read. The DB rechecks the actor, order and collection snapshots
  // under the shared locks before any provider call or no-capture completion.
  let preflight: CancellationReconciliationPreflight;
  try {
    preflight = await dependencies.preflightReconciliation(input);
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }
  if (preflight === 'completed') return { ok: true, status: 'already_completed' };
  if (preflight !== 'allowed') return { ok: false, code: 'request_not_ready' };

  // A Korpay prepared session has no provider capture to cancel. Its durable
  // action TTL decides when stock can be released, and the service-only RPC
  // owns that exact expiry check under the money locks.
  let preparedGoods: ExpiredPreparedGoodsReconciliation;
  try {
    preparedGoods = await dependencies.reconcileExpiredPreparedGoods(input);
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }
  if (preparedGoods === 'completed') return { ok: true, status: 'completed' };
  if (preparedGoods === 'in_progress') return { ok: true, status: 'in_progress' };
  // needs_review is admitted only for the dedicated no-capture decision above.
  // Anything else still requires admin_begin... to have restored the request
  // to processing before completion.
  if (context.status !== 'processing') return { ok: false, code: 'request_not_ready' };

  const verifiedPaymentKeys: string[] = [];
  for (const payment of context.payments) {
    if (payment.status === 'failed') continue;
    if (
      typeof payment.paymentKey !== 'string'
      || !payment.paymentKey
      || !Number.isSafeInteger(payment.amount)
      || payment.amount <= 0
    ) {
      return markNeedsReview(dependencies, input, 'payment_evidence_invalid');
    }
    if (payment.provider !== 'toss') {
      // korpay는 취소 API가 없다 — 수동 복구 seam(운영자 확인)이 정상 경로다.
      return markNeedsReview(dependencies, input, 'provider_unavailable');
    }
    /*
     * 계좌 송금으로 접수된 건에는 카드 취소를 발행하지 않는다.
     *
     * 환불계좌는 카드 주문에도 fallback 안전망으로 수집되므로 toss 결제에도
     * refunds.method='bank_transfer'가 붙을 수 있다. 운영자가 이미 송금했는데
     * 취소 API까지 나가면 구매자가 두 번 환불받는다 — 되돌리기 어려운 쪽이라
     * 발행 전에 격리한다. 이 건을 어떻게 종결할지(운영자 확인 vs 접수 취소)는
     * 여기서 추측하지 않는다.
     */
    if (payment.bankTransferRefundFiled) {
      return markNeedsReview(dependencies, input, 'bank_transfer_refund_filed');
    }

    let refund: RefundOutcome;
    try {
      refund = await dependencies.refundTossPayment({
        paymentId: payment.id,
        amount: payment.amount,
        reason: 'ICONS 주문 취소',
        paymentKey: payment.paymentKey,
      });
    } catch {
      return markNeedsReview(dependencies, input, 'provider_unavailable');
    }
    if (refund.outcome === 'approved' && refund.refundedAmount === payment.amount) {
      /*
       * provider가 취소를 검증해 준 결제와 로컬 원장의 결제가 같은 건인지 대조한다.
       *
       * 게이트웨이의 취소 검증은 orderId·통화·금액·잔액만 본다. 이 대조가 없으면
       * 완료 근거가 순환한다 — 로컬 키를 verified 배열에 넣고 완료 RPC가 그 배열을
       * 다시 로컬 키와 맞춰보는 꼴이라, provider가 같은 orderId에 다른 paymentKey를
       * 돌려주는 이상 상황이 검증 없이 통과한다. 증거 키가 없어도 마찬가지로
       * 격리한다 — 없는 증거는 일치의 근거가 아니다.
       */
      if (refund.evidence?.providerPaymentKey !== payment.paymentKey) {
        return markNeedsReview(dependencies, input, 'provider_mismatch');
      }
      verifiedPaymentKeys.push(payment.paymentKey);
      continue;
    }
    // 거절·모호 결과는 어느 쪽도 돈이 걸린 판단을 추측으로 종결하지 않는다. 사유는
    // 게이트웨이 코드를 그대로 남긴다 — 운영자는 이 코드로 런북의 조치를 고른다.
    return markNeedsReview(dependencies, input, refundReviewCode(refund));
  }

  try {
    await dependencies.completeRequest({
      requestId: input.requestId,
      actorId: input.actorId,
      verifiedPaymentKeys,
    });
  } catch {
    return markNeedsReview(dependencies, input, 'local_finalize_failed');
  }

  return { ok: true, status: 'completed' };
}
