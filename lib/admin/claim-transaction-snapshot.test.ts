import { describe, expect, it } from 'vitest';
import {
  AdminClaimDetailLoadError,
  adminClaimDetailLoadFailureMessage,
  claimItemsMatchTransaction,
  parseClaimPartialCancels,
  parseClaimSnapshotItems,
  type ClaimSnapshotItem,
} from './claim-transaction-snapshot';

/* QA2 B1: 부분 취소된 버전 2 주문의 반품·교환 상세가 영수증 대조에서 막혔다. 원 수량 − 적용된 부분 취소 수량으로 정확히 맞추고,
   실제로 어긋나면 계속 막는다. 주문: A 2개(김포)·B 1개(김포)·C 1개(남양주), 결제 40,000원. */
const A = '72000000-0000-4000-8000-0000000000a1';
const B = '72000000-0000-4000-8000-0000000000b1';
const C = '72000000-0000-4000-8000-0000000000c1';
const VA = '72000000-0000-4000-8000-0000000000a2';
const VB = '72000000-0000-4000-8000-0000000000b2';
const VC = '72000000-0000-4000-8000-0000000000c2';

function line(lineId: string, variantId: string, qty: number, unitPrice: number) {
  return { lineId, goodId: `good-${lineId.slice(-2)}`, variantId, qty, regularUnitPrice: unitPrice, unitPrice, volumeUnitDiscount: 0,
    subtotal: qty * unitPrice, volumeDiscountTotal: 0, netSubtotal: qty * unitPrice, couponDiscount: 0, storeCreditDiscount: 0,
    paidGoodsTotal: qty * unitPrice, volumePolicyId: null };
}

const receipt = {
  lines: [line(A, VA, 2, 10000), line(B, VB, 1, 10000), line(C, VC, 1, 5000)],
  totals: { subtotal: 35000, volumeDiscountTotal: 0, netGoodsTotal: 35000, couponDiscountTotal: 1000, storeCreditTotal: 0,
    prepaidShippingTotal: 6000, collectShippingTotal: 0, onlineTotal: 40000, customerTotal: 40000 },
};

const item = (id: string, variantId: string, qty: number, unitPrice: number): ClaimSnapshotItem => ({ id, variantId, qty, unitPrice });
const full = [item(A, VA, 2, 10000), item(B, VB, 1, 10000), item(C, VC, 1, 5000)];

