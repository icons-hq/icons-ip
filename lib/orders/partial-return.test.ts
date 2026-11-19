import { describe, expect, it } from 'vitest';
import {
  DISABLED_PARTIAL_RETURN,
  parseAdminClaimPartialReturn,
  parseMyOrderClaimItems,
  parseOrderPartialReturnContext,
  partialReturnCoversAll,
  partialReturnItemBlockerLabel,
  partialReturnSelectionFromQuantities,
  partialReturnItemsLabel,
  partialReturnOrderBlockerLabel,
} from './partial-return';
import { ORDER_CLAIM_INTAKE_NOTICES, orderClaimIntakeNotice } from './claims';
import { orderPartialCancellationSummary, parseOrderPartialCancellationRecord } from './partial-cancellation';

const ITEM_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ITEM_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const ITEM_C = 'cccccccc-0000-4000-8000-00000000000c';
const CLAIM = 'dddddddd-0000-4000-8000-00000000000d';

const contextRow = {
  enabled: true, blocker: null,
  items: [
    { orderItemId: ITEM_A, goodName: 'A', variantName: null, orderedQty: 2, activeQty: 2, returnedQty: 0, unitPrice: 10000, shipmentId: null, shipmentNumber: null, originName: null, blocker: null, returnRestricted: false, restrictionReason: null },
    { orderItemId: ITEM_B, goodName: 'B', variantName: null, orderedQty: 1, activeQty: 1, returnedQty: 0, unitPrice: 10000, shipmentId: null, shipmentNumber: null, originName: null, blocker: null, returnRestricted: false, restrictionReason: null },
    { orderItemId: ITEM_C, goodName: 'C', variantName: null, orderedQty: 1, activeQty: 1, returnedQty: 0, unitPrice: 5000, shipmentId: null, shipmentNumber: null, originName: null, blocker: 'digital_item', returnRestricted: false, restrictionReason: null },
  ],
};

describe('부분 반품 문맥·선택(ADR-0047)', () => {
  it('꺼져 있거나 모양이 틀리면 꺼진 것으로 읽는다', () => {
    expect(parseOrderPartialReturnContext({ enabled: false })).toBe(DISABLED_PARTIAL_RETURN);
    expect(parseOrderPartialReturnContext(null)).toBe(DISABLED_PARTIAL_RETURN);
    expect(parseOrderPartialReturnContext({ enabled: true, items: [{ orderItemId: 'x' }] })).toBe(DISABLED_PARTIAL_RETURN);
  });

  it('고른 수량을 요청 본문으로 좁힌다 — 0개는 빼고, 남은 수량 초과·막힌 품목·아무것도 안 고름은 null', () => {
    const context = parseOrderPartialReturnContext(contextRow);
    expect(partialReturnSelectionFromQuantities(context, { [ITEM_A]: 1, [ITEM_B]: 0 })).toEqual([{ orderItemId: ITEM_A, qty: 1 }]);
    expect(partialReturnSelectionFromQuantities(context, { [ITEM_A]: 3 })).toBeNull();
    expect(partialReturnSelectionFromQuantities(context, { [ITEM_C]: 1 })).toBeNull();
    expect(partialReturnSelectionFromQuantities(context, { [ITEM_A]: 0 })).toBeNull();
    expect(partialReturnCoversAll(context, [{ orderItemId: ITEM_A, qty: 2 }, { orderItemId: ITEM_B, qty: 1 }])).toBe(false);
    expect(partialReturnCoversAll({ ...context, items: context.items.slice(0, 2) }, [{ orderItemId: ITEM_A, qty: 2 }, { orderItemId: ITEM_B, qty: 1 }])).toBe(true);
    expect(partialReturnItemBlockerLabel('digital_item')).toBe('디지털·배송 없는 굿즈는 반품 대상이 아닙니다.');
  });

  it('부분 반품 원장 줄은 반품배송비 차감을 뺀 환불액을 검증하고 반품 문장으로 요약한다', () => {
    const row = {
      id: 'eeeeeeee-0000-4000-8000-00000000000e', sequence: 2, reasonCode: 'return', claimId: CLAIM, returnFeeDeduction: 3000, state: 'completed', provider: 'toss',
      refundAmount: 19500, goodsRefundAmount: 19500, shippingRefundAmount: 3000, storeCreditRestoreAmount: 0, createdAt: '2026-11-19T00:00:00Z',
      appliedAt: '2026-11-19T00:00:01Z', completedAt: '2026-11-19T00:00:01Z', transferredAt: null, closedShipmentCount: 0,
      items: [{ orderItemId: ITEM_A, goodName: 'A', variantName: null, qty: 1, goodsRefundAmount: 9500 }, { orderItemId: ITEM_B, goodName: 'B', variantName: null, qty: 1, goodsRefundAmount: 10000 }],
    };
    const record = parseOrderPartialCancellationRecord(row);
    expect(record).toMatchObject({ reasonCode: 'return', claimId: CLAIM, returnFeeDeduction: 3000 });
    expect(orderPartialCancellationSummary(record)).toBe('A 1개, B 1개 반품 · 환불 19,500원 (배송비 3,000원 포함) (반품배송비 3,000원 차감)');
    expect(() => parseOrderPartialCancellationRecord({ ...row, returnFeeDeduction: 0 })).toThrow();
    expect(() => parseOrderPartialCancellationRecord({ ...row, claimId: null })).toThrow();
    /* 옛 응답(키 없음)은 재고 부족 부분 취소다. */
    const legacy: Record<string, unknown> = { ...row, refundAmount: 22500 };
    delete legacy.reasonCode; delete legacy.claimId; delete legacy.returnFeeDeduction;
    expect(parseOrderPartialCancellationRecord(legacy)).toMatchObject({ reasonCode: 'out_of_stock', claimId: null, returnFeeDeduction: 0 });
  });

  it('운영 클레임 상세 칸: 주문 전체 클레임은 null, 미리보기 실패 이유를 그대로 싣는다', () => {
    expect(parseAdminClaimPartialReturn(null)).toBeNull();
    const parsed = parseAdminClaimPartialReturn({
      items: [{ orderItemId: ITEM_A, goodName: 'A', variantName: null, variantCode: 'A-1', qty: 1, orderedQty: 2, shipmentNumber: null, originName: '김포' }],
      refundId: null, history: [],
      preview: { provider: 'toss', balanceBefore: 40000, goodsRefundAmount: 9500, shippingRefundAmount: 0, grossRefundAmount: 9500, returnFeeDeduction: 0,
        returnFee: { applicable: false, reason: 'disabled' }, refundAmount: 9500, storeCreditRestoreAmount: 0, emptiedShipments: [] },
    });
    expect(parsed?.preview).toMatchObject({ refundAmount: 9500, returnFeeReason: 'disabled', emptiedShipmentCount: 0 });
    expect(parseAdminClaimPartialReturn({ items: [], refundId: null, history: [], preview: { error: 'partial_return_unsupported_payment' } })?.previewError)
      .toBe('partial_return_unsupported_payment');
  });

  it('구매자 클레임 품목 라벨', () => {
    const items = parseMyOrderClaimItems([{ claimId: CLAIM, orderItemId: ITEM_A, goodName: 'A', variantName: '블루', qty: 1 }]);
    expect(partialReturnItemsLabel(items)).toBe('A (블루) 1개');
    expect(parseMyOrderClaimItems([{ claimId: 'bad' }])).toEqual([]);
  });
});

