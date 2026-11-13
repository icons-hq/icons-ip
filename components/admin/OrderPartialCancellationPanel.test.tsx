import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/admin/order-partial-cancellation-actions', () => ({
  loadOrderPartialCancellationAction: vi.fn(async () => ({ ok: true, value: { enabled: false, canManage: true, gift: false, blockers: ['partial_cancel_disabled'], history: [] } })),
  previewOrderPartialCancellationAction: vi.fn(),
  startOrderPartialCancellationAction: vi.fn(),
  retryOrderPartialCancellationAction: vi.fn(),
  resolveOrderPartialCancellationAction: vi.fn(),
  recordOrderPartialCancellationTransferAction: vi.fn(),
  viewOrderPartialCancellationRefundAccountAction: vi.fn(),
}));

import { OrderPartialCancellationPanel, OrderPartialCancellationPanelView } from './OrderPartialCancellationPanel';
import type { OrderPartialCancellationContext, OrderPartialCancellationRecord } from '@/lib/orders/partial-cancellation';

const ORDER_ID = '99999999-8888-4777-a666-555555555555';
const ITEM_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ITEM_B = 'aaaaaaaa-0000-4000-8000-00000000000b';

function context(overrides: Partial<OrderPartialCancellationContext> = {}): OrderPartialCancellationContext {
  return {
    enabled: true, canManage: true, gift: false, calculationVersion: 2, v1Allocation: null, blockers: [], provider: 'toss', paymentAmount: 40_000, balance: 40_000,
    items: [
      { orderItemId: ITEM_A, goodName: '품절 상품 A', variantName: '블루', variantCode: 'A-01', orderedQty: 2, canceledQty: 0, activeQty: 2, unitPrice: 10_000,
        shipmentId: 'bbbbbbbb-0000-4000-8000-000000000001', shipmentNumber: '2026111230000001', originName: '남양주', exported: false, blocker: null },
      { orderItemId: ITEM_B, goodName: '예약 상품 B', variantName: null, variantCode: null, orderedQty: 1, canceledQty: 0, activeQty: 1, unitPrice: 10_000,
        shipmentId: 'bbbbbbbb-0000-4000-8000-000000000001', shipmentNumber: '2026111230000001', originName: '남양주', exported: false, blocker: 'preorder_item' },
    ],
    history: [],
    ...overrides,
  };
}

function record(overrides: Partial<OrderPartialCancellationRecord> = {}): OrderPartialCancellationRecord {
  return {
    id: 'cccccccc-0000-4000-8000-000000000001', sequence: 1, state: 'completed', provider: 'toss', refundAmount: 9_500, goodsRefundAmount: 9_500,
    shippingRefundAmount: 0, storeCreditRestoreAmount: 0, createdAt: '2026-11-12T05:00:00Z', appliedAt: '2026-11-12T05:00:05Z',
    completedAt: '2026-11-12T05:00:05Z', transferredAt: null,
    items: [{ orderItemId: ITEM_A, goodName: '품절 상품 A', variantName: '블루', qty: 1, goodsRefundAmount: 9_500 }],
    closedShipmentCount: 0,
    staff: { customerDecision: '11/12 통화 — 있는 것만 받기', note: null, warehouseStopConfirmed: false, lastErrorCode: null, balanceBefore: 40_000,
      paymentAmount: 40_000, createdBy: '운영자', transferEvidence: null, transferNote: null, filedAt: null, resolution: null, resolutionReason: null,
      resolvedAt: null, closedShipments: [], refundAccount: null },
    ...overrides,
  };
}

const view = (value: OrderPartialCancellationContext) => renderToStaticMarkup(createElement(OrderPartialCancellationPanelView, { orderId: ORDER_ID, context: value, onReload: () => undefined }));

