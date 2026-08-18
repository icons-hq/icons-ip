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

/*
 * delivered→done은 하루 한 번 도는 잡이 옮긴다. 변심 7일이 지난 뒤에도 주문이
 * 최대 하루 더 delivered에 남으므로, 문구를 상태로만 고르면 그 사이 화면은
 * "7일 이내에 요청할 수 있습니다"라고 말하는데 DB는 deadline_expired를 돌려준다.
 */
describe('cancellationPresentation 기한 문구', () => {
  const DELIVERED_AT = '2026-08-01T00:00:00.000Z';

  it('변심 창이 열려 있으면 7일 안내를 한다', () => {
    const presentation = cancellationPresentation('delivered', null, null, {
      deliveredAt: DELIVERED_AT,
      at: new Date('2026-08-05T00:00:00.000Z'),
    });

    expect(presentation.body).toContain('7일 이내에 청약철회를 요청할 수 있습니다');
    expect(presentation.body).not.toContain('단순 변심 기한은 지났고');
  });

  it('변심 창이 닫힌 delivered 주문은 하자 3개월만 안내한다', () => {
    const presentation = cancellationPresentation('delivered', null, null, {
      deliveredAt: DELIVERED_AT,
      at: new Date('2026-08-09T00:00:00.000Z'),
    });

    expect(presentation.body).toContain('단순 변심 기한은 지났고');
    expect(presentation.body).toContain('3개월');
    expect(presentation.body).not.toContain('7일 이내에 청약철회를 요청할 수 있습니다');
  });

  /* 옛 사다리에서 done에 도달한 주문은 공급일이 최근일 수 있고 변심 창이 아직 열려
     있다. 상태만 보고 "기한이 지났다"고 적으면 구매자가 권리를 포기한다. */
  it('공급일이 최근인 done 주문은 변심 창이 열려 있다고 안내한다', () => {
    const presentation = cancellationPresentation('done', null, null, {
      deliveredAt: DELIVERED_AT,
      at: new Date('2026-08-04T00:00:00.000Z'),
    });

    expect(presentation.body).toContain('7일 이내에 청약철회를 요청할 수 있습니다');
  });

  it('공급일이 없으면 기한이 시작하지 않은 것으로 본다', () => {
    const presentation = cancellationPresentation('shipping', null, null, {
      deliveredAt: null,
      at: new Date('2026-08-09T00:00:00.000Z'),
    });

    expect(presentation.body).toContain('7일 이내에 청약철회를 요청할 수 있습니다');
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

  it.each(['shipping', 'delivered'] as const)('keeps the withdrawal path open for %s with the receipt-based deadline', (status) => {
    const presentation = cancellationPresentation(status, null);
    expect(presentation).toMatchObject({
      canCancel: true,
      heading: '청약철회 요청',
      actionLabel: '청약철회 요청',
    });
    expect(presentation.body).toContain('7일');
    expect(presentation.body).toContain('착불');
  });

  /* done은 보통 변심 창이 닫힌 뒤의 상태다. 다만 판정 근거는 상태가 아니라
     공급받은 날이다 — 기산점을 주면 그 날짜로 문구가 갈린다(#250). */
  it('거래확정 주문에는 변심 7일 대신 하자 3개월을 안내한다', () => {
    const presentation = cancellationPresentation('done', null, null, {
      deliveredAt: '2026-08-01T00:00:00.000Z',
      at: new Date('2026-08-20T00:00:00.000Z'),
    });
    expect(presentation).toMatchObject({ canCancel: true, actionLabel: '청약철회 요청' });
    expect(presentation.body).toContain('3개월');
    expect(presentation.body).not.toContain('7일');
  });

  /* 기산점이 없으면 기한이 시작하지 않은 것으로 본다 —
     `order_withdrawal_deadline_passed`와 같은 경계이고, 고객에게 유리한 쪽이다. */
  it('공급일을 모르는 주문은 기한이 닫혔다고 단정하지 않는다', () => {
    const presentation = cancellationPresentation('done', null);
    expect(presentation.body).toContain('7일');
  });

  it('asks the shipped-order confirmation about returning the goods first', () => {
    const markup = renderToStaticMarkup(createElement(OrderCancellation, { deliveredAt: null,
      orderId: '11111111-1111-4111-8111-111111111111',
      status: 'done',
      refund: null,
      cancellationRequest: null,
    }));

    expect(markup).toContain('청약철회 요청');
    expect(markup).not.toContain('고객센터에서 주문 상태와 처리 가능 여부를 확인해주세요');
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
      requestedAt: '2026-07-14T07:30:00.000Z',
      decidedAt: null,
      decisionNote: null,
    });

    expect(presentation).toMatchObject({ canCancel: false, heading: expect.stringContaining(heading) });
    expect(presentation.body).toContain(bodyWord);
    expect(JSON.stringify(presentation)).not.toMatch(/paymentKey|raw|provider/i);
  });

  it('shows the rejected request history while allowing a paid order to submit again', () => {
    const rejectedRequest = {
      id: '22222222-2222-4222-8222-222222222222',
      status: 'rejected' as const,
      requestedAt: '2026-07-14T07:30:00.000Z',
      decidedAt: '2026-07-14T08:00:00.000Z',
      decisionNote: '배송 준비 상태를 확인해주세요',
    };

    expect(cancellationPresentation('paid', null, rejectedRequest)).toMatchObject({
      canCancel: true,
      heading: '청약철회 재요청',
      actionLabel: '다시 청약철회 요청',
      requestLabel: '이전 요청 거절',
      requestRequestedAt: '2026-07-14T07:30:00.000Z',
      requestDecidedAt: '2026-07-14T08:00:00.000Z',
      body: expect.stringContaining('배송 준비 상태를 확인해주세요'),
    });
    expect(cancellationPresentation('paid', null, rejectedRequest).body).toContain('거절');

    const markup = renderToStaticMarkup(createElement(OrderCancellation, { deliveredAt: null,
      orderId: '11111111-1111-4111-8111-111111111111',
      status: 'paid',
      refund: null,
      cancellationRequest: rejectedRequest,
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