describe('적대적 리뷰 반영(2026-11-19)', () => {
  it('운영 상세 칸은 정산 경로와 계좌 송금 전환 가능 여부를 읽는다(모르는 값은 null·false)', () => {
    const parsed = parseAdminClaimPartialReturn({ items: [], refundId: null, history: [], preview: null, settlement: 'bank_transfer', transferConvertible: true });
    expect(parsed?.settlement).toBe('bank_transfer');
    expect(parsed?.transferConvertible).toBe(true);
    const unknown = parseAdminClaimPartialReturn({ items: [], refundId: null, history: [], preview: null, settlement: 'cash', transferConvertible: 'yes' });
    expect(unknown?.settlement).toBeNull();
    expect(unknown?.transferConvertible).toBe(false);
  });

  it('계좌 송금으로 환불한 결제의 다음 일부 반품은 1:1 문의로 안내한다', () => {
    expect(partialReturnOrderBlockerLabel('payment_refunded_by_transfer')).toContain('1:1 문의');
  });

  it('부분 반품이 켜지면 반품 안내의 \'전체 회수\'·\'결제금액 전액\'은 주문 전체 반품에만 걸리고, 꺼지면 지금 문구 그대로다', () => {
    const off = orderClaimIntakeNotice('return');
    expect(off).toBe(ORDER_CLAIM_INTAKE_NOTICES.return);
    const on = orderClaimIntakeNotice('return', null, { partialReturn: true });
    expect(on).toContain('반품하신 굿즈의 회수를 확인하며');
    expect(on).not.toContain('전체 회수를 확인');
    expect(on).toContain('주문 전체 반품의 환불은 최초 선결제 배송비를 포함한 결제금액 전액으로 처리합니다.');
    expect(on).not.toContain('승인된 환불은 최초 선결제 배송비를 포함한 결제금액 전액');
  });

  it('차감이 켜지면 부분 취소를 받지 않는 결제의 일부 반품은 전액 환불이 아니라 계좌 송금이라고 말한다', () => {
    const on = orderClaimIntakeNotice('return', { enabled: true, oneWayAmount: 3000 }, { partialReturn: true });
    expect(on).toContain('주문 전체 반품은 전액 환불하고 반품배송비는 따로 안내하며, 일부 반품은 담당자가 연락드려 계좌로 송금해 환불합니다.');
    const off = orderClaimIntakeNotice('return', { enabled: true, oneWayAmount: 3000 });
    expect(off).toContain('결제 수단이 부분 취소를 지원하지 않으면 전액 환불하고 반품배송비는 따로 안내합니다.');
    expect(off).not.toContain('일부 반품');
  });

  it('부분 환불(취소·반품) 뒤의 남은 금액 안내는 반품도 함께 말한다', () => {
    expect(orderClaimIntakeNotice('return', null, { partiallyCanceled: true, partialReturn: true }))
      .toContain('주문 전체 반품의 환불은 이미 일부 취소·반품으로 환불한 금액을 뺀 남은 결제 금액으로 처리합니다.');
  });
});

