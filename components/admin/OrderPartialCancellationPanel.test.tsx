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

import { OrderPartialCancellationPanel, OrderPartialCancellationPanelView, PartialCancellationPlanSummary } from './OrderPartialCancellationPanel';
import type { OrderPartialCancellationContext, OrderPartialCancellationPlan, OrderPartialCancellationRecord } from '@/lib/orders/partial-cancellation';

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
    id: 'cccccccc-0000-4000-8000-000000000001', sequence: 1, reasonCode: 'out_of_stock', claimId: null, returnFeeDeduction: 0, state: 'completed', provider: 'toss', refundAmount: 9_500, goodsRefundAmount: 9_500,
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

  it('켜진 발송 전 주문은 품목·수량 선택과 고객이 정한 내용 칸을 그리고, 고를 수 없는 품목은 이유를 보인다', () => {
    const html = view(context());
    expect(html).toContain('재고 부족 부분 취소');
    expect(html).toContain('품절 상품 A · 블루');
    expect(html).toContain('예약 판매 상품');
    expect(html).toContain('취소 내용 확인');
    expect(html).not.toContain('환불받을 계좌');
    expect(html).not.toContain('굿즈');
    expect(html).not.toContain('고객 결정 기록');
  });

  it('고객이 정한 내용은 필수 칸이고 어디에 남는지 한 줄로 말한다(분쟁 기록) — 예시는 입력칸 안에 있다', () => {
    const html = view(context());
    expect(html).toContain('고객이 정한 내용 (필수)');
    expect(html).toContain('placeholder="예: 11/12 14:00 통화 — 품절 상품은 취소하고 나머지를 먼저 받기로 함"');
    expect(html).toContain('부분 취소 기록과 감사 기록에 남고 고객에게는 보이지 않습니다.');
  });

  it('[취소 내용 확인]이 잠겨 있으면 이유를 버튼 옆에 보인다 — 상품을 고르지 않았을 때', () => {
    const html = view(context());
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>취소 내용 확인</);
    expect(html).toContain('취소할 상품을 먼저 골라주세요.');
    expect(html).toContain(`aria-describedby="partial-cancellation-missing-${ORDER_ID}"`);
  });

  it('머리 설명은 한 문장이고 환불 계산 방식 같은 내부 설명을 달지 않는다(금액은 확인창이 보인다)', () => {
    const html = view(context());
    expect(html).toContain('창고 재고가 모자란 상품만 고객이 정한 대로 취소하고, 나머지는 평소대로 출고합니다.');
    expect(html).not.toContain('상품별로 나눈 금액');
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
    expect(html).toContain('송금 완료 기록');
    expect(html).toContain('합성은행 ****1234');
    expect(html).toContain('송금 대기');
    expect(html).toContain('결제확인필요');
    // 결제 담당 해소: 운영자는 사유만 적고, 서버가 결제사 잔액을 조회해 정한다. 칸은 접혀 있고 머리가 언제 쓰는지 말한다.
    expect(html).toMatch(/<details[^>]*data-partial-cancellation-resolve=""[^>]*><summary[^>]*>결제사 확인이 계속 안 될 때/);
    expect(html).not.toContain('결제확인필요 해소');
    expect(html).toContain('결제사 잔액 조회해 해소');
    expect(html).toContain('해소 사유 (필수)');
    expect(html).toContain('5자 이상. 부분 취소 기록의 [해소] 줄에 남습니다.');
  });

  it('결제사 확인이 막힌 이유는 영문 코드 대신 다음 할 일로 말하고, 코드는 문의할 때 알려 줄 값으로 작게 둔다', () => {
    const html = view(context({ blockers: ['partial_cancel_in_progress'], history: [
      record({ state: 'needs_review', completedAt: null, appliedAt: null, staff: { ...record().staff!, lastErrorCode: 'provider_unavailable' } }),
    ] }));
    expect(html).toContain('결제사 처리 결과를 확인하지 못했습니다. 잠시 뒤 [결제사 확인 다시 하기]를 눌러주세요.');
    expect(html).toContain('문의할 때 알려 줄 코드: provider_unavailable');
    expect(html).not.toContain('확인 코드:');
  });

  it('송금 대기 양식의 두 칸은 필수라고 적고 각각 어디에 남는지 말한다', () => {
    const html = view(context({ history: [record({ state: 'awaiting_transfer', provider: 'bank_transfer', completedAt: null,
      staff: { ...record().staff!, refundAccount: { maskedAccount: '합성은행 ****1234', maskedHolder: '홍*동', purged: false } } })] }));
    expect(html).toContain('송금 근거 (필수)');
    expect(html).toContain('이 부분 취소 기록에 남습니다.');
    expect(html).toContain('확인 메모 (필수)');
    expect(html).toContain('감사 기록에 남고 이 화면에는 다시 보이지 않습니다.');
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

  it('버전 1 주문도 같은 양식을 쓰고, 계산 방식(금액 배분 확정)은 화면에 말하지 않는다', () => {
    for (const frozen of [false, true]) {
      const html = view(context({ calculationVersion: 1, v1Allocation: { frozen, issue: null } }));
      expect(html).toContain('취소 내용 확인');
      expect(html).not.toContain('버전 1');
      expect(html).not.toContain('금액 배분');
    }
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
    expect(view(context({ history: [record({ refundAmount: 0, goodsRefundAmount: 0 })] }))).toContain('결제사에 취소를 요청하지 않고 적용');
  });
});

