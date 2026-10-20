import { shipmentFixture } from '@/lib/orders/shipments.fixture';
import { shipmentDeliveryFixture } from '@/lib/shipment-delivery.fixture';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  AdminOrderCancellationRequestRecord,
  AdminOrderConsoleData,
  AdminOrderRecord,
} from '@/lib/admin/orders';
import { OrdersSection } from './Orders';

const orderActions = vi.hoisted(() => ({
  bulkConfirmAdminOrdersAction: vi.fn(),
  approveAdminOrderCancellationAction: vi.fn(),
  recoverAdminGoodsPaymentAction: vi.fn(),
  reconcileAdminOrderCancellationAction: vi.fn(),
  rejectAdminOrderCancellationAction: vi.fn(),
  startAdminOrderCancellationAction: vi.fn(),
  updateAdminOrderStatusAction: vi.fn(),
  updateAdminOrderTrackingAction: vi.fn(),
}));

vi.mock('@/app/admin/order-actions', () => orderActions);

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const SHIPMENT_ID = '00000000-0000-4000-8000-000000044701';

/* 택배사 드롭다운은 DB 레지스트리에서 온다(#251). 상수 목록이 없으므로 콘솔이
   목록 응답에 실려 온 값을 그대로 쓰는지 함께 고정한다. */
const CARRIERS = [
  {
    code: 'hanjin',
    label: '한진택배',
    active: true,
    trackingUrlTemplate: 'https://example.test/track?no={trackingNumber}',
  },
  {
    code: 'retired_courier',
    label: '계약종료 택배',
    active: false,
    trackingUrlTemplate: 'https://example.test/old?no={trackingNumber}',
  },
];

function cancellationRequest(
  overrides: Partial<AdminOrderCancellationRequestRecord> = {},
): AdminOrderCancellationRequestRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    status: 'requested',
    claimType: 'cancel',
    stage: 'requested',
    reasonType: 'change_of_mind',
    staffReasonCode: null,
    requestedAt: '2026-07-14T07:00:00.000Z',
    decidedAt: null,
    decisionNote: null,
    lastErrorCode: null,
    ...overrides,
  };
}

function orderData(overrides: Partial<AdminOrderRecord> = {}): AdminOrderConsoleData {
  return {
    carriers: CARRIERS,
    filters: {
      field: 'all',
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
        variantId: '00000000-0000-4000-8000-000000000001',
        name: '화산강림 아크릴 스탠드',
        type: '아크릴 스탠드',
        qty: 1,
        unitPrice: 32000,
      }],
      payments: [{
        id: 'payment-1',
        provider: 'toss',
        amount: 32000,
        status: 'paid',
        createdAt: '2026-07-14T06:01:00.000Z',
        paymentKey: 'must-not-render',
        raw: { cardNumber: 'must-not-render' },
      } as never],
      refunds: [],
      cancellationRequest: null,
      manualRecoveryAttempt: null,
      shipments: ['shipping','delivered','done'].includes(overrides.status ?? 'paid')
        ? [shipmentFixture({orderId:ORDER_ID,status:overrides.status==='shipping'?'shipping':'delivered'})] : [],
      ...overrides,
    }],
    pageSize: 20,
    total: 1,
  };
}

/*
 * 상태 버튼 라벨(`발주확인`·`배송완료`)은 상태 필터 드롭다운 문구와 글자가 같아
 * 화면 어디에나 존재한다(#250). 어떤 전이 폼이 실제로 떴는지는 hidden input의
 * 값으로만 정확히 가려낼 수 있다.
 */
const STATUS_ACTION_MARKERS: Record<string, string> = {
  발주확인: 'name="status" value="confirmed"',
  발송처리: 'name="status" value="shipping"',
  배송완료: 'name="status" value="delivered"',
};

function actionMarker(label: string) {
  return STATUS_ACTION_MARKERS[label] ?? label;
}

