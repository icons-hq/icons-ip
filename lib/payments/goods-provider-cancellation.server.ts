import 'server-only';

import type { PaymentAttempt, PaymentBalanceInspection } from './gateway';

/**
 * 결제사 직접 취소 감지(원장 OPS-065·CLM-051). 운영자가 토스 상점관리자에서 결제를 취소하면 우리 원장은 모른다 —
 * 종결(approved) 결제에 웹훅이 오면 본문을 믿지 않고 원장의 결제 키로 결제사 잔액을 조회(돈·원장을 바꾸지 않는 조회)한 뒤,
 * 결제사 취소 금액 중 우리 원장이 설명하지 못하는 몫이 있으면 DB가 주문을 출고 보류한다(service_flag_goods_provider_cancellation).
 *
 * 판정:
 *  - held · already_recorded · consistent · not_applicable · mismatch — 재전송해도 같은 결과라 200으로 닫는다.
 *  - in_flight — 우리가 결제사 취소를 냈을 수 있는 처리(취소·반품 요청 처리 중·결제확인필요, 취소 claim, 처리 중 부분 취소, 환불 대기)가
 *    진행 중이다. DB가 관측을 대기 기록에 남기고 그 처리가 끝나면 5분 주기 sweep이 다시 판정한다. 웹훅 재전송(1·4·16분…)도 받는다.
 *  - cooldown — 같은 결제를 2분 안에 이미 조회했다(서명 없는 위조 웹훅의 조회 폭주 방지). 조회하지 않고, 라우트가 503으로 남겨
 *    진짜 웹훅이면 쿨다운 뒤 재전송이 다시 본다(200으로 닫으면 쿨다운 직후의 진짜 취소 웹훅을 놓친다).
 *  - 조회 일시 실패·DB 실패는 throw — 라우트가 5xx로 남겨 재전송을 받는다.
 */
export type GoodsProviderCancellationVerdict =
  | 'held' | 'already_recorded' | 'consistent' | 'in_flight' | 'not_applicable' | 'mismatch' | 'cooldown';

const DATABASE_VERDICTS = new Set<GoodsProviderCancellationVerdict>(['held', 'already_recorded', 'consistent', 'in_flight', 'not_applicable']);

export class GoodsProviderCancellationCheckError extends Error {
  constructor(readonly code: 'context_failed' | 'provider_unavailable' | 'record_failed') {
    super(`goods_provider_cancellation_${code}`);
    this.name = 'GoodsProviderCancellationCheckError';
  }
}

export interface GoodsProviderCancellationContext {
  readonly attempt: PaymentAttempt;
  readonly paymentKey: string;
}

export interface GoodsProviderCancellationDependencies {
  /**
   * 대상(토스 굿즈 승인 + 원장 paid + 결제 키 + 주문 미취소)이면 시도와 원장 결제 키, 아니면 null. 2분 안에 이미 조회한 결제면
   * 'cooldown'이다(조회 차례를 잡으면 DB가 마지막 조회 시각을 적는다).
   */
  readonly loadContext: (attemptId: string) => Promise<GoodsProviderCancellationContext | 'cooldown' | null>;
  /** 원장 결제 키로 결제사 잔액을 조회한다(상점·키·주문·총액 대조는 어댑터가 한다). */
  readonly inspect: (attempt: PaymentAttempt, paymentKey: string) => Promise<PaymentBalanceInspection>;
  readonly record: (input: {
    readonly attemptId: string;
    readonly providerStatus: string;
    readonly providerBalance: number;
    readonly caseRef: string;
  }) => Promise<GoodsProviderCancellationVerdict>;
}

const PROVIDER_STATUS = /^[A-Z_]{1,40}$/;

