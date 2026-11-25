import 'server-only';

/*
 * 가상계좌 은행 환불 감시(ADR-0049 결정 5, 2026-11-23 보강).
 *
 * 가상계좌 환불은 취소 API가 CANCELED를 돌려준 뒤 은행이 취소일 + 2일에 구매자 계좌로 입금한다(결제 취소 가이드 Case 1). 그 사이 송금이
 * 실패하면(virtualAccount.refundStatus — NONE·PENDING·FAILED·PARTIAL_FAILED·COMPLETED) 돈이 구매자에게 가지 않았는데 주문은 환불 완료로
 * 닫혀 있다. 무엇을 언제 볼지는 DB가 정하고(private.virtual_account_refund_watches), 이 모듈은 원장 결제 키로 결제를 조회해 결과를
 * 분류만 한다. 조회 응답 원문·계좌 정보는 남기지 않는다(refundStatus 표지만).
 *
 *  - completed: 이 결제가 원장대로 취소됐고(전액 취소, 또는 부분 환불 뒤 원장 잔액 — 2026-11-25) 은행 송금이 끝났다(COMPLETED).
 *  - failed: 은행 송금이 실패했다(FAILED·PARTIAL_FAILED).
 *  - pending: 아직 송금 전(PENDING·NONE·그 밖) — DB가 7일을 넘기면 지연으로 올린다.
 *  - mismatch: 원장의 결제가 아니거나(키·주문·금액) 전액 취소 상태가 아니다 — 운영자가 결제를 확인해야 한다.
 *  - unavailable: 전송 실패·5xx·요청 제한·키 오류 — 상태를 바꾸지 않고 다음 회차에 다시 본다.
 *
 * 에스크로 구매자 취소 환불(2026-11-24 보강): 에스크로 취소 요청 수락(POST /v2/escrows/{id}/cancel)은 구매자가 취소 요청 때 토스에
 * 등록한 계좌로 토스가 환불하고, 그 뒤 refundStatus가 갱신되는지는 공식 문서에 없다. 그래서 송금 상태가 NONE이거나 값이 없는 에스크로
 * 결제(`useEscrow: true`)는 거래 조회 GET /v2/escrows/{escrowKey}(부가서비스 API라 에스크로 키)로 구매자 취소 수락(status CANCELED ·
 * cancelType CUSTOMER, targetId = 이 결제 키)인지 확인해 escrowBuyerCanceled로 넘긴다. 무엇을 할지(7일 뒤 완료로 닫기)는 DB가 정한다.
 *  - true: 구매자 취소 수락으로 끝난 거래 / false: 확인했는데 아니다(진행 중·확정·결제 취소로 함께 끝남·다른 결제)
 *  - null: 확인하지 않았거나 못 했다 — DB는 지금 판정을 따른다(7일째면 지연 알림). 지연으로 오른 감시도 6시간마다 다시 보므로 뒤
 *    회차에 확인되면 DB가 닫는다. 그래서 거래 조회 실패가 결제 조회 결과를 미루지 않는다(자동 재확인 회차 전체가 실패로 남지 않게).
 *    확인이 필요했는데 못 한 경우(에스크로 키 없음·거래 id 없음·전송 실패·5xx·요청 제한·4xx·형식 오류)는 escrowLookupFailed로 알린다.
 * 형식 밖 송금 상태 값은 송금 상태가 없는 것으로 보지 않는다(거래를 조회하지 않는다).
 */

const TOSS_API_ORIGIN = 'https://api.tosspayments.com';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const PAYMENT_KEY = /^[\x21-\x7e]{1,200}$/;
const OPAQUE_ID = /^[\x21-\x7e]{1,64}$/;
const REFUND_STATUS = /^[A-Z_]{1,32}$/;