describe('부분 반품 환불 줄(ADR-0047)', () => {
  it('같은 원장의 반품 줄은 반품 이름·반품배송비 차감·반품 요청으로 보인다', () => {
    const html = view(context({ history: [record({ reasonCode: 'return', claimId: 'dddddddd-0000-4000-8000-00000000000d',
      returnFeeDeduction: 3_000, refundAmount: 6_500, goodsRefundAmount: 9_500 })] }));
    expect(html).toContain('1차 부분 반품 환불');
    expect(html).toContain('반품배송비 ₩3,000 차감');
    expect(html).toContain('반품 요청:');
  });
});

describe('부분 반품 환불 줄의 결제사 확인(ADR-0047, 적대적 리뷰 2026-11-19)', () => {
  it('결제사 확인 전인 부분 반품 줄은 \'결제사 확인 다시 하기\'를 두지 않고 반품 상세의 [환불 완료 확정]을 가리킨다', () => {
    const html = view(context({ history: [record({ reasonCode: 'return', claimId: 'dddddddd-0000-4000-8000-00000000000d', state: 'processing',
      appliedAt: null, completedAt: null })] }));
    expect(html).not.toContain('결제사 확인 다시 하기');
    expect(html).toContain('반품 요청 상세에서 [환불 완료 확정]으로 확인합니다');
    const stockout = view(context({ history: [record({ state: 'processing', appliedAt: null, completedAt: null })] }));
    expect(stockout).toContain('결제사 확인 다시 하기');
  });

  it('결제사가 받지 않아 닫힌 부분 반품 줄은 계좌 송금 전환을 가리킨다', () => {
    const html = view(context({ history: [record({ reasonCode: 'return', claimId: 'dddddddd-0000-4000-8000-00000000000d', state: 'rejected',
      appliedAt: null, completedAt: null })] }));
    expect(html).toContain('[계좌 송금 부분 환불로 전환]으로 처리합니다');
  });
});


