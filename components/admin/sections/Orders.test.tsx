import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminOrderConsoleData, AdminOrderRecord } from '@/lib/admin/orders';
import { OrdersSection } from './Orders';

vi.mock('@/app/admin/order-actions', () => ({
  approveAdminOrderCancellationAction: vi.fn(),
  reconcileAdminOrderCancellationAction: vi.fn(),
  rejectAdminOrderCancellationAction: vi.fn(),
  updateAdminOrderStatusAction: vi.fn(),
  updateAdminOrderTrackingAction: vi.fn(),
}));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function orderData(overrides: Partial<AdminOrderRecord> = {}): AdminOrderConsoleData {
  return {
    filters: {
      from: null,
      orderId: ORDER_ID,
      page: 1,
      query: '',
      status: 'all',
      to: null,
    },
    items: [{
      id: ORDER_ID,
      userId: '22222222-2222-4222-8222-222222222222',
      buyerName: 'maple_fan',
      buyerEmail: 'fan@example.test',
      status: 'paid',
      total: 32000,
      address: {
        recipientName: '김팬',
        phone: '01012345678',
        postalCode: '04799',
        address1: '서울 성동구 성수이로 1',
        address2: '101호',
        deliveryNote: '문 앞에 놓아주세요',
      },
      createdAt: '2026-07-14T06:00:00.000Z',
      updatedAt: '2026-07-14T06:01:00.000Z',
      items: [{
        id: 'item-1',
        name: '화산강림 아크릴 스탠드',
        type: '아크릴 스탠드',
        qty: 1,
        unitPrice: 32000,
      }],
      payments: [{
        id: 'payment-1',
        amount: 32000,
        status: 'paid',
        createdAt: '2026-07-14T06:01:00.000Z',
        paymentKey: 'must-not-render',
        raw: { cardNumber: 'must-not-render' },
      } as never],
      refunds: [],
      cancellationRequest: null,
      shipment: null,
      ...overrides,
    }],
    pageSize: 20,
    total: 1,
  };
}