describe('OrdersSection', () => {
  // ADR-0018: 발송 전 주문만 운영자 전액 취소를 시작할 수 있다. 출고지시가 나간
  // 배송 건이 있으면 창고 출고 중단 확인을 함께 받는다.
  describe('운영자 전액 취소', () => {
    const readyShipment = (exportedAt: string | null) => shipmentFixture({
      orderId: ORDER_ID, status: 'ready', carrier: null, carrierLabel: null, trackingNumber: null,
      trackingUrl: null, shippedAt: null, exportedAt,
    });

    it('발송 전 paid 주문에 사유 선택과 함께 그리고 창고 확인은 묻지 않는다', () => {
      const html = renderToStaticMarkup(<OrdersSection data={orderData({ shipments: [readyShipment(null)] })} />);
      expect(html).toContain('aria-label="운영자 전액 취소"');
      expect(html).toContain('<option value="test_payment_cleanup">테스트 결제 정리</option>');
      expect(html).toContain('<option value="out_of_stock">품절·출고 불가</option>');
      expect(html).not.toContain('name="warehouseStopConfirmed"');
      expect(html).toContain('전액 취소 실행');
    });

    it('출고지시가 나간 발주확인 주문은 창고 출고 중단 확인을 필수로 받는다', () => {
      const html = renderToStaticMarkup(<OrdersSection data={orderData({
        status: 'confirmed', shipments: [readyShipment('2026-10-12T01:00:00Z')],
      })} />);
      expect(html).toContain('name="warehouseStopConfirmed"');
      expect(html).toContain('창고에 출고 중단을 확인했습니다.');
    });

    it('발송된 배송 건이 있거나 진행 중인 요청이 있으면 그리지 않는다', () => {
      const shipped = renderToStaticMarkup(<OrdersSection data={orderData({
        status: 'confirmed', shipments: [shipmentFixture({ orderId: ORDER_ID, status: 'shipping' })],
      })} />);
      expect(shipped).not.toContain('aria-label="운영자 전액 취소"');
      const pending = renderToStaticMarkup(<OrdersSection data={orderData({
        shipments: [readyShipment(null)], cancellationRequest: cancellationRequest(),
      })} />);
      expect(pending).not.toContain('aria-label="운영자 전액 취소"');
      const unpaid = renderToStaticMarkup(<OrdersSection data={orderData({ status: 'pending', shipments: [] })} />);
      expect(unpaid).not.toContain('aria-label="운영자 전액 취소"');
    });

    // DB staff_cancellation_toss_only와 같은 조건 — 누르면 항상 거절되는 버튼을 그리지 않는다.
    it('토스 결제완료가 아닌 결제가 걸린 주문에는 그리지 않는다', () => {
      const payment = (provider: string, status = 'paid') => ({
        id: `payment-${provider}-${status}`, provider, amount: 32000, status, createdAt: '2026-07-14T06:01:00.000Z',
      });
      for (const payments of [
        [payment('korpay')],
        [payment('bank_transfer')],
        [payment('toss'), payment('korpay')],
        [payment('toss', 'refunded')],
        [payment('toss', 'failed')],
        [],
      ]) {
        const html = renderToStaticMarkup(<OrdersSection data={orderData({ shipments: [readyShipment(null)], payments })} />);
        expect(html, JSON.stringify(payments)).not.toContain('aria-label="운영자 전액 취소"');
      }
      const failedThenPaid = renderToStaticMarkup(<OrdersSection data={orderData({
        shipments: [readyShipment(null)], payments: [payment('toss', 'failed'), payment('toss')],
      })} />);
      expect(failedThenPaid).toContain('aria-label="운영자 전액 취소"');
    });
  });

  it('주문 대조 금액은 0원·경계값·큰 금액을 모두 원 단위로 보여주고 paid를 신규주문으로 표시한다', () => {
    const data = orderData({
      total: 42000,
      items: [{
        id: 'item-1',
        variantId: '00000000-0000-4000-8000-000000000001',
        name: '경계 상품',
        type: '굿즈',
        qty: 1,
        unitPrice: 9999,
      }],
      payments: [{
        id: 'payment-1',
        provider: 'toss',
        amount: 10000,
        status: 'paid',
        createdAt: '2026-07-14T06:01:00.000Z',
      }],
      refunds: [{
        id: 'refund-1',
        amount: 0,
        status: 'completed',
        createdAt: '2026-07-14T06:02:00.000Z',
      }],
    });
    const html = renderToStaticMarkup(<OrdersSection data={data} />);

    expect(html).toContain('₩42,000');
    expect(html).toContain('₩9,999');
    expect(html).toContain('₩10,000');
    expect(html).toContain('₩0');
    expect(html).not.toContain('₩4만');
    expect(html).toMatch(/order-status order-status--paid[^>]*>신규주문/);
  });

  it('opens no replacement panel when a linked order is outside the current page', () => {
    const data = orderData();
    data.filters.orderId = '99999999-9999-4999-8999-999999999999';
    const html = renderToStaticMarkup(<OrdersSection data={data} />);
    expect(html).toContain('선택한 주문은 현재 목록에 없습니다');
    expect(html).toContain('/admin/sales/orders/99999999-9999-4999-8999-999999999999');
    expect(html).not.toContain('서울 성동구 성수이로 1');
    expect(html).not.toContain(STATUS_ACTION_MARKERS['발주확인']);
  });
  /* 택배사 드롭다운을 상수로 채우면 레지스트리와 갈라져 저장은 되는데 조회는
     안 되는 운송장이 생긴다. 비활성 택배사는 고를 수 없어야 한다(#251). */
  it('택배사 드롭다운을 레지스트리의 활성 택배사로만 채운다', () => {
    const html = renderToStaticMarkup(
      <OrdersSection data={orderData({ status: 'shipping' })} />,
    );

    expect(html).toContain('value="hanjin"');
    expect(html).toContain('한진택배</option>');
    expect(html).not.toContain('계약종료 택배');
  });

  it('renders staff-safe order detail and the paid-to-confirmed action without provider secrets', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData()} />);

    expect(html).toContain('주문 검색');
    expect(html).toContain('maple_fan');
    expect(html).toContain('fan@example.test');
    expect(html).toContain('화산강림 아크릴 스탠드');
    expect(html).toContain('서울 성동구 성수이로 1');
    expect(html).toContain(STATUS_ACTION_MARKERS['발주확인']);
    expect(html).toContain(`/admin/sales/orders/${ORDER_ID}?back=`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('상세 열기 (새 탭)');
    expect(html).not.toContain('must-not-render');
  });

  it('offers the recipient and shipment tracking search targets in the filter', () => {
    const data = orderData();
    // The filter is carried by the server-rendered URL; this verifies the selected
    // option survives a refresh alongside the existing order filters.
    data.filters = { ...data.filters, field: 'tracking' };
    const html = renderToStaticMarkup(<OrdersSection data={data} />);

    expect(html).toContain('aria-label="검색 유형"');
    expect(html).toContain('name="field"');
    expect(html).toContain('<option value="recipient">수취인</option>');
    expect(html).toContain('<option value="tracking" selected="">운송장번호</option>');
    expect(html).toContain('placeholder="검색어를 입력하세요"');
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
      hidden: ['발주확인', '발송처리', '배송완료', '상태 다시 확인'],
    },
    {
      name: 'needs-review cancellation',
      overrides: {
        cancellationRequest: cancellationRequest({
          stage: 'needs_review',
          status: 'needs_review',
        }),
      },
      visible: ['상태 다시 확인'],
      hidden: ['발주확인', '발송처리', '배송완료', '청약철회 승인', '요청 거절'],
    },
    {
      name: 'processing cancellation',
      overrides: {
        cancellationRequest: cancellationRequest({
          stage: 'processing',
          status: 'processing',
        }),
      },
      visible: ['처리 상태 확인'],
      hidden: ['발주확인', '발송처리', '배송완료', '청약철회 승인', '요청 거절'],
    },
    {
      name: 'rejected cancellation on a paid order',
      overrides: {
        cancellationRequest: cancellationRequest({
          stage: 'rejected',
          status: 'rejected',
          decidedAt: '2026-07-14T08:00:00.000Z',
          decisionNote: '배송 준비가 이미 완료되었습니다.',
        }),
      },
      visible: ['발주확인', '거부'],
      hidden: ['발송처리', '배송완료', '청약철회 승인', '요청 거절', '상태 다시 확인', '취소·반품·교환 관리에서 처리'],
    },
    {
      name: 'withdrawn cancellation on a paid order',
      overrides: {
        cancellationRequest: cancellationRequest({ stage: 'withdrawn', status: 'rejected' }),
      },
      visible: ['발주확인', '요청 철회', 'aria-label="운영자 전액 취소"'],
      hidden: ['청약철회 승인', '요청 거절', '상태 다시 확인', '취소·반품·교환 관리에서 처리'],
    },
    {
      name: 'withdrawn cancellation on a confirmed order',
      overrides: {
        status: 'confirmed' as const,
        cancellationRequest: cancellationRequest({ stage: 'withdrawn', status: 'rejected' }),
      },
      visible: ['배송 건별 운송장 등록', '요청 철회', 'aria-label="운영자 전액 취소"'],
      hidden: ['청약철회 승인', '요청 거절', '상태 다시 확인', '취소·반품·교환 관리에서 처리'],
    },
    {
      name: 'withdrawn return on a shipping order',
      overrides: {
        status: 'shipping' as const,
        cancellationRequest: cancellationRequest({ claimType: 'return', stage: 'withdrawn', status: 'rejected' }),
      },
      visible: ['배송 건별 배송완료 처리', '요청 철회'],
      hidden: ['청약철회 승인', '요청 거절', '상태 다시 확인', '취소·반품·교환 관리에서 처리', 'aria-label="운영자 전액 취소"'],
    },
    {
      name: 'completed cancellation awaiting an order refresh',
      overrides: {
        cancellationRequest: cancellationRequest({
          stage: 'completed',
          status: 'completed',
          decidedAt: '2026-07-14T08:00:00.000Z',
        }),
      },
      visible: ['처리완료'],
      hidden: [
        '발주확인', '발송처리', '배송완료', '청약철회 승인', '요청 거절', '상태 다시 확인',
        '취소·반품·교환 관리에서 처리',
      ],
    },
    /* 새 stage는 전부 status='requested'로 투영된다. 주문 콘솔이 그 투영으로
       판단하면 수거 중인 반품에 [청약철회 승인]이 뜨고, 누르면 입고 확인을
       건너뛴 채 전액 환불과 재고 복원이 끝난다(#252 F1). */
    {
      name: 'return claim being collected',
      overrides: {
        status: 'delivered' as const,
        cancellationRequest: cancellationRequest({ claimType: 'return', stage: 'collecting' }),
      },
      visible: ['취소·반품·교환 관리에서 처리', '수거중'],
      hidden: ['청약철회 승인', '요청 거절'],
    },
    {
      name: 'exchange claim already received',
      overrides: {
        status: 'delivered' as const,
        cancellationRequest: cancellationRequest({ claimType: 'exchange', stage: 'collected' }),
      },
      visible: ['취소·반품·교환 관리에서 처리', '교환 요청', '입고완료'],
      hidden: ['청약철회 승인', '요청 거절'],
    },
    {
      name: 'claim on hold',
      overrides: {
        status: 'delivered' as const,
        cancellationRequest: cancellationRequest({ claimType: 'return', stage: 'on_hold' }),
      },
      visible: ['취소·반품·교환 관리에서 처리', '보류'],
      hidden: ['청약철회 승인', '요청 거절'],
    },
    {
      name: 'cancel claim under review',
      overrides: {
        cancellationRequest: cancellationRequest({ stage: 'in_review' }),
      },
      visible: ['취소·반품·교환 관리에서 처리', '검토중'],
      hidden: ['청약철회 승인', '요청 거절'],
    },
    {
      name: 'confirmed order',
      overrides: { status: 'confirmed' as const },
      visible: ['배송 건별 운송장 등록'],
      hidden: ['발주확인', '배송완료', '청약철회 승인', '요청 거절', '상태 다시 확인'],
    },
    {
      name: 'shipping order',
      overrides: { status: 'shipping' as const },
      visible: ['배송 건별 배송완료 처리'],
      hidden: ['발주확인', '발송처리', '청약철회 승인', '요청 거절', '상태 다시 확인'],
    },
    /* delivered→done은 자동 거래확정 잡이 소유한다. 운영자 버튼이 생기면
       청약철회 창을 사람 손으로 조기 종료시킬 수 있다. */
    {
      name: 'delivered order awaiting automatic settlement',
      overrides: { status: 'delivered' as const },
      visible: ['운송장 수정'],
      hidden: ['발주확인', '발송처리', '배송완료', '청약철회 승인', '요청 거절'],
    },
  ])('exposes only the allowed action for $name', ({ overrides, visible, hidden }) => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData(overrides)} />);

    for (const label of visible) expect(html).toContain(actionMarker(label));
    for (const label of hidden) expect(html).not.toContain(actionMarker(label));
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
      field: 'all',
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
      'href="/admin/sales/orders?status=paid&amp;from=2026-07-01&amp;to=2026-07-14&amp;query=maple+fan&amp;page=2&amp;order=44444444-4444-4444-8444-444444444444#sales-order-detail"',
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
      cancellationRequest: cancellationRequest(),
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
      cancellationRequest: cancellationRequest({ reasonType: 'defect' }),
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
      cancellationRequest: cancellationRequest(),
    })} />);

    expect(html).toContain('단순 변심');
    expect(html).toContain('admin-order-reason--change_of_mind');
    expect(html).not.toContain('admin-order-reason--defect');
    expect(html).toContain('공급받은 날부터 7일');
    expect(html).toContain('반송비 이용자 부담');
  });

  /* 2026-10-12 QA-4: 운영자 전액 취소는 구매자 단순 변심이 아니다. 운영 사유를 적고
     구매자 청약철회 기한을 붙이지 않는다. */
  it('운영자 전액 취소 요청은 단순 변심 대신 운영 사유를 보여준다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      cancellationRequest: cancellationRequest({
        status: 'needs_review',
        stage: 'needs_review',
        reasonType: 'staff',
        staffReasonCode: 'out_of_stock',
      }),
    })} />);

    expect(html).toContain('운영자 전액 취소 · 품절·출고 불가');
    expect(html).toContain('admin-order-reason--staff');
    expect(html).toContain(`aria-label="주문 ${ORDER_ID.slice(0, 8)} 선택 · 운영자 전액 취소 · 품절·출고 불가"`);
    expect(html).not.toContain('단순 변심');
    expect(html).not.toContain('공급받은 날부터 7일');
    expect(html).toContain('운영자가 시작한 발송 전 전액 취소');
  });

  /* 2026-10-12 QA-10: 결제확인필요 요청의 원인 코드는 주문 패널에서도 보인다. */
  it('결제확인필요 요청의 정합화 오류 코드를 취소 요청 영역에 보여준다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      cancellationRequest: cancellationRequest({
        status: 'needs_review',
        stage: 'needs_review',
        reasonType: 'staff',
        staffReasonCode: 'out_of_stock',
        lastErrorCode: 'provider_unavailable',
      }),
    })} />);

    expect(html).toContain('정합화 오류 · <code class="mono">provider_unavailable</code>');
    expect(html).toContain('상태 다시 확인');
  });

  it('종결된 요청에는 지난 정합화 오류 코드를 다시 띄우지 않는다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      status: 'canceled',
      cancellationRequest: cancellationRequest({ status: 'completed', stage: 'completed', lastErrorCode: 'provider_unavailable' }),
    })} />);

    expect(html).not.toContain('provider_unavailable');
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
      cancellationRequest: cancellationRequest({ reasonType: 'defect' }),
    })} />);

    expect(html).toContain('상품 하자·오배송');
    expect(html).toContain('공급받은 날부터 3개월');
    expect(html).not.toContain('반송비');
  });

  /* 목록 배지는 승인 대기 건을 찾기 위한 것이다. 종료된 요청까지 남기면 처리
     완료 주문이 미처리처럼 보인다. */
  it.each(['completed', 'rejected'] as const)('처리가 끝난 %s 요청은 목록 배지를 만들지 않는다', (status) => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      cancellationRequest: cancellationRequest({
        status,
        stage: status,
        reasonType: 'defect',
        decidedAt: '2026-07-14T08:00:00.000Z',
      }),
    })} />);

    expect(html).not.toContain('admin-order-row-reason');
    expect(html).toContain(`aria-label="주문 ${ORDER_ID.slice(0, 8)} 선택"`);
    // 상세에는 남는다 — 어떤 사유로 종결됐는지는 사후에도 필요하다.
    expect(html).toContain('admin-order-reason--defect');
  });

  it('배송 건 운송장 정정 폼에서 택배사와 운송장번호를 필수로 받는다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({ status: 'shipping' })} />);

    expect(html).toContain('name="carrier"');
    expect(html).toContain('value="hanjin"');
    expect(html).toContain('한진택배');
    expect(html).toContain('name="trackingNumber"');
    expect(html).toContain(`for="admin-order-edit-${SHIPMENT_ID}-tracking-${ORDER_ID}">운송장번호`);
    expect(html).toContain('required=""');
  });

  it('운송장이 등록된 주문은 값과 수정 폼을 함께 보여준다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({
      status: 'shipping',
      shipments: [shipmentFixture()],
    })} />);

    expect(html).toContain('123456789012');
    expect(html).toContain('운송장 수정');
    expect(html).toContain('data-confirm="운송장번호를 수정할까요? 변경 이력이 감사 로그에 남습니다."');
  });

  it('배송 전 주문에는 운송장 수정 폼을 노출하지 않는다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData()} />);

    expect(html).not.toContain('운송장 수정');
  });
  it('퀵·방문수령은 운송장을 요구하지 않고 필터를 보존한 주문 상세 인계 확인으로 연결한다', () => {
    const html = renderToStaticMarkup(<OrdersSection data={orderData({ status: 'shipping', shipments: [shipmentFixture({
      status: 'shipping', carrier: null, carrierLabel: null, trackingNumber: null, trackingUrl: null,
      delivery: shipmentDeliveryFixture({ method: 'quick', providerName: '실제 퀵 업체' }),
    })] })} />);
    expect(html).toContain('퀵 배송 중'); expect(html).toContain('퀵 인계·수령 확인');
    expect(html).toContain(`/admin/sales/orders/${ORDER_ID}?back=`);
    expect(html).not.toContain('name="carrier"'); expect(html).not.toContain('name="trackingNumber"');
    expect(html).not.toContain('운송장 수정'); expect(html).not.toContain('배송 건별 배송완료 처리');
  });
  it('택배와 퀵이 섞인 주문은 택배 배송 건의 운송장만 수정할 수 있다', () => {
    const quickId = '00000000-0000-4000-8000-000000000492';
    const html = renderToStaticMarkup(<OrdersSection data={orderData({ status: 'shipping', shipments: [shipmentFixture(),
      shipmentFixture({ id: quickId, delivery: shipmentDeliveryFixture({ method: 'quick' }) })] })} />);
    expect(html).toContain(`name="shipmentId" value="${SHIPMENT_ID}"`);
    expect(html).not.toContain(`name="shipmentId" value="${quickId}"`);
    expect(html).toContain('퀵 인계·수령 확인'); expect(html).toContain('배송 건별 배송완료 처리');
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
      const html = renderToStaticMarkup(
        <ErroredOrdersSection data={orderData({ status: 'shipping' })} />,
      );

      expect(html).toContain('운송장번호를 입력해주세요.');
      expect(html).toContain(`aria-describedby="admin-order-edit-${SHIPMENT_ID}-carrier-error-${ORDER_ID}"`);
      expect(html).toContain(`id="admin-order-edit-${SHIPMENT_ID}-carrier-error-${ORDER_ID}"`);
      expect(html).toContain(`aria-describedby="admin-order-edit-${SHIPMENT_ID}-tracking-error-${ORDER_ID}"`);
      expect(html).toContain(`id="admin-order-edit-${SHIPMENT_ID}-tracking-error-${ORDER_ID}"`);
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
          {
            intent: 'korpayRecovery',
            orderId: ORDER_ID,
            errors: { operatorAttestation: '결제사 원장에서 전액 취소를 확인해야 합니다.' },
          },
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

 it('두 배송건 정정 폼은 서로 다른 shipmentId와 오류 필드 ID를 사용한다', () => {
  const second = '00000000-0000-4000-8000-000000044702';
  const html = renderToStaticMarkup(<OrdersSection data={orderData({status:'shipping',shipments:[shipmentFixture(),shipmentFixture({id:second,originName:'남양주'})]})} />);
  for (const id of [SHIPMENT_ID,second]) {
   expect(html).toContain(`name="shipmentId" value="${id}"`);
   expect(html).toContain(`id="admin-order-edit-${id}-tracking-${ORDER_ID}"`);
  }
  expect(html).not.toContain(STATUS_ACTION_MARKERS['배송완료']);
  expect(html).toContain('배송 건별 배송완료 처리');
 });

describe('주문 통합검색 목록 엑셀 다운로드', () => {
  it('적용된 검색 조건 그대로의 다운로드 주소를 필터 옆에 둔다', () => {
    const data = orderData();
    data.filters = { ...data.filters, field: 'recipient', query: '배송 수취인', status: 'paid', from: '2026-10-01', page: 3 };
    data.total = 57;
    const html = renderToStaticMarkup(<OrdersSection data={data} />);
    expect(html).toContain('목록 엑셀 다운로드');
    expect(html).toContain('data-export-href="/api/admin/list-export?screen=orders&amp;status=paid&amp;from=2026-10-01&amp;query=%EB%B0%B0%EC%86%A1+%EC%88%98%EC%B7%A8%EC%9D%B8&amp;field=recipient"');
    expect(html).toContain('전체 57건을 받습니다');
    expect(html.indexOf('admin-order-filters')).toBeLessThan(html.indexOf('목록 엑셀 다운로드'));
  });
});

it('query-only mode offers order search without any processing controls', () => {
  const html = renderToStaticMarkup(<OrdersSection data={orderData({ status: 'paid' })} canManage={false} />);
  expect(html).toContain('상세 보기');
  for (const text of ['선택 주문 발주확인', '배송 건별 운송장 등록', '판매자 직접 반품·교환 접수', '결제·환불', 'href="/admin/sales/dispatch"']) expect(html).not.toContain(text);
});

/*
 * 취소 처리 결과는 결과 뒤의 화면에 남아야 한다(2차 재검토 C2-1).
 *
 * 서버 액션의 revalidatePath가 같은 응답에 새 주문 패널을 실어 온다. 운영자 전액 취소는
 * 결과와 함께 요청이 생기거나 주문이 취소돼 그 양식이 사라지고, 상태 필터로 보던 목록에서는
 * 주문 자체가 빠질 수 있다. 서버 렌더에서는 액션 결과를 재현할 수 없어 useActionState만
 * 대체한다 — 운영자 전액 취소 액션이 돌려준 상태가 그 결과 뒤의 데이터로 그려진 화면에
 * 보이는지를 본다.
 */
describe('주문 패널 취소 처리 결과', () => {
  const failure = '전액 취소를 시작했지만 결제 취소를 확정하지 못했습니다(provider_rejected). 주문과 재고는 그대로 유지됩니다.';
  const success = '토스 전액 취소를 확인하고 주문 취소를 마쳤습니다.';

  async function renderAfterStaffCancellation(state: Record<string, unknown>, data: AdminOrderConsoleData) {
    vi.resetModules();
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      const otherActions = new Set<unknown>([
        orderActions.bulkConfirmAdminOrdersAction,
        orderActions.approveAdminOrderCancellationAction,
        orderActions.recoverAdminGoodsPaymentAction,
        orderActions.reconcileAdminOrderCancellationAction,
        orderActions.rejectAdminOrderCancellationAction,
        orderActions.updateAdminOrderStatusAction,
        orderActions.updateAdminOrderTrackingAction,
      ]);
      return {
        ...actual,
        useActionState: (fn: unknown, initial: unknown) => [otherActions.has(fn) ? initial : state, () => {}, false],
      };
    });
    try {
      const { OrdersSection: ResultOrdersSection } = await import('./Orders');
      return renderToStaticMarkup(<ResultOrdersSection data={data} />);
    } finally {
      vi.doUnmock('react');
      vi.resetModules();
    }
  }

  const occurrences = (html: string, text: string) => html.split(text).length - 1;

  it('결제확인필요로 떨어져 양식이 사라져도 실패 코드와 재시도 안내가 주문 패널에 남는다', async () => {
    const html = await renderAfterStaffCancellation(
      { intent: 'staffCancel', orderId: ORDER_ID, errors: { form: failure } },
      orderData({ cancellationRequest: cancellationRequest({ status: 'needs_review', stage: 'needs_review' }) }),
    );

    expect(html).not.toContain('aria-label="운영자 전액 취소"');
    expect(html).toContain(failure);
    expect(occurrences(html, failure)).toBe(1);
    expect(html).toContain('상태 다시 확인');
  });

  it('토스 전액 취소로 주문이 취소돼도 성공 결과가 남는다', async () => {
    const html = await renderAfterStaffCancellation(
      { intent: 'staffCancel', orderId: ORDER_ID, message: success },
      orderData({
        status: 'canceled',
        cancellationRequest: cancellationRequest({ status: 'completed', stage: 'completed' }),
      }),
    );

    expect(html).not.toContain('aria-label="운영자 전액 취소"');
    expect(html).toContain(success);
  });

  it('상태 필터 목록에서 빠진 주문의 결과는 목록 위에 주문번호와 주문 열기 링크로 남는다', async () => {
    const data = orderData();
    const otherId = '55555555-5555-4555-8555-555555555555';
    data.items = [{ ...data.items[0], id: otherId, buyerName: 'other_fan' }];
    data.filters = { ...data.filters, orderId: null, status: 'paid' };
    const html = await renderAfterStaffCancellation({ intent: 'staffCancel', orderId: ORDER_ID, message: success }, data);

    expect(html).toContain(success);
    expect(html).toContain(ORDER_ID.replaceAll('-', '').slice(-8).toUpperCase());
    expect(html).toContain(`href="/admin/sales/orders?query=${ORDER_ID}"`);
  });

  it('목록에 있지만 선택하지 않은 다른 주문의 결과는 지금 패널에 그리지 않는다', async () => {
    const data = orderData();
    const otherId = '55555555-5555-4555-8555-555555555555';
    data.items = [data.items[0], { ...data.items[0], id: otherId, buyerName: 'other_fan' }];
    const html = await renderAfterStaffCancellation({ intent: 'staffCancel', orderId: otherId, message: success }, data);

    expect(html).not.toContain(success);
  });

  it('다른 액션의 필드 오류는 엉뚱한 양식에 붙이지 않는다', async () => {
    const html = await renderAfterStaffCancellation(
      { intent: 'staffCancel', orderId: ORDER_ID, errors: { reason: '거절 사유를 10자 이상 입력해주세요.' } },
      orderData({ cancellationRequest: cancellationRequest() }),
    );

    expect(html).toContain('요청 거절');
    expect(html).not.toContain('거절 사유를 10자 이상 입력해주세요.');
  });
});

