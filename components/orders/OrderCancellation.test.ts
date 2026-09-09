import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CANCELLATION_FAILURE_MESSAGE,
  LEGAL_WITHDRAWAL_NOTICE,
  OrderCancellation,
  WITHDRAWAL_REASON_LABELS,
  cancellationPresentation,
  submitOrderCancellation,
} from './OrderCancellation';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

/* 라벨을 어드민과 공유하는 토큰 조합으로 바꿨다(#196). 고객이 읽는 문구는
   그대로여야 하므로 결과 문자열을 고정한다. */
describe('WITHDRAWAL_REASON_LABELS', () => {
  it('keeps the customer-facing wording that pairs each reason with its deadline', () => {
    expect(WITHDRAWAL_REASON_LABELS).toEqual({
      change_of_mind: '단순 변심 (공급받은 날부터 7일)',
      defect: '상품 하자·오배송 (공급받은 날부터 3개월)',
    });
  });
});

describe('발주확인 이후 직접 취소 차단', () => {
  it.each(['confirmed', 'shipping', 'delivered', 'done'] as const)('%s 주문은 취소 버튼 대신 신청 기준을 안내한다', (status) => {
    const presentation = cancellationPresentation(status, null);
    expect(presentation.canCancel).toBe(false);
    expect(presentation.body).toContain('발주확인 전');
    expect(presentation.body).toContain('모든 굿즈');
    expect(presentation.body).not.toContain('주문이 취소됐습니다');
    const markup = renderToStaticMarkup(createElement(OrderCancellation, {
      deliveredAt: null, orderId: '11111111-1111-4111-8111-111111111111', status,
      refund: null, cancellationRequest: null,
      eligibility: { cancel: false, return: false, exchange: false },
    }));
    expect(markup).not.toContain('order-cancellation-open');
    expect(markup).toContain('1:1 문의');
  });

  it('발주확인 이력이 있는 paid 주문은 읽기 RPC의 취소 금지를 따른다', () => {
    expect(cancellationPresentation('paid', null, null, {
      eligibility: { cancel: false, return: false, exchange: false },
    }).canCancel).toBe(false);
  });
});

