import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { classifyVirtualAccountRefund, createTossVirtualAccountRefundInspector } from './toss-virtual-account-refund-watch.server';

const watch = { attemptId: 'a', orderId: 'o', paymentKey: 'va-key-1', providerOrderId: 'O-1', amount: 31000 };
const canceled = (refundStatus: string, extra: Record<string, unknown> = {}) => ({
  paymentKey: 'va-key-1', orderId: 'O-1', totalAmount: 31000, balanceAmount: 0, status: 'CANCELED', method: '가상계좌',
  virtualAccount: { accountNumber: 'X1', bankCode: '20', refundStatus, refundReceiveAccount: null }, ...extra,
});

describe('classifyVirtualAccountRefund', () => {
  it('전액 취소된 이 결제의 은행 송금 상태로 나눈다', () => {
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED'))).toEqual({ outcome: 'completed', refundStatus: 'COMPLETED' });
    expect(classifyVirtualAccountRefund(watch, canceled('FAILED'))).toEqual({ outcome: 'failed', refundStatus: 'FAILED' });
    expect(classifyVirtualAccountRefund(watch, canceled('PARTIAL_FAILED'))).toEqual({ outcome: 'failed', refundStatus: 'PARTIAL_FAILED' });
    expect(classifyVirtualAccountRefund(watch, canceled('PENDING'))).toEqual({ outcome: 'pending', refundStatus: 'PENDING' });
    expect(classifyVirtualAccountRefund(watch, canceled('NONE'))).toEqual({ outcome: 'pending', refundStatus: 'NONE' });
  });

  it('원장의 결제가 아니거나 전액 취소 상태가 아니면 운영자 확인으로 올린다', () => {
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED', { paymentKey: 'other' })).outcome).toBe('mismatch');
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED', { orderId: 'O-2' })).outcome).toBe('mismatch');
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED', { totalAmount: 1000 })).outcome).toBe('mismatch');
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED', { status: 'DONE', balanceAmount: 31000 })).outcome).toBe('mismatch');
    expect(classifyVirtualAccountRefund(watch, canceled('COMPLETED', { virtualAccount: null })).outcome).toBe('mismatch');
  });

  it('형식 밖 상태 표지는 남기지 않는다', () => {
    expect(classifyVirtualAccountRefund(watch, canceled('failed; drop'))).toEqual({ outcome: 'pending', refundStatus: null });
    expect(classifyVirtualAccountRefund(watch, null)).toEqual({ outcome: 'unavailable', refundStatus: null });
  });
});

describe('createTossVirtualAccountRefundInspector', () => {
  function inspector(response: () => Promise<Response>) {
    const fetch = vi.fn(response);
    return { fetch, inspect: createTossVirtualAccountRefundInspector({ secretKey: 'test_sk_synthetic', fetch }).inspect };
  }

  it('원장 결제 키로 결제를 조회하고 시크릿 키를 기본 인증으로 보낸다', async () => {
    const { fetch, inspect } = inspector(async () => new Response(JSON.stringify(canceled('COMPLETED')), { status: 200 }));
    expect(await inspect(watch)).toEqual({ outcome: 'completed', refundStatus: 'COMPLETED' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.tosspayments.com/v1/payments/va-key-1');
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('test_sk_synthetic:').toString('base64')}`);
  });

  it('없는 결제는 운영자 확인, 5xx·키 오류·전송 실패·형식 오류는 다음 회차로 미룬다', async () => {
    expect((await inspector(async () => new Response('{"code":"NOT_FOUND_PAYMENT"}', { status: 404 })).inspect(watch)).outcome).toBe('mismatch');
    expect((await inspector(async () => new Response('{}', { status: 500 })).inspect(watch)).outcome).toBe('unavailable');
    expect((await inspector(async () => new Response('{}', { status: 401 })).inspect(watch)).outcome).toBe('unavailable');
    expect((await inspector(async () => new Response('not json', { status: 200 })).inspect(watch)).outcome).toBe('unavailable');
    expect((await inspector(async () => { throw new Error('network'); }).inspect(watch)).outcome).toBe('unavailable');
  });

  it('결제 키 형식이 다르면 조회하지 않는다', async () => {
    const { fetch, inspect } = inspector(async () => new Response('{}', { status: 200 }));
    expect((await inspect({ ...watch, paymentKey: 'bad key' })).outcome).toBe('mismatch');
    expect(fetch).not.toHaveBeenCalled();
  });
});