/* 확인창은 되돌릴 수 없는 처리 앞이라 어느 주문의 어느 상품이 몇 개 취소되고 얼마가 환불되며 무엇이 남는지를 모두 말한다. */
describe('부분 취소 확인창 본문', () => {
  const PLAN: OrderPartialCancellationPlan = {
    provider: 'toss', paymentAmount: 40_000, balanceBefore: 40_000, goodsRefundAmount: 9_500, shippingRefundAmount: 3_000, refundAmount: 12_500, balanceAfter: 27_500,
    storeCreditRestoreAmount: 500, warehouseStopRequired: true, remainingQty: 3,
    lines: [{ orderItemId: ITEM_A, shipmentId: 'bbbbbbbb-0000-4000-8000-000000000001', shipmentNumber: '2026111230000001', originName: '남양주', exported: true,
      goodName: '품절 상품 A', variantName: '블루', qty: 1, orderedQty: 2, remainingQtyAfter: 1, goodsRefundAmount: 9_500, couponDiscount: 0, storeCreditDiscount: 500 }],
    closedShipments: [{ shipmentId: 'bbbbbbbb-0000-4000-8000-000000000002', shipmentNumber: '2026111230000002', originName: '김포', shippingFeeRefund: 3_000, shippingCollectFee: 0, exported: false }],
  };
  const summary = (props: Partial<Parameters<typeof PartialCancellationPlanSummary>[0]> = {}) =>
    renderToStaticMarkup(createElement(PartialCancellationPlanSummary, { plan: PLAN, needsAccount: false, bankReady: false, ...props }));

  it('주문번호·취소할 상품과 수량·함께 환불하는 배송비·환불액·남는 것을 모두 보인다', () => {
    const html = summary({ orderNumber: '202611121400100000001' });
    expect(html).toContain('주문 202611121400100000001');
    expect(html).toContain('품절 상품 A · 블루 1개 취소 (남는 수량 1개)');
    expect(html).toContain('₩9,500');
    expect(html).toContain('배송비 함께 환불 · 김포 2026111230000002 (남는 상품 없음)');
    expect(html).toContain('₩3,000');
    expect(html).toMatch(/환불액<\/span><span[^>]*>₩12,500</);
    expect(html).toContain('결제 ₩40,000 · 환불 전 남은 금액 ₩40,000 → 환불 뒤 ₩27,500');
    expect(html).toContain('사용한 적립금 ₩500은 적립금으로 돌려줌');
    expect(html).toContain('주문에 남는 상품은 3개입니다. 발송 전인 상품은 그대로 출고합니다.');
    expect(html).toContain('남은 주문이 쿠폰 사용 조건을 채우는지는 따로 확인하지 않습니다.');
  });

  it('주문번호를 받지 못해도 나머지는 같고 주문번호 줄만 빠진다(내부 번호로 대신하지 않는다)', () => {
    const html = summary();
    expect(html).not.toContain('주문 2026');
    expect(html).not.toContain(ORDER_ID);
    expect(html).toContain('환불액');
  });

  it('출고지시가 나간 배송 건이면 창고 회신 기록이 있어야 하고 그 회신은 한 번만 쓰인다고 말한다', () => {
    expect(summary()).toContain('창고 회신 기록(출고 중단 확인)이 있어야 확정할 수 있습니다. 그 회신은 이 부분 취소에 한 번 쓰이고, 다른 취소에는 다시 쓸 수 없습니다.');
    expect(summary({ plan: { ...PLAN, warehouseStopRequired: false } })).not.toContain('창고 회신 기록');
  });

  it('남은 결제 금액이 0원이 되면 그것도 말한다', () => {
    expect(summary({ plan: { ...PLAN, balanceBefore: 12_500, balanceAfter: 0 } })).toContain('이 취소로 남은 결제 금액이 0원이 됩니다.');
    expect(summary()).not.toContain('0원이 됩니다');
  });

  it('무통장 주문은 계좌를 다 적기 전까지 이유를 보이고, 다 적으면 이유를 지운다', () => {
    const missing = summary({ plan: { ...PLAN, provider: 'bank_transfer' }, needsAccount: true, bankReady: false });
    expect(missing).toContain('환불받을 계좌(은행·계좌번호·예금주)를 모두 적어야 확정할 수 있습니다.');
    expect(missing).toContain('[취소 내용 확인]을 다시 눌러주세요.');
    expect(summary({ plan: { ...PLAN, provider: 'bank_transfer' }, needsAccount: true, bankReady: true })).not.toContain('환불받을 계좌');
  });

  it('주문번호를 함께 받아도 확인창이 닫혀 있는 첫 화면은 그대로다', () => {
    const html = renderToStaticMarkup(createElement(OrderPartialCancellationPanelView, { orderId: ORDER_ID, orderNumber: '202611121400100000001', context: context(), onReload: () => undefined }));
    expect(html).toContain('취소 내용 확인');
    expect(html).not.toContain('주문 202611121400100000001');
  });
});