describe('runOrderCancellationAction', () => {
  it('양식이 고른 취소 액션만 부르고 결과에 액션과 주문을 붙인다', async () => {
    vi.clearAllMocks();
    const { runOrderCancellationAction } = await import('./Orders');
    orderActions.startAdminOrderCancellationAction.mockResolvedValue({ message: '완료' });
    const form = new FormData();
    form.set('cancellationIntent', 'staffCancel');
    form.set('cancellationOrderId', ORDER_ID);

    await expect(runOrderCancellationAction({}, form)).resolves.toEqual({
      intent: 'staffCancel',
      message: '완료',
      orderId: ORDER_ID,
    });
    expect(orderActions.startAdminOrderCancellationAction).toHaveBeenCalledWith({}, form);
    expect(orderActions.approveAdminOrderCancellationAction).not.toHaveBeenCalled();
  });

  it.each(['', 'toString', '__proto__', 'updateStatus'])('모르는 작업(%s)은 서버 액션을 부르지 않는다', async (intent) => {
    vi.clearAllMocks();
    const { runOrderCancellationAction } = await import('./Orders');
    const form = new FormData();
    form.set('cancellationIntent', intent);
    form.set('cancellationOrderId', ORDER_ID);

    const state = await runOrderCancellationAction({}, form);
    expect(state.errors?.form).toContain('처리할 작업을 확인하지 못했습니다');
    expect(state.orderId).toBe(ORDER_ID);
    for (const action of Object.values(orderActions)) expect(action).not.toHaveBeenCalled();
  });
});