describe('claimItemsMatchTransaction', () => {
  it('부분 취소가 없으면 원 수량 그대로 맞는다', () => {
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items: full, partialCancels: [] })).toBe(true);
  });

  it('A 1개를 부분 취소하면 상세의 A 1개를 영수증 A 2 − 1로 맞춘다', () => {
    const items = [item(A, VA, 1, 10000), item(B, VB, 1, 10000), item(C, VC, 1, 5000)];
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items, partialCancels: [{ orderItemId: A, canceledQty: 1 }] })).toBe(true);
    // 부분 취소 수량을 싣지 않으면(대조를 원 수량으로) 지금처럼 막힌다.
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items, partialCancels: [] })).toBe(false);
  });

  it('모두 취소된 품목은 상세에서 빠지고 부분 취소 수량으로만 맞춘다', () => {
    const items = [item(B, VB, 1, 10000), item(C, VC, 1, 5000)];
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items, partialCancels: [{ orderItemId: A, canceledQty: 2 }] })).toBe(true);
    const twoGone = [item(A, VA, 1, 10000), item(B, VB, 1, 10000)];
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items: twoGone,
      partialCancels: [{ orderItemId: A, canceledQty: 1 }, { orderItemId: C, canceledQty: 1 }] })).toBe(true);
  });

  it('실제로 어긋나면 계속 막는다', () => {
    const one = [{ orderItemId: A, canceledQty: 1 }];
    const live = [item(A, VA, 1, 10000), item(B, VB, 1, 10000), item(C, VC, 1, 5000)];
    // 남은 수량이 다르다.
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items: [item(A, VA, 2, 10000), live[1], live[2]], partialCancels: one })).toBe(false);
    // 원 수량보다 많이 취소됐다.
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items: live.slice(1), partialCancels: [{ orderItemId: A, canceledQty: 3 }] })).toBe(false);
    // 모두 취소된 품목이 상세에 남아 있다.
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items: [item(A, VA, 1, 10000), ...live.slice(1)], partialCancels: [{ orderItemId: A, canceledQty: 2 }] })).toBe(false);
    // 영수증에 없는 품목의 부분 취소.
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items: full, partialCancels: [{ orderItemId: '72000000-0000-4000-8000-0000000000d1', canceledQty: 1 }] })).toBe(false);
    // 옵션·단가·총액·남는 품목.
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items: [item(A, VB, 1, 10000), live[1], live[2]], partialCancels: one })).toBe(false);
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items: [item(A, VA, 1, 9000), live[1], live[2]], partialCancels: one })).toBe(false);
    expect(claimItemsMatchTransaction(receipt, { total: 39000, items: live, partialCancels: one })).toBe(false);
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items: [...live, item('72000000-0000-4000-8000-0000000000d1', VA, 1, 10000)], partialCancels: one })).toBe(false);
    // 같은 품목이 두 줄.
    expect(claimItemsMatchTransaction(receipt, { total: 40000, items: [live[0], live[0], live[1], live[2]], partialCancels: one })).toBe(false);
  });
});

describe('RPC 모양 좁히기', () => {
  it('부분 취소 수량: 없으면 빈 배열, 모양이 어긋나면 null', () => {
    expect(parseClaimPartialCancels(undefined)).toEqual([]);
    expect(parseClaimPartialCancels([])).toEqual([]);
    expect(parseClaimPartialCancels([{ orderItemId: A.toUpperCase(), canceledQty: 1 }])).toEqual([{ orderItemId: A, canceledQty: 1 }]);
    for (const bad of [null, {}, [{ orderItemId: A, canceledQty: 0 }], [{ orderItemId: A, canceledQty: 1.5 }], [{ orderItemId: 'a', canceledQty: 1 }],
      [{ orderItemId: A, canceledQty: 1, extra: true }], [{ orderItemId: A, canceledQty: 1 }, { orderItemId: A, canceledQty: 1 }]]) {
      expect(parseClaimPartialCancels(bad)).toBeNull();
    }
  });

  it('품목: 한 줄이라도 모양이 어긋나면 null', () => {
    expect(parseClaimSnapshotItems([{ id: A, variantId: VA, qty: 1, unitPrice: 10000, name: 'A' }])).toEqual([item(A, VA, 1, 10000)]);
    expect(parseClaimSnapshotItems(undefined)).toBeNull();
    expect(parseClaimSnapshotItems([{ id: A, variantId: VA, qty: 0, unitPrice: 10000 }])).toBeNull();
    expect(parseClaimSnapshotItems(['A'])).toBeNull();
  });
});

describe('로더 실패 이유 문구', () => {
  it('원인 코드마다 다른 문구이고, 모르는 실패는 기존 문구다', () => {
    expect(adminClaimDetailLoadFailureMessage(new AdminClaimDetailLoadError('transaction_snapshot_mismatch', 'x'), '기본')).toContain('결제 기록(거래 영수증)과 맞지 않아');
    expect(adminClaimDetailLoadFailureMessage(new AdminClaimDetailLoadError('transaction_receipt_unavailable', 'x'), '기본')).toContain('읽지 못해');
    expect(adminClaimDetailLoadFailureMessage(new AdminClaimDetailLoadError('claim_access_denied', 'x'), '기본')).toContain('권한이 없습니다');
    expect(adminClaimDetailLoadFailureMessage(new Error('boom'), '기본')).toBe('기본');
  });
});
