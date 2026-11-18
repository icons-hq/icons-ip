import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  goodsAvailable: vi.fn(), ticketAvailable: vi.fn(), goodsReconcile: vi.fn(), ticketReconcile: vi.fn(),
  goodsFactory: vi.fn(), ticketFactory: vi.fn(), schedule: vi.fn(),
}));
vi.mock('./goods-checkout-availability', () => ({ goodsPaymentConfirmationAvailable: mocks.goodsAvailable }));
vi.mock('./ticket-checkout-availability', () => ({ ticketPaymentProviderAvailable: mocks.ticketAvailable }));
vi.mock('./goods-checkout.runtime.server', () => ({
  createRuntimeGoodsPaymentCheckout: (provider: string) => { mocks.goodsFactory(provider); return { reconcilePayment: mocks.goodsReconcile }; },
}));
vi.mock('./ticket-checkout.runtime.server', () => ({
  createRuntimeTicketPaymentCheckout: (provider: string) => { mocks.ticketFactory(provider); return { reconcilePayment: mocks.ticketReconcile }; },
}));
vi.mock('@/lib/orders/cancellation-auto.server', () => ({ scheduleApprovedOrderCancellation: mocks.schedule }));

import { GoodsPaymentReconciliationInProgressError } from './goods-checkout';
import { TicketPaymentReconciliationInProgressError } from './ticket-checkout';
import { paymentAttemptRoute, reconcilablePaymentProviders, reconcilePaymentAttempt } from './attempt-reconciliation.server';

const caseRef = 'admin-a7000000000040098000000000000001';
const goods = { attemptId: 'a7000000-0000-4003-8000-000000000001', purpose: 'order', provider: 'nicepay', refId: 'a7000000-0000-4002-8000-000000000001' };
const ticket = { attemptId: 'a7000000-0000-4003-8000-000000000002', purpose: 'ticket', provider: 'toss', refId: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.goodsAvailable.mockReturnValue(true);
  mocks.ticketAvailable.mockReturnValue(true);
  mocks.goodsReconcile.mockResolvedValue({ attemptId: goods.attemptId, provider: 'nicepay', outcome: 'approved' });
  mocks.ticketReconcile.mockResolvedValue({ attemptId: ticket.attemptId, provider: 'toss', outcome: 'declined' });
});

describe('미종결 결제 한 건 재확인', () => {
  it('조회 API가 있는 시도만 고른다', () => {
    expect(paymentAttemptRoute({ purpose: 'order', provider: 'toss' })).toBe('goods');
    expect(paymentAttemptRoute({ purpose: 'order', provider: 'nicepay' })).toBe('goods');
    expect(paymentAttemptRoute({ purpose: 'ticket', provider: 'toss' })).toBe('ticket');
    for (const attempt of [{ purpose: 'order', provider: 'korpay' }, { purpose: 'order', provider: 'bank_transfer' }, { purpose: 'ticket', provider: 'nicepay' }, { purpose: 'prize_sale', provider: 'toss' }]) {
      expect(paymentAttemptRoute(attempt)).toBeNull();
    }
  });

  it('자동 재확인 후보는 이 배포에 설정된 결제사로만 받는다', () => {
    mocks.goodsAvailable.mockImplementation((provider: string) => provider === 'toss');
    expect(reconcilablePaymentProviders()).toEqual(['toss']);
    mocks.goodsAvailable.mockReturnValue(false);
    mocks.ticketAvailable.mockReturnValue(true);
    expect(reconcilablePaymentProviders()).toEqual(['toss']);
    mocks.ticketAvailable.mockReturnValue(false);
    expect(reconcilablePaymentProviders()).toEqual([]);
    mocks.goodsAvailable.mockReturnValue(true);
    expect(reconcilablePaymentProviders()).toEqual(['toss', 'nicepay']);
  });

  it('굿즈는 그 결제사의 재정합 seam을 부르고 승인되면 취소 예약을 건다', async () => {
    await expect(reconcilePaymentAttempt(goods, caseRef)).resolves.toEqual({ kind: 'reconciled', outcome: 'approved' });
    expect(mocks.goodsFactory).toHaveBeenCalledWith('nicepay');
    expect(mocks.goodsReconcile).toHaveBeenCalledExactlyOnceWith({ attemptId: goods.attemptId, caseRef });
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(goods.refId);
    mocks.goodsReconcile.mockResolvedValueOnce({ attemptId: goods.attemptId, provider: 'nicepay', outcome: 'unknown' });
    await expect(reconcilePaymentAttempt(goods, caseRef)).resolves.toEqual({ kind: 'reconciled', outcome: 'unknown' });
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });

  it('티켓은 토스 티켓 seam을 부른다', async () => {
    await expect(reconcilePaymentAttempt(ticket, caseRef)).resolves.toEqual({ kind: 'reconciled', outcome: 'declined' });
    expect(mocks.ticketFactory).toHaveBeenCalledWith('toss');
    expect(mocks.goodsReconcile).not.toHaveBeenCalled();
  });

  it('지원하지 않는 시도·결제사 설정 없음·잘못된 caseRef는 seam을 부르지 않는다', async () => {
    await expect(reconcilePaymentAttempt({ ...goods, provider: 'korpay' }, caseRef)).resolves.toEqual({ kind: 'unsupported' });
    await expect(reconcilePaymentAttempt(goods, 'short')).resolves.toEqual({ kind: 'failed' });
    mocks.goodsAvailable.mockReturnValue(false);
    await expect(reconcilePaymentAttempt(goods, caseRef)).resolves.toEqual({ kind: 'unavailable' });
    mocks.ticketAvailable.mockReturnValue(false);
    await expect(reconcilePaymentAttempt(ticket, caseRef)).resolves.toEqual({ kind: 'unavailable' });
    expect(mocks.goodsReconcile).not.toHaveBeenCalled();
    expect(mocks.ticketReconcile).not.toHaveBeenCalled();
  });

  it('다른 처리가 확인 중이면 in_progress, 그 밖의 오류는 failed다', async () => {
    mocks.goodsReconcile.mockRejectedValueOnce(new GoodsPaymentReconciliationInProgressError());
    await expect(reconcilePaymentAttempt(goods, caseRef)).resolves.toEqual({ kind: 'in_progress' });
    mocks.ticketReconcile.mockRejectedValueOnce(new TicketPaymentReconciliationInProgressError());
    await expect(reconcilePaymentAttempt(ticket, caseRef)).resolves.toEqual({ kind: 'in_progress' });
    mocks.goodsReconcile.mockRejectedValueOnce(new Error('network'));
    await expect(reconcilePaymentAttempt(goods, caseRef)).resolves.toEqual({ kind: 'failed' });
  });
});
