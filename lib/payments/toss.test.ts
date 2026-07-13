import { describe, expect, it } from 'vitest';
import {
  buildTossOrderId,
  decideWebhookAction,
  mapConfirmRpcError,
  normalizeTossPayment,
  parseTossOrderId,
  parseWebhookEvent,
  tossBasicAuthHeader,
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
    method: '카드',
  };

  it('조회 API 응답에서 확정에 필요한 필드만 뽑는다', () => {
    expect(normalizeTossPayment(payment)).toEqual({
      paymentKey: 'pk_1',
      orderId: `order_${ORDER_UUID}`,
      status: 'DONE',
      totalAmount: 42000,
    });
  });

  it('알 수 없는 status·형식 밖 응답은 null(확정 금지)', () => {
    expect(normalizeTossPayment({ ...payment, status: 'SOMETHING_NEW' })).toBeNull();
    expect(normalizeTossPayment({ ...payment, totalAmount: '42000' })).toBeNull();
    expect(normalizeTossPayment({ ...payment, paymentKey: '' })).toBeNull();
    expect(normalizeTossPayment(null)).toBeNull();
  });
});

describe('decideWebhookAction', () => {
  const base = (over: Partial<NormalizedTossPayment>): NormalizedTossPayment => ({
    paymentKey: 'pk_1',
    orderId: `order_${ORDER_UUID}`,
    status: 'DONE',
    totalAmount: 42000,
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
    for (const status of ['READY', 'IN_PROGRESS', 'WAITING_FOR_DEPOSIT'] as const) {
      expect(decideWebhookAction(base({ status }))).toEqual({ kind: 'ignore', reason: 'in_progress' });
    }
  });

  it('우리 형식이 아닌 orderId는 무시한다', () => {
    expect(decideWebhookAction(base({ orderId: 'someone-elses-order' }))).toEqual({
      kind: 'ignore',
      reason: 'foreign_order_id',
    });
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