describe('재고 부족 부분 취소 패널', () => {
  it('문맥을 읽기 전(스위치 OFF 포함)에는 아무것도 그리지 않는다 — 주문 상세가 지금과 같다', () => {
    expect(renderToStaticMarkup(createElement(OrderPartialCancellationPanel, { orderId: ORDER_ID }))).toBe('');
  });

  it('켜진 발송 전 주문은 품목·수량 선택과 고객 결정 기록 칸을 그리고, 고를 수 없는 품목은 이유를 보인다', () => {
    const html = view(context());
    expect(html).toContain('재고 부족 부분 취소');
    expect(html).toContain('품절 상품 A · 블루');
    expect(html).toContain('예약 판매 상품');
    expect(html).toContain('고객 결정 기록 (필수)');
    expect(html).toContain('취소 내용 확인');
    expect(html).not.toContain('환불받을 계좌');
    expect(html).not.toContain('굿즈');
  });

  it('무통장 주문은 환불받을 계좌를 함께 받는다', () => {
    expect(view(context({ provider: 'bank_transfer' }))).toContain('환불받을 계좌 (무통장 주문)');
  });

  it('부분 취소를 받지 않는 결제는 양식 없이 이유만 보인다', () => {
    const html = view(context({ blockers: ['partial_cancel_unsupported'] }));
    expect(html).toContain('결제사 부분 취소를 받지 않아');
    expect(html).not.toContain('취소 내용 확인');
  });

  it('기록: 결제확인필요는 다시 확인 버튼, 송금 대기는 송금 완료 기록 양식을 보인다', () => {
    const html = view(context({ blockers: ['partial_cancel_in_progress'], history: [
      record({ id: 'cccccccc-0000-4000-8000-000000000002', sequence: 2, state: 'needs_review', completedAt: null, appliedAt: null,
        staff: { ...record().staff!, lastErrorCode: 'provider_unavailable' } }),
      record({ id: 'cccccccc-0000-4000-8000-000000000003', sequence: 3, state: 'awaiting_transfer', provider: 'bank_transfer', completedAt: null,
        staff: { ...record().staff!, refundAccount: { maskedAccount: '합성은행 ****1234', maskedHolder: '홍*동', purged: false } } }),
    ] }));
    expect(html).toContain('결제사 확인 다시 하기');
    expect(html).toContain('확인 코드: provider_unavailable');
    expect(html).toContain('송금 완료 기록');
    expect(html).toContain('합성은행 ****1234');
    expect(html).toContain('송금 대기');
    expect(html).toContain('결제확인필요');
    // 결제 담당 해소: 운영자는 사유만 적고, 서버가 결제사 잔액을 조회해 정한다.
    expect(html).toContain('결제확인필요 해소');
    expect(html).toContain('결제사 잔액 조회해 해소');
  });

  it('조회 권한(sales.read)만 있으면 기록만 읽는다 — 시작·다시 확인·해소·송금 양식이 없다', () => {
    const html = view(context({ canManage: false, items: [], history: [
      record({ id: 'cccccccc-0000-4000-8000-000000000004', state: 'needs_review', completedAt: null, appliedAt: null }),
      record({ id: 'cccccccc-0000-4000-8000-000000000005', sequence: 2, state: 'awaiting_transfer', provider: 'bank_transfer', completedAt: null }),
    ] }));
    expect(html).toContain('부분 취소 기록');
    expect(html).not.toContain('취소 내용 확인');
    expect(html).not.toContain('결제사 확인 다시 하기');
    expect(html).not.toContain('결제사 잔액 조회해 해소');
    expect(html).not.toContain('송금 완료 기록');
  });

  it('선물 주문은 환불이 결제한 분에게 간다고 알리고, 해소된 기록은 [해소]와 사유를 보인다', () => {
    expect(view(context({ gift: true }))).toContain('환불은 결제한 분에게');
    const html = view(context({ history: [record({ state: 'rejected', completedAt: null, appliedAt: null,
      staff: { ...record().staff!, resolution: 'not_moved', resolutionReason: '상점관리자 잔액 그대로', resolvedAt: '2026-11-12T06:00:00Z' } })] }));
    expect(html).toContain('[해소]');
    expect(html).toContain('상점관리자 잔액 그대로');
    expect(html).not.toContain('결제사가 이 결제의 부분 취소를 받지 않아');
  });

  it('버전 1 주문은 같은 양식에 첫 부분 취소 때 금액 배분을 확정한다는 안내를 한 줄 둔다', () => {
    const html = view(context({ calculationVersion: 1, v1Allocation: { frozen: false, issue: null } }));
    expect(html).toContain('이 주문은 첫 부분 취소를 확정할 때 상품별 금액 배분을 확정합니다.');
    expect(html).not.toContain('버전 1');
    expect(html).toContain('취소 내용 확인');
    expect(view(context({ calculationVersion: 1, v1Allocation: { frozen: true, issue: null } }))).toContain('확정된 상품별 금액 배분으로 계산합니다.');
    expect(view(context())).not.toContain('금액 배분');
  });

  it('배분을 확정할 수 없는 버전 1 주문은 양식 없이 이유와 자세한 사유를 보인다', () => {
    const mismatch = view(context({ calculationVersion: 1, v1Allocation: { frozen: false, issue: 'amount_mismatch' },
      blockers: ['partial_cancel_v1_allocation_mismatch'] }));
    expect(mismatch).toContain('결제 금액이 상품·쿠폰·적립금·배송비 기록과 맞지 않아');
    expect(mismatch).toContain('상품 결제 몫과 배송비의 합이 결제 금액과 다릅니다.');
    expect(mismatch).toContain('운영자 전액 취소로 처리합니다');
    expect(mismatch).not.toContain('취소 내용 확인');
    const unavailable = view(context({ calculationVersion: 1, v1Allocation: { frozen: false, issue: 'coupon_unrecorded' },
      blockers: ['partial_cancel_v1_allocation_unavailable'] }));
    expect(unavailable).toContain('주문 당시 기록만으로는 상품별 금액 배분을 확정할 수 없어');
    expect(unavailable).toContain('주문 당시 쿠폰 대상·금액 기록이 없습니다.');
    expect(unavailable.indexOf('쿠폰 대상·금액 기록이 없습니다.')).toBeLessThan(unavailable.indexOf('운영자 전액 취소로 처리해주세요'));
    expect(unavailable.match(/운영자 전액 취소/g)).toHaveLength(1);
    expect(unavailable).not.toContain('굿즈');
  });

  it('환불 0원(전액 할인 상품만) 기록은 결제사를 부르지 않았다고 보인다', () => {
    expect(view(context({ history: [record({ refundAmount: 0, goodsRefundAmount: 0 })] }))).toContain('결제사를 부르지 않고 적용');
  });
});
