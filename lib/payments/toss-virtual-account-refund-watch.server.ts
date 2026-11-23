import 'server-only';

/*
 * 가상계좌 은행 환불 감시(ADR-0049 결정 5, 2026-11-23 보강).
 *
 * 가상계좌 환불은 취소 API가 CANCELED를 돌려준 뒤 은행이 취소일 + 2일에 구매자 계좌로 입금한다(결제 취소 가이드 Case 1). 그 사이 송금이
 * 실패하면(virtualAccount.refundStatus — NONE·PENDING·FAILED·PARTIAL_FAILED·COMPLETED) 돈이 구매자에게 가지 않았는데 주문은 환불 완료로
 * 닫혀 있다. 무엇을 언제 볼지는 DB가 정하고(private.virtual_account_refund_watches), 이 모듈은 원장 결제 키로 결제를 조회해 결과를
 * 분류만 한다. 조회 응답 원문·계좌 정보는 남기지 않는다(refundStatus 표지만).
 *
 *  - completed: 이 결제가 전액 취소됐고 은행 송금이 끝났다(COMPLETED).
 *  - failed: 은행 송금이 실패했다(FAILED·PARTIAL_FAILED).
 *  - pending: 아직 송금 전(PENDING·NONE·그 밖) — DB가 7일을 넘기면 지연으로 올린다.
 *  - mismatch: 원장의 결제가 아니거나(키·주문·금액) 전액 취소 상태가 아니다 — 운영자가 결제를 확인해야 한다.
 *  - unavailable: 전송 실패·5xx·요청 제한·키 오류 — 상태를 바꾸지 않고 다음 회차에 다시 본다.
 */

const TOSS_API_ORIGIN = 'https://api.tosspayments.com';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const PAYMENT_KEY = /^[\x21-\x7e]{1,200}$/;
const REFUND_STATUS = /^[A-Z_]{1,32}$/;

export interface VirtualAccountRefundWatch {
  readonly attemptId: string;
  readonly orderId: string;
  readonly paymentKey: string;
  readonly providerOrderId: string;
  readonly amount: number;
}

export interface VirtualAccountRefundInspection {
  readonly outcome: 'completed' | 'pending' | 'failed' | 'mismatch' | 'unavailable';
  readonly refundStatus: string | null;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function classifyVirtualAccountRefund(watch: VirtualAccountRefundWatch, payment: unknown): VirtualAccountRefundInspection {
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
  // 우리 원장은 환불 완료인데 결제사가 전액 취소 상태가 아니면(DONE·부분 취소) 송금 상태와 별개로 운영자가 봐야 한다.
  if (payment.status !== 'CANCELED' || payment.balanceAmount !== 0) return { outcome: 'mismatch', refundStatus };
  if (refundStatus === 'COMPLETED') return { outcome: 'completed', refundStatus };
  if (refundStatus === 'FAILED' || refundStatus === 'PARTIAL_FAILED') return { outcome: 'failed', refundStatus };
  return { outcome: 'pending', refundStatus };
}

export function createTossVirtualAccountRefundInspector(options: { readonly secretKey: string; readonly fetch?: typeof fetch }) {
  const fetchImpl = options.fetch ?? fetch;
  const authorization = `Basic ${Buffer.from(`${options.secretKey}:`, 'utf8').toString('base64')}`;

  return {
    async inspect(watch: VirtualAccountRefundWatch): Promise<VirtualAccountRefundInspection> {
      if (!PAYMENT_KEY.test(watch.paymentKey)) return { outcome: 'mismatch', refundStatus: null };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetchImpl(new URL(`/v1/payments/${encodeURIComponent(watch.paymentKey)}`, TOSS_API_ORIGIN).toString(), {
          method: 'GET',
          headers: { authorization, accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.text();
        if (body.length > MAX_RESPONSE_BYTES) return { outcome: 'unavailable', refundStatus: null };
        // 원장이 아는 결제 키로 찾지 못했다 — 우리 기록과 결제사 기록이 어긋났다.
        if (response.status === 404) return { outcome: 'mismatch', refundStatus: null };
        if (response.status !== 200) return { outcome: 'unavailable', refundStatus: null };
        let payload: unknown;
        try {
          payload = body ? JSON.parse(body) : undefined;
        } catch {
          return { outcome: 'unavailable', refundStatus: null };
        }
        return classifyVirtualAccountRefund(watch, payload);
      } catch {
        return { outcome: 'unavailable', refundStatus: null };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
