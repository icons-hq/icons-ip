import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  AdminOrderCancellationRequestRecord,
  AdminOrderConsoleData,
  AdminOrderRecord,
} from '@/lib/admin/orders';
import { OrdersSection } from './Orders';

vi.mock('@/app/admin/order-actions', () => ({
  approveAdminOrderCancellationAction: vi.fn(),
  recoverAdminGoodsPaymentAction: vi.fn(),
  reconcileAdminOrderCancellationAction: vi.fn(),
  rejectAdminOrderCancellationAction: vi.fn(),
  updateAdminOrderStatusAction: vi.fn(),
  updateAdminOrderTrackingAction: vi.fn(),
}));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function cancellationRequest(
  overrides: Partial<AdminOrderCancellationRequestRecord> = {},
): AdminOrderCancellationRequestRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    status: 'requested',
    reasonType: 'change_of_mind',
    requestedAt: '2026-07-14T07:00:00.000Z',
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  };
}

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
      manualRecoveryAttempt: null,
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

  it('shows the related safe Korpay reference and exact provider-ledger attestation action', () => {
    const request = cancellationRequest({ status: 'needs_review' });
    const attemptId = '44444444-4444-4444-8444-444444444444';
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      cancellationRequest: request,
      manualRecoveryAttempt: {
        attemptId,
        requestId: request.id,
        providerOrderId: 'O0123456789ABCDEF',
        state: 'confirming',
        amount: 32000,
        currency: 'KRW',
        manualRecoveryAvailable: true,
      },
    })} />);

    expect(html).toContain('Korpay 원장 확인 정보');
    expect(html).toContain('O0123456789ABCDEF');
    expect(html).toContain('32,000');
    expect(html).toContain('KRW');
    expect(html).toContain(`name="attemptId" value="${attemptId}"`);
    expect(html).toContain(`name="requestId" value="${request.id}"`);
    expect(html).not.toContain('name="operation"');
    expect(html).toContain('name="operatorAttestation"');
    expect(html).toContain('value="provider_cancel_confirmed"');
    expect(html).toContain('required=""');
    expect(html).toContain(
      'data-confirm="Korpay 주문 O0123456789ABCDEF · ₩32,000 KRW의 전액 취소 완료를 원장에서 확인했습니다. 반영하면 확인된 결제에는 환불 원장을 남기고, 주문 취소와 재고 복원을 즉시 완료합니다. 계속할까요?"',
    );
    expect(html).toContain('Korpay 전액 취소 반영');
    expect(html).toContain('admin-order-korpay-recovery-submit');
    expect(html).not.toContain('상태 다시 확인');
  });

  it('shows a related active Korpay attempt without exposing the manual action before takeover is safe', () => {
    const request = cancellationRequest({ status: 'processing' });
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      cancellationRequest: request,
      manualRecoveryAttempt: {
        attemptId: '44444444-4444-4444-8444-444444444444',
        requestId: request.id,
        providerOrderId: 'O0123456789ABCDEF',
        state: 'confirming',
        amount: 32000,
        currency: 'KRW',
        manualRecoveryAvailable: false,
      },
    })} />);

    expect(html).toContain('Korpay 원장 확인 정보');
    expect(html).toContain('현재 결제 처리 또는 다른 운영 확인이 진행 중입니다.');
    expect(html).not.toContain('Korpay 전액 취소 반영');
    expect(html).not.toContain('처리 상태 확인');
  });

  it.each(['declined', 'canceled'] as const)(
    'keeps legacy cancellation reconciliation for a terminal Korpay %s attempt with no provider capture',
    (state) => {
      const request = cancellationRequest({ status: 'processing' });
      const html = renderToStaticMarkup(<OrdersSection data={orderData({
        cancellationRequest: request,
        manualRecoveryAttempt: {
          attemptId: '44444444-4444-4444-8444-444444444444',
          requestId: request.id,
          providerOrderId: 'O0123456789ABCDEF',
          state,
          amount: 32000,
          currency: 'KRW',
          manualRecoveryAvailable: false,
        },
      })} />);

      expect(html).toContain('처리 상태 확인');
      expect(html).not.toContain('Korpay 전액 취소 반영');
      expect(html).not.toContain('현재 결제 처리 또는 다른 운영 확인이 진행 중입니다.');
    },
  );

  it('routes a prepared Korpay attempt through the expiry-aware no-capture action', () => {
    const request = cancellationRequest({ status: 'processing' });
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      cancellationRequest: request,
      manualRecoveryAttempt: {
        attemptId: '44444444-4444-4444-8444-444444444444',
        requestId: request.id,
        providerOrderId: 'O0123456789ABCDEF',
        state: 'prepared',
        amount: 32000,
        currency: 'KRW',
        manualRecoveryAvailable: false,
      },
    })} />);

    expect(html).toContain('Korpay 만료·취소 처리');
    expect(html).toContain(
      'Korpay 주문 O0123456789ABCDEF · ₩32,000 KRW 결제 세션의 만료를 확인할까요? 이미 만료됐다면 주문 취소와 재고 복원이 즉시 완료됩니다.',
    );
    expect(html).toContain(`name="requestId" value="${request.id}"`);
    expect(html).not.toContain('Korpay 전액 취소 반영');
    expect(html).not.toContain('처리 상태 확인');
  });

  it.each([
    {
      name: 'requested cancellation',
      overrides: {
        cancellationRequest: cancellationRequest(),
      },
      visible: ['청약철회 승인', '요청 거절'],
      hidden: ['배송 시작', '배송 완료', '상태 다시 확인'],
    },
    {
      name: 'needs-review cancellation',
      overrides: {
        cancellationRequest: cancellationRequest({ status: 'needs_review' }),
      },
      visible: ['상태 다시 확인'],
      hidden: ['배송 시작', '배송 완료', '청약철회 승인', '요청 거절'],
    },
    {
      name: 'processing cancellation',
      overrides: {
        cancellationRequest: cancellationRequest({ status: 'processing' }),
      },
      visible: ['처리 상태 확인'],
      hidden: ['배송 시작', '배송 완료', '청약철회 승인', '요청 거절'],
    },
    {
      name: 'rejected cancellation on a paid order',
      overrides: {
        cancellationRequest: cancellationRequest({
          status: 'rejected',
          decidedAt: '2026-07-14T08:00:00.000Z',
          decisionNote: '배송 준비가 이미 완료되었습니다.',
        }),
      },
      visible: ['배송 시작', '요청 거절'],
      hidden: ['배송 완료', '청약철회 승인', '상태 다시 확인'],
    },
    {
      name: 'completed cancellation awaiting an order refresh',
      overrides: {
        cancellationRequest: cancellationRequest({
          status: 'completed',
          decidedAt: '2026-07-14T08:00:00.000Z',
        }),
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

    expect(html).toContain('action="/admin/sales/orders"');
    expect(html).not.toContain('name="section"');
    expect(html).toContain(
      'href="/admin/sales/orders?status=paid&amp;from=2026-07-01&amp;to=2026-07-14&amp;query=maple+fan&amp;page=2&amp;order=44444444-4444-4444-8444-444444444444"',
    );
    expect(html).toContain(
      'href="/admin/sales/orders?status=paid&amp;from=2026-07-01&amp;to=2026-07-14&amp;query=maple+fan&amp;page=1"',
    );
    expect(html).toContain(
      'href="/admin/sales/orders?status=paid&amp;from=2026-07-01&amp;to=2026-07-14&amp;query=maple+fan&amp;page=3"',
    );
    expect(html).toContain('2 / 3 페이지');
  });

  it.each(['shipping', 'done'] as const)('exposes the cancellation decision on a %s order', (status) => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      status,
      cancellationRequest: {
        id: '33333333-3333-4333-8333-333333333333',
        status: 'requested',
        reasonType: 'change_of_mind',
        requestedAt: '2026-07-14T07:00:00.000Z',
        decidedAt: null,
        decisionNote: null,
      },
    })} />);

    expect(html).toContain('청약철회 승인');
    expect(html).toContain('요청 거절');
    expect(html).toContain('data-confirm="반품 물건 입고를 확인하셨나요? 승인하면 결제 취소와 재고 복원이 진행됩니다."');
  });

  /* 사유는 기한(7일 vs 3개월)과 반송비 부담 주체를 가른다. 운영자가 승인·거절을
     누르는 화면에서 보여야 판단 근거가 된다(#196). */
  it('하자·오배송 요청의 사유를 목록과 상세에 함께 노출한다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      status: 'shipping',
      cancellationRequest: {
        id: '33333333-3333-4333-8333-333333333333',
        status: 'requested',
        reasonType: 'defect',
        requestedAt: '2026-07-14T07:00:00.000Z',
        decidedAt: null,
        decisionNote: null,
      },
    })} />);

    expect(html).toContain('admin-order-row-reason');
    expect(html).toContain(`aria-label="주문 ${ORDER_ID.slice(0, 8)} 선택 · 청약철회 상품 하자·오배송"`);
    expect(html).toContain('상품 하자·오배송');
    expect(html).toContain('admin-order-reason--defect');
    expect(html).toContain('공급받은 날부터 3개월');
    expect(html).toContain('반송비 회사 부담');
  });

  it('단순 변심 요청은 하자와 다른 사유 표시를 쓴다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      status: 'shipping',
      cancellationRequest: {
        id: '33333333-3333-4333-8333-333333333333',
        status: 'requested',
        reasonType: 'change_of_mind',
        requestedAt: '2026-07-14T07:00:00.000Z',
        decidedAt: null,
        decisionNote: null,
      },
    })} />);

    expect(html).toContain('단순 변심');
    expect(html).toContain('admin-order-reason--change_of_mind');
    expect(html).not.toContain('admin-order-reason--defect');
    expect(html).toContain('공급받은 날부터 7일');
    expect(html).toContain('반송비 이용자 부담');
  });

  it('청약철회 요청이 없는 주문은 사유 표시를 만들지 않는다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData()} />);

    expect(html).not.toContain('admin-order-reason');
    expect(html).not.toContain('admin-order-row-reason');
  });

  /* 반송은 배송이 시작된 주문에서만 일어난다. 미출고 주문에 부담 주체를 띄우면
     존재하지 않는 사건을 판단 근거로 제시하는 셈이다. */
  it('미출고 주문에는 반송비 부담 주체를 표시하지 않는다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      status: 'paid',
      cancellationRequest: {
        id: '33333333-3333-4333-8333-333333333333',
        status: 'requested',
        reasonType: 'defect',
        requestedAt: '2026-07-14T07:00:00.000Z',
        decidedAt: null,
        decisionNote: null,
      },
    })} />);

    expect(html).toContain('상품 하자·오배송');
    expect(html).toContain('공급받은 날부터 3개월');
    expect(html).not.toContain('반송비');
  });

  /* 목록 배지는 승인 대기 건을 찾기 위한 것이다. 종료된 요청까지 남기면 처리
     완료 주문이 미처리처럼 보인다. */
  it.each(['completed', 'rejected'] as const)('처리가 끝난 %s 요청은 목록 배지를 만들지 않는다', (status) => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      cancellationRequest: {
        id: '33333333-3333-4333-8333-333333333333',
        status,
        reasonType: 'defect',
        requestedAt: '2026-07-14T07:00:00.000Z',
        decidedAt: '2026-07-14T08:00:00.000Z',
        decisionNote: null,
      },
    })} />);

    expect(html).not.toContain('admin-order-row-reason');
    expect(html).toContain(`aria-label="주문 ${ORDER_ID.slice(0, 8)} 선택"`);
    // 상세에는 남는다 — 어떤 사유로 종결됐는지는 사후에도 필요하다.
    expect(html).toContain('admin-order-reason--defect');
  });

  it('배송 시작 폼에서 택배사와 운송장번호를 필수로 받는다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData()} />);

    expect(html).toContain('name="carrier"');
    expect(html).toContain('value="hanjin"');
    expect(html).toContain('한진택배');
    expect(html).toContain('name="trackingNumber"');
    expect(html).toContain(`for="admin-order-tracking-${ORDER_ID}">운송장번호`);
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
    expect(html).toContain('data-confirm="운송장번호를 수정할까요? 변경 이력이 감사 로그에 남습니다."');
  });

  it('배송 전 주문에는 운송장 수정 폼을 노출하지 않는다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData()} />);

    expect(html).not.toContain('운송장 수정');
  });

  it('renders explicit confirmations and an accessible rejection reason field', () => {
    const requestId = '33333333-3333-4333-8333-333333333333';
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      cancellationRequest: cancellationRequest({
        id: requestId,
      }),
    })} />);

    expect(html).toContain('data-confirm="청약철회를 승인하고 결제 취소를 시작할까요?"');
    expect(html).toContain('data-confirm="청약철회 요청을 거절할까요? 입력한 사유가 기록됩니다."');
    expect(html).toContain(`for="admin-order-reject-reason-${requestId}">거절 사유`);
    expect(html).toContain('minLength="10"');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('aria-live="polite"');
  });

  /* 오류 상태는 서버 렌더에서 재현되지 않으므로 useActionState만 대체해 확인한다. */
  it('운송장 입력 오류를 대응 필드에 aria-describedby로 연결한다', async () => {
    vi.resetModules();
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return {
        ...actual,
        useActionState: () => [
          { errors: { carrier: '택배사를 선택해주세요.', trackingNumber: '운송장번호를 입력해주세요.' } },
          () => {},
          false,
        ],
      };
    });

    try {
      const { OrdersSection: ErroredOrdersSection } = await import('./Orders');
      const html = renderToStaticMarkup(<ErroredOrdersSection data={orderData()} />);

      expect(html).toContain('운송장번호를 입력해주세요.');
      expect(html).toContain(`aria-describedby="admin-order-carrier-error-${ORDER_ID}"`);
      expect(html).toContain(`id="admin-order-carrier-error-${ORDER_ID}"`);
      expect(html).toContain(`aria-describedby="admin-order-tracking-error-${ORDER_ID}"`);
      expect(html).toContain(`id="admin-order-tracking-error-${ORDER_ID}"`);
    } finally {
      vi.doUnmock('react');
      vi.resetModules();
    }
  });

  it('Korpay 원장 확인 오류를 attestation checkbox에 연결한다', async () => {
    vi.resetModules();
    const focus = vi.fn();
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return {
        ...actual,
        useActionState: () => [
          { errors: { operatorAttestation: '결제사 원장에서 전액 취소를 확인해야 합니다.' } },
          () => {},
          false,
        ],
        useEffect: (effect: () => void) => effect(),
        useRef: () => ({ current: { focus } }),
      };
    });

    try {
      const { OrdersSection: ErroredOrdersSection } = await import('./Orders');
      const request = cancellationRequest({ status: 'needs_review' });
      const attemptId = '44444444-4444-4444-8444-444444444444';
      const html = renderToStaticMarkup(<ErroredOrdersSection data={orderData({
        cancellationRequest: request,
        manualRecoveryAttempt: {
          attemptId,
          requestId: request.id,
          providerOrderId: 'O0123456789ABCDEF',
          state: 'unknown',
          amount: 32000,
          currency: 'KRW',
          manualRecoveryAvailable: true,
        },
      })} />);
      const errorId = `admin-korpay-cancel-attestation-error-${attemptId}`;

      expect(html).toContain('결제사 원장에서 전액 취소를 확인해야 합니다.');
      expect(html).toContain(`aria-describedby="${errorId}"`);
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain(`id="${errorId}" role="alert"`);
      expect(focus).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock('react');
      vi.resetModules();
    }
  });
});
