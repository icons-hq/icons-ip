import { describe, expect, it } from 'vitest';
import {
  buildTossOrderId,
  decideWebhookAction,
  isIndeterminateTossFailure,
  mapConfirmRpcError,
  normalizeTossPayment,
  parseTossOrderId,
  parseWebhookEvent,
  tossBasicAuthHeader,
  verifyApprovedTossPayment,
  verifyTossCancellationState,
  type NormalizedTossPayment,
} from './toss';

const ORDER_UUID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';

describe('buildTossOrderId / parseTossOrderId', () => {
  it('주문·예매를 prefix로 구분해 왕복 인코딩한다', () => {
    expect(parseTossOrderId(buildTossOrderId('order', ORDER_UUID))).toEqual({
      purpose: 'order',
      refId: ORDER_UUID,
    });
    expect(parseTossOrderId(buildTossOrderId('ticket', ORDER_UUID))).toEqual({
      purpose: 'ticket',
      refId: ORDER_UUID,
    });
  });

  it('토스 orderId 규격(6~64자, 영숫자·-·_)을 지킨다', () => {
    const encoded = buildTossOrderId('ticket', ORDER_UUID);
    expect(encoded.length).toBeGreaterThanOrEqual(6);
    expect(encoded.length).toBeLessThanOrEqual(64);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('외부 orderId·손상된 값은 null로 거른다', () => {
    expect(parseTossOrderId('wallet_' + ORDER_UUID)).toBeNull(); // 폐기된 purpose
    expect(parseTossOrderId('order-' + ORDER_UUID)).toBeNull(); // 잘못된 구분자
    expect(parseTossOrderId('order_not-a-uuid')).toBeNull();
    expect(parseTossOrderId(`order_${ORDER_UUID.toUpperCase()}`)).toBeNull(); // 대문자 uuid 미발급
    expect(parseTossOrderId('')).toBeNull();
    expect(parseTossOrderId(undefined)).toBeNull();
    expect(parseTossOrderId(42)).toBeNull();
  });
});

describe('tossBasicAuthHeader', () => {
  it('시크릿 키 뒤에 콜론을 붙여 base64 인코딩한다', () => {
    // 토스 인증 규칙: base64(secretKey + ':') — https://docs.tosspayments.com/reference/using-api/authorization
    expect(tossBasicAuthHeader('test_sk_abc')).toBe('Basic dGVzdF9za19hYmM6');
  });
});

describe('parseWebhookEvent', () => {
  it('PAYMENT_STATUS_CHANGED에서 paymentKey를 꺼낸다', () => {
    expect(
      parseWebhookEvent({
        eventType: 'PAYMENT_STATUS_CHANGED',
        createdAt: '2026-07-13T09:00:00.000000',
        data: { paymentKey: 'pk_1', orderId: `order_${ORDER_UUID}`, status: 'DONE' },
      }),
    ).toEqual({ kind: 'payment_status_changed', paymentKey: 'pk_1' });
  });

  it('다른 이벤트 타입은 종류만 보고한다(v1 미처리)', () => {
    expect(parseWebhookEvent({ eventType: 'CANCEL_STATUS_CHANGED', data: {} })).toEqual({
      kind: 'other',
      eventType: 'CANCEL_STATUS_CHANGED',
    });
    // 가상계좌 DEPOSIT_CALLBACK은 flat 구조 — eventType이 없어 invalid가 아닌 other로도 못 가고 invalid다.
    expect(parseWebhookEvent({ createdAt: '...', secret: 's', status: 'DONE', orderId: 'o' })).toEqual({
      kind: 'invalid',
    });
  });

  it('paymentKey가 없거나 본문이 형식 밖이면 invalid', () => {
    expect(parseWebhookEvent({ eventType: 'PAYMENT_STATUS_CHANGED', data: {} })).toEqual({ kind: 'invalid' });
    expect(parseWebhookEvent(null)).toEqual({ kind: 'invalid' });
    expect(parseWebhookEvent('junk')).toEqual({ kind: 'invalid' });
  });
});

describe('normalizeTossPayment', () => {
  const payment = {
    paymentKey: 'pk_1',
    orderId: `order_${ORDER_UUID}`,
    status: 'DONE',
    totalAmount: 42000,
    type: 'NORMAL',
    currency: 'KRW',
    method: '카드',
  };

  it('조회 API 응답에서 결제 계약 검증에 필요한 필드를 뽑는다', () => {
    expect(normalizeTossPayment(payment)).toEqual({
      paymentKey: 'pk_1',
      orderId: `order_${ORDER_UUID}`,
      status: 'DONE',
      totalAmount: 42000,
      type: 'NORMAL',
      currency: 'KRW',
      method: '카드',
    });
  });

  it('알 수 없는 status·형식 밖 응답은 null(확정 금지)', () => {
    expect(normalizeTossPayment({ ...payment, status: 'SOMETHING_NEW' })).toBeNull();
    expect(normalizeTossPayment({ ...payment, totalAmount: '42000' })).toBeNull();
    expect(normalizeTossPayment({ ...payment, currency: 42 })).toBeNull();
    expect(normalizeTossPayment({ ...payment, method: 42 })).toBeNull();
    expect(normalizeTossPayment({ ...payment, totalAmount: 0 })).toBeNull();
    expect(normalizeTossPayment({ ...payment, totalAmount: 1.5 })).toBeNull();
    expect(normalizeTossPayment({ ...payment, paymentKey: '' })).toBeNull();
    expect(normalizeTossPayment(null)).toBeNull();
  });
});

describe('verifyApprovedTossPayment', () => {
  const expected = {
    paymentKey: 'pk_1',
    orderId: `order_${ORDER_UUID}`,
    amount: 42000,
  };
  const payment = {
    paymentKey: expected.paymentKey,
    orderId: expected.orderId,
    status: 'DONE',
    totalAmount: expected.amount,
    type: 'NORMAL',
    currency: 'KRW',
    method: '카드',
  };

  it('응답 identity·일반결제·원화·승인완료가 요청과 모두 일치해야 승인한다', () => {
    expect(verifyApprovedTossPayment(payment, expected)).toEqual({
      ok: true,
      payment,
    });
  });

  it.each([
    ['paymentKey', { paymentKey: 'pk_other' }],
    ['orderId', { orderId: `ticket_${ORDER_UUID}` }],
    ['amount', { totalAmount: 43000 }],
  ])('%s 불일치는 provider_response_mismatch로 거른다', (_field, override) => {
    expect(verifyApprovedTossPayment({ ...payment, ...override }, expected)).toEqual({
      ok: false,
      reason: 'provider_response_mismatch',
    });
  });

  it('NORMAL·KRW·DONE 계약 밖의 응답은 승인하지 않는다', () => {
    for (const override of [
      { type: 'BRANDPAY' },
      { currency: 'USD' },
      { status: 'IN_PROGRESS' },
    ]) {
      expect(verifyApprovedTossPayment({ ...payment, ...override }, expected)).toEqual({
        ok: false,
        reason: 'unsupported_payment_contract',
      });
    }
  });

  it('가상계좌 승인 응답은 별도 운영 오류로 거른다', () => {
    expect(verifyApprovedTossPayment({ ...payment, method: '가상계좌' }, expected)).toEqual({
      ok: false,
      reason: 'unsupported_payment_method',
    });
  });

  it('형식 밖 응답은 provider_response_mismatch로 거른다', () => {
    expect(verifyApprovedTossPayment({ ...payment, type: null }, expected)).toEqual({
      ok: false,
      reason: 'provider_response_mismatch',
    });
  });
});

describe('verifyTossCancellationState', () => {
  const expected = {
    paymentKey: 'pk_cancel_1',
    orderId: `order_${ORDER_UUID}`,
    amount: 42000,
  };
  const base = {
    paymentKey: expected.paymentKey,
    orderId: expected.orderId,
    status: 'DONE',
    totalAmount: expected.amount,
    balanceAmount: expected.amount,
    type: 'NORMAL',
    currency: 'KRW',
    method: '카드',
    cancels: null,
  };

  it('fresh GET의 미취소 전액 결제를 provider 호출 가능 상태로 판정한다', () => {
    expect(verifyTossCancellationState(base, expected)).toEqual({
      ok: true,
      state: 'uncanceled',
    });
  });

  it('잔액 0과 DONE 취소 합계가 원금과 일치해야 전액 취소 증거로 인정한다', () => {
    expect(verifyTossCancellationState({
      ...base,
      status: 'CANCELED',
      balanceAmount: 0,
      cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
    }, expected)).toEqual({
      ok: true,
      state: 'fully_canceled',
    });
  });

  it.each([
    ['payment key', { paymentKey: 'pk_other' }],
    ['order id', { orderId: `ticket_${ORDER_UUID}` }],
    ['amount', { totalAmount: 43000, balanceAmount: 43000 }],
  ])('%s 불일치는 provider identity 오류로 차단한다', (_label, override) => {
    expect(verifyTossCancellationState({ ...base, ...override }, expected)).toEqual({
      ok: false,
      reason: 'provider_response_mismatch',
    });
  });

  it('부분 취소·잔액·취소 처리중 상태는 로컬 환불 증거로 쓰지 않는다', () => {
    for (const candidate of [
      { ...base, status: 'PARTIAL_CANCELED', balanceAmount: 22000, cancels: [{ cancelAmount: 20000, cancelStatus: 'DONE' }] },
      { ...base, status: 'CANCELED', balanceAmount: 1000, cancels: [{ cancelAmount: 41000, cancelStatus: 'DONE' }] },
      { ...base, status: 'CANCELED', balanceAmount: 0, cancels: [{ cancelAmount: 42000, cancelStatus: 'IN_PROGRESS' }] },
    ]) {
      expect(verifyTossCancellationState(candidate, expected)).toEqual({
        ok: false,
        reason: 'incomplete_cancellation',
      });
    }
  });

  it('NORMAL·KRW 계약 밖 응답은 취소하지 않는다', () => {
    expect(verifyTossCancellationState({ ...base, type: 'BRANDPAY' }, expected)).toEqual({
      ok: false,
      reason: 'unsupported_payment_contract',
    });
    expect(verifyTossCancellationState({ ...base, currency: 'USD' }, expected)).toEqual({
      ok: false,
      reason: 'unsupported_payment_contract',
    });
  });
});

describe('decideWebhookAction', () => {
  const base = (over: Partial<NormalizedTossPayment>): NormalizedTossPayment => ({
    paymentKey: 'pk_1',
    orderId: `order_${ORDER_UUID}`,
    status: 'DONE',
    totalAmount: 42000,
    type: 'NORMAL',
    currency: 'KRW',
    method: '카드',
    ...over,
  });

  it('DONE은 purpose별 확정으로 간다', () => {
    expect(decideWebhookAction(base({}))).toEqual({
      kind: 'confirm',
      ref: { purpose: 'order', refId: ORDER_UUID },
    });
    expect(decideWebhookAction(base({ orderId: `ticket_${ORDER_UUID}` }))).toEqual({
      kind: 'confirm',
      ref: { purpose: 'ticket', refId: ORDER_UUID },
    });
  });

  it('CANCELED는 취소 반영, PARTIAL_CANCELED는 v1 미지원', () => {
    expect(decideWebhookAction(base({ status: 'CANCELED' }))).toEqual({
      kind: 'reflect_cancel',
      ref: { purpose: 'order', refId: ORDER_UUID },
    });
    expect(decideWebhookAction(base({ status: 'PARTIAL_CANCELED' }))).toEqual({ kind: 'unsupported' });
  });

  it('ABORTED·EXPIRED는 실패 기록, 진행 중 상태는 무시', () => {
    expect(decideWebhookAction(base({ status: 'ABORTED' }))).toEqual({
      kind: 'record_failure',
      ref: { purpose: 'order', refId: ORDER_UUID },
    });
    expect(decideWebhookAction(base({ status: 'EXPIRED' }))).toEqual({
      kind: 'record_failure',
      ref: { purpose: 'order', refId: ORDER_UUID },
    });
    for (const status of ['READY', 'IN_PROGRESS'] as const) {
      expect(decideWebhookAction(base({ status }))).toEqual({ kind: 'ignore', reason: 'in_progress' });
    }
  });

  it('입금 전 가상계좌는 자동 취소하고, 입금 완료 가상계좌는 수동 환불로 보낸다', () => {
    expect(decideWebhookAction(base({ status: 'WAITING_FOR_DEPOSIT', method: '가상계좌' }))).toEqual({
      kind: 'cancel_unsupported',
      ref: { purpose: 'order', refId: ORDER_UUID },
    });
    expect(decideWebhookAction(base({ status: 'DONE', method: '가상계좌' }))).toEqual({ kind: 'unsupported' });
    expect(decideWebhookAction(base({ status: 'CANCELED', method: '가상계좌' }))).toEqual({
      kind: 'reflect_cancel',
      ref: { purpose: 'order', refId: ORDER_UUID },
    });
  });

  it('DONE이어도 일반결제·원화·지원 결제수단 계약 밖이면 확정하지 않는다', () => {
    expect(decideWebhookAction(base({ type: 'BRANDPAY' }))).toEqual({ kind: 'unsupported' });
    expect(decideWebhookAction(base({ currency: 'USD' }))).toEqual({ kind: 'unsupported' });
    expect(decideWebhookAction(base({ method: '가상계좌' }))).toEqual({ kind: 'unsupported' });
  });

  it('우리 형식이 아닌 orderId는 무시한다', () => {
    expect(decideWebhookAction(base({ orderId: 'someone-elses-order' }))).toEqual({
      kind: 'ignore',
      reason: 'foreign_order_id',
    });
  });
});

describe('isIndeterminateTossFailure', () => {
  it('네트워크 단절·토스 5xx·멱등 처리 중(409)은 비종결 — failed로 기록하면 안 된다', () => {
    expect(isIndeterminateTossFailure({ status: 0, code: 'NETWORK_ERROR' })).toBe(true);
    expect(isIndeterminateTossFailure({ status: 500, code: 'FAILED_INTERNAL_SYSTEM_PROCESSING' })).toBe(true);
    // 같은 멱등키의 첫 요청이 처리 중 — 결과 미확정 신호(공식 멱등키 문서)
    expect(isIndeterminateTossFailure({ status: 409, code: 'IDEMPOTENT_REQUEST_PROCESSING' })).toBe(true);
  });

  it('명시적 거절(4xx)은 종결 — 이 시도의 실패로 기록해도 안전', () => {
    expect(isIndeterminateTossFailure({ status: 400, code: 'REJECT_CARD_COMPANY' })).toBe(false);
    expect(isIndeterminateTossFailure({ status: 404, code: 'NOT_FOUND_PAYMENT_SESSION' })).toBe(false);
    expect(isIndeterminateTossFailure({ status: 401, code: 'UNAUTHORIZED_KEY' })).toBe(false);
  });
});

describe('mapConfirmRpcError', () => {
  it('만료·확정 불가 주문은 unfulfillable(토스 자동 취소 대상)', () => {
    expect(mapConfirmRpcError('order expired')).toBe('unfulfillable');
    expect(mapConfirmRpcError('order not payable')).toBe('unfulfillable');
    expect(mapConfirmRpcError('ticket order expired')).toBe('unfulfillable');
    expect(mapConfirmRpcError('ticket order not payable')).toBe('unfulfillable');
  });

  it('그 외(금액 불일치·미존재·일시 오류)는 retryable — 웹훅 재시도로 운영 노출', () => {
    expect(mapConfirmRpcError('amount mismatch')).toBe('retryable');
    expect(mapConfirmRpcError('order not found')).toBe('retryable');
    expect(mapConfirmRpcError('idempotency conflict')).toBe('retryable');
    expect(mapConfirmRpcError('connection reset')).toBe('retryable');
  });

  it('payments 행 레벨 오류는 retryable — 이행 가능한 결제를 자동 취소하면 안 된다', () => {
    // 'payment not payable'은 로컬 기록(stale failed 행 등) 문제지 주문 만료가 아니다.
    expect(mapConfirmRpcError('payment not payable')).toBe('retryable');
    expect(mapConfirmRpcError('ticket order expired')).toBe('unfulfillable');
  });
});