export function createGoodsProviderCancellationCheck(dependencies: GoodsProviderCancellationDependencies) {
  return async function checkGoodsProviderCancellation(input: {
    readonly attemptId: string;
    readonly caseRef: string;
  }): Promise<GoodsProviderCancellationVerdict> {
    let context: GoodsProviderCancellationContext | 'cooldown' | null;
    try {
      context = await dependencies.loadContext(input.attemptId);
    } catch {
      throw new GoodsProviderCancellationCheckError('context_failed');
    }
    if (!context) return 'not_applicable';
    if (context === 'cooldown') return 'cooldown';

    let inspection: PaymentBalanceInspection;
    try {
      inspection = await dependencies.inspect(context.attempt, context.paymentKey);
    } catch {
      throw new GoodsProviderCancellationCheckError('provider_unavailable');
    }
    if (inspection.kind === 'unavailable') throw new GoodsProviderCancellationCheckError('provider_unavailable');
    // 정기배송 결제(binding)·조회를 지원하지 않는 결제사는 이 감지의 대상이 아니다.
    if (inspection.kind === 'not_supported') return 'not_applicable';
    // 결제사 응답이 이 결제(상점·키·주문·총액)와 맞지 않는다 — 재전송해도 같다. 판정 근거로 쓰지 않고 남긴다.
    if (inspection.kind !== 'ok' || !PROVIDER_STATUS.test(inspection.status)
      || !Number.isSafeInteger(inspection.balanceAmount) || inspection.balanceAmount < 0) {
      console.error(`[payments/goods] provider cancellation check mismatch (attempt:${context.attempt.id})`);
      return 'mismatch';
    }

    let verdict: GoodsProviderCancellationVerdict;
    try {
      verdict = await dependencies.record({
        attemptId: context.attempt.id,
        providerStatus: inspection.status,
        providerBalance: inspection.balanceAmount,
        caseRef: input.caseRef,
      });
    } catch {
      throw new GoodsProviderCancellationCheckError('record_failed');
    }
    if (!DATABASE_VERDICTS.has(verdict)) throw new GoodsProviderCancellationCheckError('record_failed');
    if (verdict === 'held') {
      console.warn(`[payments/goods] provider cancellation held order fulfillment (attempt:${context.attempt.id})`);
    }
    return verdict;
  };
}

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

function parseContext(value: unknown): GoodsProviderCancellationContext | 'cooldown' | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_context');
  const record = value as Record<string, unknown>;
  if (record.status === 'cooldown') return 'cooldown';
  if (record.status !== 'proceed') throw new Error('invalid_context');
  const attempt = record.attempt as Record<string, unknown> | undefined;
  if (!attempt || typeof attempt !== 'object' || typeof record.paymentKey !== 'string' || !record.paymentKey
    || typeof attempt.id !== 'string' || attempt.provider !== 'toss' || attempt.purpose !== 'order'
    || typeof attempt.ref_id !== 'string' || !Number.isSafeInteger(attempt.amount) || typeof attempt.currency !== 'string'
    || typeof attempt.idempotency_key !== 'string' || typeof attempt.provider_order_id !== 'string'
    || typeof attempt.provider_product_code !== 'string' || typeof attempt.expires_at !== 'string') {
    throw new Error('invalid_context');
  }
  return {
    paymentKey: record.paymentKey,
    attempt: {
      id: attempt.id,
      provider: 'toss',
      purpose: 'order',
      refId: attempt.ref_id,
      amount: attempt.amount as number,
      currency: attempt.currency,
      idempotencyKey: attempt.idempotency_key,
      providerOrderId: attempt.provider_order_id,
      providerProductCode: attempt.provider_product_code,
      expiresAt: attempt.expires_at,
    },
  };
}

/** service_role RPC 둘(조회 차례 잡기·결제 키 읽기 / 대조 기록). 게이트웨이 조회는 호출자가 고른다. */
export function createGoodsProviderCancellationRepository(client: RpcClient) {
  return {
    async loadContext(attemptId: string) {
      const { data, error } = await client.rpc('service_begin_goods_provider_cancellation_check', { p_attempt_id: attemptId });
      if (error) throw new Error('context_lookup_failed');
      return parseContext(data);
    },
    async record(input: { attemptId: string; providerStatus: string; providerBalance: number; caseRef: string }) {
      const { data, error } = await client.rpc('service_flag_goods_provider_cancellation', {
        p_attempt_id: input.attemptId,
        p_provider_status: input.providerStatus,
        p_provider_balance: input.providerBalance,
        p_case_ref: input.caseRef,
      });
      if (error) throw new Error('record_failed');
      return data as GoodsProviderCancellationVerdict;
    },
  };
}