/*
 * 운영자 전액 취소 양식 제출 순서(2026-10-12 브라우저 QA QA-5).
 *
 * 확인 창("되돌릴 수 없고 구매자에게 취소 알림이 갑니다")은 입력이 유효할 때만 뜬다.
 * 확인을 통과한 제출은 React 양식 action을 거치지 않아 서버가 거절해도 사유·메모가
 * 초기화되지 않는다 — 브라우저 상호작용은 서버 렌더 테스트로 재현할 수 없어 제출 계획과
 * 입력 검사를 따로 고정한다.
 */
describe('운영자 전액 취소 제출 순서', () => {
  const confirmation = '되돌릴 수 없습니다';

  function staffForm(fields: Record<string, string>) {
    const form = new FormData();
    form.set('orderId', ORDER_ID);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  }

  it('기타 사유의 짧은 메모는 확인 창을 띄우지 않고 메모 오류를 돌려준다', async () => {
    const { planOrderCancellationSubmit, staffCancellationClientErrors } = await import('./Orders');
    const confirm = vi.fn(() => true);

    const plan = planOrderCancellationSubmit(
      staffForm({ reasonCode: 'other', note: '짧음' }),
      confirmation,
      confirm,
      (form) => staffCancellationClientErrors(form, false),
    );

    expect(plan).toEqual({ kind: 'invalid', errors: { note: '기타 사유는 메모를 5자 이상 입력해주세요.' } });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('출고지시가 나간 주문은 창고 중단 확인 없이 확인 창으로 가지 않는다', async () => {
    const { planOrderCancellationSubmit, staffCancellationClientErrors } = await import('./Orders');
    const confirm = vi.fn(() => true);

    const plan = planOrderCancellationSubmit(
      staffForm({ reasonCode: 'out_of_stock', note: '' }),
      confirmation,
      confirm,
      (form) => staffCancellationClientErrors(form, true),
    );

    expect(plan).toMatchObject({ kind: 'invalid', errors: { warehouseStopConfirmed: expect.stringContaining('창고') } });
    expect(confirm).not.toHaveBeenCalled();
    expect(staffCancellationClientErrors(staffForm({ reasonCode: '' }), false)).toEqual({ reasonCode: '취소 사유를 선택해주세요.' });
  });

  it('유효한 입력만 확인 창을 거쳐 보낸다', async () => {
    const { planOrderCancellationSubmit, staffCancellationClientErrors } = await import('./Orders');
    const validate = (form: FormData) => staffCancellationClientErrors(form, true);
    const form = staffForm({ reasonCode: 'test_payment_cleanup', warehouseStopConfirmed: 'confirmed' });

    const accepted = vi.fn(() => true);
    expect(planOrderCancellationSubmit(form, confirmation, accepted, validate)).toEqual({ kind: 'dispatch' });
    expect(accepted).toHaveBeenCalledWith(confirmation);

    const declined = vi.fn(() => false);
    expect(planOrderCancellationSubmit(form, confirmation, declined, validate)).toEqual({ kind: 'dismissed' });
  });

  it('검사기가 없는 양식은 확인 창만 거친다', async () => {
    const { planOrderCancellationSubmit } = await import('./Orders');
    const confirm = vi.fn(() => true);
    expect(planOrderCancellationSubmit(new FormData(), confirmation, confirm)).toEqual({ kind: 'dispatch' });
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('양식은 브라우저 기본 검사 대신 같은 화면 오류로 사유·메모·창고 확인을 알린다', async () => {
    vi.resetModules();
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return {
        ...actual,
        useActionState: (fn: unknown, initial: unknown) => [
          fn === orderActions.bulkConfirmAdminOrdersAction || fn === orderActions.updateAdminOrderStatusAction || fn === orderActions.updateAdminOrderTrackingAction
            ? initial
            : {
              intent: 'staffCancel',
              orderId: ORDER_ID,
              errors: { warehouseStopConfirmed: '창고에 출고 중단을 확인한 뒤 확인란을 체크해주세요.' },
            },
          () => {},
          false,
        ],
      };
    });
    try {
      const { OrdersSection: ErroredOrdersSection } = await import('./Orders');
      const html = renderToStaticMarkup(<ErroredOrdersSection data={orderData({
        status: 'confirmed',
        shipments: [shipmentFixture({
          orderId: ORDER_ID, status: 'ready', carrier: null, carrierLabel: null, trackingNumber: null,
          trackingUrl: null, shippedAt: null, exportedAt: '2026-10-12T01:00:00Z',
        })],
      })} />);
      const stopId = `admin-order-staff-cancel-stop-${ORDER_ID}`;

      expect(html).toMatch(/aria-label="운영자 전액 취소"[^>]*novalidate=""/i);
      expect(html).toContain(`id="${stopId}-error" role="alert"`);
      expect(html).toContain(`aria-describedby="${stopId}-error"`);
    } finally {
      vi.doUnmock('react');
      vi.resetModules();
    }
  });
});