export interface VirtualAccountRefundWatch {
  readonly attemptId: string;
  readonly orderId: string;
  readonly paymentKey: string;
  readonly providerOrderId: string;
  readonly amount: number;
  /**
   * 결제사에 남아야 할 잔액(2026-11-25 — 입금된 가상계좌의 부분 취소·부분 반품). 0(없음)이면 전액 환불이라 CANCELED·잔액 0이어야 하고,
   * 0보다 크면 부분 환불 뒤라 PARTIAL_CANCELED·그 잔액이어야 한다. DB(service_claim_virtual_account_refund_watches)가 원장에서 계산한다.
   */
  readonly expectedBalance?: number;
}

export interface VirtualAccountRefundClassification {
  readonly outcome: 'completed' | 'pending' | 'failed' | 'mismatch' | 'unavailable';
  readonly refundStatus: string | null;
}

export interface VirtualAccountRefundInspection extends VirtualAccountRefundClassification {
  /** 에스크로 거래가 구매자 취소 수락으로 끝났는가(송금 상태가 NONE·값 없음인 에스크로 결제만 확인). 확인하지 않았거나 못 했으면 null. */
  readonly escrowBuyerCanceled: boolean | null;
  /** 에스크로 거래를 확인해야 했는데 못 했다(키 없음·조회 실패·형식 오류). */
  readonly escrowLookupFailed: boolean;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function classifyVirtualAccountRefund(watch: VirtualAccountRefundWatch, payment: unknown): VirtualAccountRefundClassification {
  if (!plainRecord(payment)) return { outcome: 'unavailable', refundStatus: null };
  const account = plainRecord(payment.virtualAccount) ? payment.virtualAccount : null;
  const refundStatus = account && typeof account.refundStatus === 'string' && REFUND_STATUS.test(account.refundStatus)
    ? account.refundStatus
    : null;
  if (
    payment.paymentKey !== watch.paymentKey
    || payment.orderId !== watch.providerOrderId
    || payment.totalAmount !== watch.amount
    || !account
  ) {
    return { outcome: 'mismatch', refundStatus };
  }
  // 우리 원장의 환불(전액 또는 부분)과 결제사 잔액이 다르면(DONE·다른 잔액) 송금 상태와 별개로 운영자가 봐야 한다.
  const expected = watch.expectedBalance ?? 0;
  if (expected === 0 ? payment.status !== 'CANCELED' || payment.balanceAmount !== 0
    : payment.status !== 'PARTIAL_CANCELED' || payment.balanceAmount !== expected) return { outcome: 'mismatch', refundStatus };
  if (refundStatus === 'COMPLETED') return { outcome: 'completed', refundStatus };
  if (refundStatus === 'FAILED' || refundStatus === 'PARTIAL_FAILED') return { outcome: 'failed', refundStatus };
  return { outcome: 'pending', refundStatus };
}

/** 거래 조회 응답(v2 `{ entityBody }`)이 이 결제의 구매자 취소 수락으로 끝난 거래인가. */
export function escrowCanceledByBuyer(watch: VirtualAccountRefundWatch, payload: unknown): boolean | null {
  if (!plainRecord(payload)) return null;
  const escrow = plainRecord(payload.entityBody) ? payload.entityBody : payload;
  if (typeof escrow.status !== 'string') return null;
  if (escrow.targetId !== watch.paymentKey || (escrow.targetType !== undefined && escrow.targetType !== 'PAYMENT')) return false;
  return escrow.status === 'CANCELED' && escrow.cancelType === 'CUSTOMER';
}

export function createTossVirtualAccountRefundInspector(options: {
  /** 결제 시크릿 키(gsk) — paymentKey로 결제 조회(코어 API). */
  readonly secretKey: string;
  /** 에스크로 부가서비스 API 키(API 개별 연동 sk) — 거래 조회. 없으면 에스크로 구매자 취소를 확인하지 않는다. */
  readonly escrowSecretKey?: string | null;
  readonly fetch?: typeof fetch;
}) {
  const fetchImpl = options.fetch ?? fetch;
  const basic = (key: string) => `Basic ${Buffer.from(`${key}:`, 'utf8').toString('base64')}`;
  const authorization = basic(options.secretKey);
  const escrowAuthorization = options.escrowSecretKey ? basic(options.escrowSecretKey) : null;

  /** 조회 한 번. 전송 실패·시간 초과·응답이 너무 크면 null, JSON이 아니면 payload undefined. */
  async function get(path: string, credential: string): Promise<{ status: number; payload: unknown; parsed: boolean } | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(new URL(path, TOSS_API_ORIGIN).toString(), {
        method: 'GET',
        headers: { authorization: credential, accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      const body = await response.text();
      if (body.length > MAX_RESPONSE_BYTES) return null;
      try {
        return { status: response.status, payload: body ? JSON.parse(body) : undefined, parsed: true };
      } catch {
        return { status: response.status, payload: undefined, parsed: false };
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 송금 상태가 없는 에스크로 결제의 거래가 구매자 취소 수락으로 끝났는지. 확인하지 못하면 null과 실패 표지. */
  async function escrowBuyerCanceled(
    watch: VirtualAccountRefundWatch,
    payment: Record<string, unknown>,
  ): Promise<{ readonly value: boolean | null; readonly failed: boolean }> {
    const unconfirmed = { value: null, failed: true } as const;
    if (payment.useEscrow !== true) return { value: null, failed: false };
    const escrowKey = payment.escrowKey;
    if (escrowAuthorization === null || typeof escrowKey !== 'string' || !OPAQUE_ID.test(escrowKey)) return unconfirmed;
    const response = await get(`/v2/escrows/${encodeURIComponent(escrowKey)}`, escrowAuthorization);
    // 전송 실패·5xx·요청 제한·키 거절·없는 거래(4xx)·형식 오류 — 확인하지 못했다. 지금 판정을 따르고 뒤 회차에 다시 본다.
    if (!response || response.status !== 200 || !response.parsed) return unconfirmed;
    const value = escrowCanceledByBuyer(watch, response.payload);
    return value === null ? unconfirmed : { value, failed: false };
  }

  return {
    async inspect(watch: VirtualAccountRefundWatch): Promise<VirtualAccountRefundInspection> {
      const settled = (classification: VirtualAccountRefundClassification): VirtualAccountRefundInspection =>
        ({ ...classification, escrowBuyerCanceled: null, escrowLookupFailed: false });
      if (!PAYMENT_KEY.test(watch.paymentKey)) return settled({ outcome: 'mismatch', refundStatus: null });
      const response = await get(`/v1/payments/${encodeURIComponent(watch.paymentKey)}`, authorization);
      if (!response) return settled({ outcome: 'unavailable', refundStatus: null });
      // 원장이 아는 결제 키로 찾지 못했다 — 우리 기록과 결제사 기록이 어긋났다.
      if (response.status === 404) return settled({ outcome: 'mismatch', refundStatus: null });
      if (response.status !== 200 || !response.parsed) return settled({ outcome: 'unavailable', refundStatus: null });
      const classification = classifyVirtualAccountRefund(watch, response.payload);
      const payment = response.payload;
      // 송금 상태가 NONE이거나 값이 없을 때만(형식 밖 값은 아니다) 토스가 이 환불의 송금을 알리지 않는 것으로 본다.
      const reported = plainRecord(payment) && plainRecord(payment.virtualAccount) ? payment.virtualAccount.refundStatus : undefined;
      const untracked = reported === undefined || reported === null || reported === 'NONE';
      if (classification.outcome !== 'pending' || !untracked || !plainRecord(payment)) return settled(classification);
      const escrow = await escrowBuyerCanceled(watch, payment);
      return { ...classification, escrowBuyerCanceled: escrow.value, escrowLookupFailed: escrow.failed };
    },
  };
}
