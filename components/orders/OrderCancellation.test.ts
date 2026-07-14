import { describe, expect, it, vi } from 'vitest';
import {
  CANCELLATION_FAILURE_MESSAGE,
  LEGAL_WITHDRAWAL_NOTICE,
  cancellationPresentation,
  submitOrderCancellation,
} from './OrderCancellation';

describe('submitOrderCancellation', () => {
  it('posts to the owned order cancellation endpoint without a request body', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(submitOrderCancellation(
      '7ad4c967-3d48-44da-a665-64731ac33f62',
      fetcher,
    )).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledWith(
      '/api/orders/7ad4c967-3d48-44da-a665-64731ac33f62/cancel',
      { method: 'POST' },
    );
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });

  it('returns false for HTTP failures without exposing the response body', async () => {
    const json = vi.fn(() => Promise.resolve({ error: 'provider-secret' }));
    const fetcher = vi.fn().mockResolvedValue({ ok: false, json });

    await expect(submitOrderCancellation('order-id', fetcher)).resolves.toBe(false);
    expect(json).not.toHaveBeenCalled();
  });

  it('separates pre-payment cancellation from paid-order withdrawal', () => {
    expect(cancellationPresentation('pending', null)).toMatchObject({
      canCancel: true,
      heading: '결제 대기 주문 취소',
      actionLabel: '주문 취소',
    });
    expect(cancellationPresentation('pending', null).body).toContain('결제 내역');
    expect(cancellationPresentation('paid', null)).toMatchObject({
      canCancel: true,
      heading: '청약철회 요청',
      actionLabel: '청약철회 요청',
    });
  });

  it.each(['shipping', 'done'] as const)('blocks self cancellation for %s and routes to support without invented contact details', (status) => {
    const presentation = cancellationPresentation(status, null);
    expect(presentation.canCancel).toBe(false);
    expect(presentation.body).toContain('고객센터');
    expect(presentation).not.toHaveProperty('actionLabel');
  });

  it('shows a safe canceled-order refund summary', () => {
    expect(cancellationPresentation('canceled', {
      status: 'requested',
      createdAt: '2026-07-14T07:30:00.000Z',
    })).toMatchObject({
      canCancel: false,
      heading: '취소·환불 상태',
      refundLabel: '환불 요청 접수',
      refundCreatedAt: '2026-07-14T07:30:00.000Z',
    });
  });

  it('keeps the statutory notice and fail-closed error copy exact', () => {
    expect(LEGAL_WITHDRAWAL_NOTICE).toBe('계약내용에 관한 서면을 받은 날부터 7일 이내 청약철회를 요청할 수 있습니다. 재화 공급이 더 늦으면 공급받거나 공급이 시작된 날부터 7일입니다. 상품 훼손·사용 등 법정 제한 사유가 있으면 제한될 수 있습니다.');
    expect(CANCELLATION_FAILURE_MESSAGE).toBe('취소를 완료하지 못했습니다. 주문 상태를 새로 확인한 뒤 다시 시도해주세요.');
  });
});