describe('submitOrderCancellation', () => {
  it('posts the withdrawal reason and accepts only the public cancellation states', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'requested' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(submitOrderCancellation(
      '7ad4c967-3d48-44da-a665-64731ac33f62',
      'change_of_mind',
      fetcher,
    )).resolves.toBe('requested');

    expect(fetcher).toHaveBeenCalledWith(
      '/api/orders/7ad4c967-3d48-44da-a665-64731ac33f62/cancel',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reasonType: 'change_of_mind' }),
      },
    );
  });

  it('기한이 지난 요청을 별도 상태로 구분해 돌려준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'deadline_expired' } }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(submitOrderCancellation('order-id', 'change_of_mind', fetcher))
      .resolves.toBe('deadline_expired');
  });

  it('화면을 연 뒤 발주확인된 주문은 재시도 대신 취소 불가 결과를 돌려준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'not_cancelable' },
    }), { status: 409 }));
    await expect(submitOrderCancellation('order-id', 'change_of_mind', fetcher))
      .resolves.toBe('not_cancelable');
  });

  it('returns false for HTTP failures without exposing the response body', async () => {
    // 실패 응답에서 읽는 값은 기한 초과 여부를 가르는 error.code 하나뿐이다.
    // 그 밖의 본문은 어떤 형태로도 호출자에게 전달되지 않는다.
    const json = vi.fn(() => Promise.resolve({ error: { detail: 'provider-secret' } }));
    const fetcher = vi.fn().mockResolvedValue({ ok: false, json });

    const result = await submitOrderCancellation('order-id', 'change_of_mind', fetcher);

    expect(result).toBe(false);
    expect(JSON.stringify(result)).not.toContain('provider-secret');
  });

  it('fails closed for a successful response with an unexpected status', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: 'provider-private-state' }),
    });

    await expect(submitOrderCancellation('order-id', 'change_of_mind', fetcher))
      .resolves.toBe(false);
  });

  it('separates pre-payment cancellation from paid-order withdrawal', () => {
    expect(cancellationPresentation('pending', null, null, { eligibility: { cancel: true, return: false, exchange: false } })).toMatchObject({
      canCancel: true,
      heading: '결제 대기 주문 취소',
      actionLabel: '주문 취소',
    });
    expect(cancellationPresentation('pending', null, null, { eligibility: { cancel: true, return: false, exchange: false } }).body).toContain('결제 내역');
    expect(cancellationPresentation('paid', null, null, { eligibility: { cancel: true, return: false, exchange: false } })).toMatchObject({
      canCancel: true,
      heading: '청약철회 요청',
      actionLabel: '청약철회 요청',
    });
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

  it.each([
    ['requested', '청약철회 요청 접수', '검토'],
    ['processing', '결제 취소 처리 중', '처리'],
    ['needs_review', '결제 취소 확인 중', '확인'],
    ['completed', '취소·환불 처리 완료', '완료'],
  ] as const)('shows safe %s request status without provider details', (requestStatus, heading, bodyWord) => {
    const presentation = cancellationPresentation('paid', null, {
      id: '22222222-2222-4222-8222-222222222222',
      status: requestStatus,
      /* 취소 패널은 취소 클레임만 그린다(#252). 반품·교환은 OrderClaimRequest가 맡는다. */
      claimType: 'cancel',
      stage: requestStatus,
      reference: 12,
      requestedAt: '2026-07-14T07:30:00.000Z',
      decidedAt: null,
      decisionNote: null,
      reshipCarrier: null,
      reshipTrackingNumber: null,
    });

    expect(presentation).toMatchObject({ canCancel: false, heading: expect.stringContaining(heading) });
    expect(presentation.body).toContain(bodyWord);
    expect(JSON.stringify(presentation)).not.toMatch(/paymentKey|raw|provider/i);
  });

  it('shows the rejected request history while allowing a paid order to submit again', () => {
    const rejectedRequest = {
      id: '22222222-2222-4222-8222-222222222222',
      status: 'rejected' as const,
      claimType: 'cancel' as const,
      stage: 'rejected' as const,
      reference: 12,
      requestedAt: '2026-07-14T07:30:00.000Z',
      decidedAt: '2026-07-14T08:00:00.000Z',
      decisionNote: '배송 준비 상태를 확인해주세요',
      reshipCarrier: null,
      reshipTrackingNumber: null,
    };

    expect(cancellationPresentation('paid', null, rejectedRequest, { eligibility: { cancel: true, return: false, exchange: false } })).toMatchObject({
      canCancel: true,
      heading: '청약철회 재요청',
      actionLabel: '다시 청약철회 요청',
      requestLabel: '이전 요청 거절',
      requestRequestedAt: '2026-07-14T07:30:00.000Z',
      requestDecidedAt: '2026-07-14T08:00:00.000Z',
      body: expect.stringContaining('배송 준비 상태를 확인해주세요'),
    });
    expect(cancellationPresentation('paid', null, rejectedRequest, { eligibility: { cancel: true, return: false, exchange: false } }).body).toContain('거절');

    const markup = renderToStaticMarkup(createElement(OrderCancellation, { deliveredAt: null,
      orderId: '11111111-1111-4111-8111-111111111111',
      status: 'paid',
      refund: null,
      cancellationRequest: rejectedRequest,
      eligibility: { cancel: true, return: false, exchange: false },
    }));
    expect(markup).toContain('이전 요청 거절');
    expect(markup).toContain('요청 시각');
    expect(markup).toContain('처리 시각');
    expect(markup).toContain('2026-07-14T08:00:00.000Z');
    expect(markup).toContain('다시 청약철회 요청');

    expect(cancellationPresentation('canceled', null, rejectedRequest)).toMatchObject({
      canCancel: false,
      heading: '취소·환불 상태',
    });
  });

  it('keeps the statutory notice and fail-closed error copy exact', () => {
    // 고지 문구는 실제로 강제되는 기한과 일치해야 한다(#189).
    expect(LEGAL_WITHDRAWAL_NOTICE).toBe('굿즈를 공급받은 날부터 7일 이내에 단순 변심 청약철회를 요청할 수 있습니다. 상품 하자나 오배송은 공급받은 날부터 3개월 이내에 요청할 수 있습니다. 상품 훼손·사용 등 법정 제한 사유가 있으면 제한될 수 있습니다.');
    expect(CANCELLATION_FAILURE_MESSAGE).toBe('취소 요청을 처리하지 못했습니다. 주문 상태를 새로 확인한 뒤 다시 시도해주세요.');
  });
});