describe('OrdersSection', () => {
  it('renders staff-safe order detail and the paid-to-shipping action without provider secrets', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData()} />);

    expect(html).toContain('주문 검색');
    expect(html).toContain('maple_fan');
    expect(html).toContain('fan@example.test');
    expect(html).toContain('화산강림 아크릴 스탠드');
    expect(html).toContain('서울 성동구 성수이로 1');
    expect(html).toContain('배송 시작');
    expect(html).not.toContain('must-not-render');
  });

  it.each([
    {
      name: 'requested cancellation',
      overrides: {
        cancellationRequest: {
          id: '33333333-3333-4333-8333-333333333333',
          status: 'requested' as const,
          requestedAt: '2026-07-14T07:00:00.000Z',
        },
      },
      visible: ['청약철회 승인', '요청 거절'],
      hidden: ['배송 시작', '배송 완료', '상태 다시 확인'],
    },
    {
      name: 'needs-review cancellation',
      overrides: {
        cancellationRequest: {
          id: '33333333-3333-4333-8333-333333333333',
          status: 'needs_review' as const,
          requestedAt: '2026-07-14T07:00:00.000Z',
        },
      },
      visible: ['상태 다시 확인'],
      hidden: ['배송 시작', '배송 완료', '청약철회 승인', '요청 거절'],
    },
    {
      name: 'processing cancellation',
      overrides: {
        cancellationRequest: {
          id: '33333333-3333-4333-8333-333333333333',
          status: 'processing' as const,
          requestedAt: '2026-07-14T07:00:00.000Z',
        },
      },
      visible: ['처리 상태 확인'],
      hidden: ['배송 시작', '배송 완료', '청약철회 승인', '요청 거절'],
    },
    {
      name: 'rejected cancellation on a paid order',
      overrides: {
        cancellationRequest: {
          id: '33333333-3333-4333-8333-333333333333',
          status: 'rejected' as const,
          requestedAt: '2026-07-14T07:00:00.000Z',
          decidedAt: '2026-07-14T08:00:00.000Z',
          decisionNote: '배송 준비가 이미 완료되었습니다.',
        },
      },
      visible: ['배송 시작', '요청 거절'],
      hidden: ['배송 완료', '청약철회 승인', '상태 다시 확인'],
    },
    {
      name: 'completed cancellation awaiting an order refresh',
      overrides: {
        cancellationRequest: {
          id: '33333333-3333-4333-8333-333333333333',
          status: 'completed' as const,
          requestedAt: '2026-07-14T07:00:00.000Z',
          decidedAt: '2026-07-14T08:00:00.000Z',
        },
      },
      visible: ['취소 완료'],
      hidden: ['배송 시작', '배송 완료', '청약철회 승인', '요청 거절', '상태 다시 확인'],
    },
    {
      name: 'shipping order',
      overrides: { status: 'shipping' as const },
      visible: ['배송 완료'],
      hidden: ['배송 시작', '청약철회 승인', '요청 거절', '상태 다시 확인'],
    },
  ])('exposes only the allowed action for $name', ({ overrides, visible, hidden }) => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData(overrides)} />);

    for (const label of visible) expect(html).toContain(label);
    for (const label of hidden) expect(html).not.toContain(label);
  });

  it('preserves filters when selecting an order and moving through 20-row pages', () => {
    const data = orderData();
    const secondOrder = {
      ...data.items[0],
      id: '44444444-4444-4444-8444-444444444444',
      buyerName: 'second_fan',
    };
    data.items = [data.items[0], secondOrder];
    data.filters = {
      from: '2026-07-01',
      orderId: ORDER_ID,
      page: 2,
      query: 'maple fan',
      status: 'paid',
      to: '2026-07-14',
    };
    data.total = 41;

    const html = renderToStaticMarkup(<OrdersSection data={data} />);

    expect(html).toContain('action="/admin"');
    expect(html).toContain('type="hidden" name="section" value="orders"');
    expect(html).toContain(
      'href="/admin?section=orders&amp;status=paid&amp;from=2026-07-01&amp;to=2026-07-14&amp;query=maple+fan&amp;page=2&amp;order=44444444-4444-4444-8444-444444444444"',
    );
    expect(html).toContain(
      'href="/admin?section=orders&amp;status=paid&amp;from=2026-07-01&amp;to=2026-07-14&amp;query=maple+fan&amp;page=1"',
    );
    expect(html).toContain(
      'href="/admin?section=orders&amp;status=paid&amp;from=2026-07-01&amp;to=2026-07-14&amp;query=maple+fan&amp;page=3"',
    );
    expect(html).toContain('2 / 3 페이지');
  });

  it.each(['shipping', 'done'] as const)('exposes the cancellation decision on a %s order', (status) => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      status,
      cancellationRequest: {
        id: '33333333-3333-4333-8333-333333333333',
        status: 'requested',
        requestedAt: '2026-07-14T07:00:00.000Z',
        decidedAt: null,
        decisionNote: null,
      },
    })} />);

    expect(html).toContain('청약철회 승인');
    expect(html).toContain('요청 거절');
    expect(html).toContain('data-confirm="반품 물건 입고를 확인하셨나요? 승인하면 결제 취소와 재고 복원이 진행됩니다."');
  });

  it('배송 시작 폼에서 택배사와 송장번호를 필수로 받는다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData()} />);

    expect(html).toContain('name="carrier"');
    expect(html).toContain('value="hanjin"');
    expect(html).toContain('한진택배');
    expect(html).toContain('name="trackingNumber"');
    expect(html).toContain(`for="admin-order-tracking-${ORDER_ID}"`);
    expect(html).toContain('required=""');
  });

  it('운송장이 등록된 주문은 값과 수정 폼을 함께 보여준다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      status: 'shipping',
      shipment: {
        carrier: 'hanjin',
        carrierLabel: '한진택배',
        trackingNumber: '123456789012',
        trackingUrl: 'https://carrier.example.test/track?no=123456789012',
      },
    })} />);

    expect(html).toContain('123456789012');
    expect(html).toContain('운송장 수정');
    expect(html).toContain('data-confirm="송장번호를 수정할까요? 변경 이력이 감사 로그에 남습니다."');
  });

  it('배송 전 주문에는 운송장 수정 폼을 노출하지 않는다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData()} />);

    expect(html).not.toContain('운송장 수정');
  });

  it('renders explicit confirmations and an accessible rejection reason field', () => {
    const requestId = '33333333-3333-4333-8333-333333333333';
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      cancellationRequest: {
        id: requestId,
        status: 'requested',
        requestedAt: '2026-07-14T07:00:00.000Z',
      },
    })} />);

    expect(html).toContain('data-confirm="청약철회를 승인하고 결제 취소를 시작할까요?"');
    expect(html).toContain('data-confirm="청약철회 요청을 거절할까요? 입력한 사유가 기록됩니다."');
    expect(html).toContain(`for="admin-order-reject-reason-${requestId}">거절 사유`);
    expect(html).toContain('minLength="10"');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('aria-live="polite"');
  });
});
