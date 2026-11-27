import { describe, expect, it } from 'vitest';
import {
  defectiveStockWithRequestedQty,
  parseClaimDefectiveStock,
  parseDefectiveQtyByVariant,
  parseDefectiveStockList,
  readStockDispositions,
  stockDispositionField,
} from './defective-stock';

const ITEM_A = 'aaaa0001-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM_B = 'bbbb0002-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('반품 불량 재고 읽기·양식 계약', () => {
  it('환불 확정 양식의 품목별 선택을 읽는다 — 필드가 없으면 null(전부 복원, 기존 호출 그대로)', () => {
    expect(readStockDispositions(new FormData())).toBeNull();
    const form = new FormData();
    form.set(stockDispositionField(ITEM_A), 'defective');
    form.set(stockDispositionField(ITEM_B.toUpperCase()), 'restore');
    expect(readStockDispositions(form)).toEqual({ itemIds: [ITEM_A, ITEM_B], defectiveIds: [ITEM_A] });
  });

  it('알 수 없는 값·UUID가 아닌 품목·중복은 거절한다', () => {
    for (const mutate of [
      (form: FormData) => form.set(stockDispositionField(ITEM_A), 'discard'),
      (form: FormData) => form.set('stockDisposition:not-a-uuid', 'restore'),
      (form: FormData) => { form.append(stockDispositionField(ITEM_A), 'restore'); form.append(stockDispositionField(ITEM_A.toUpperCase()), 'defective'); },
    ]) {
      const form = new FormData();
      mutate(form);
      expect(readStockDispositions(form)).toEqual({ error: expect.stringContaining('품목별 재고 처리 선택을 확인하지 못했습니다') });
    }
  });

  it('클레임 품목 문서를 안전하게 읽는다', () => {
    expect(parseClaimDefectiveStock('x')).toEqual([]);
    expect(parseClaimDefectiveStock([{ claimId: 'c', frozen: true, pending: '1', items: [
      { orderItemId: ITEM_A, name: '키링', variantName: '', qty: 2, defective: true, state: 'planned' },
      { orderItemId: ITEM_B, name: '엽서', variantName: '파랑', qty: 1, defective: false, state: 'bogus' },
    ] }])).toEqual([{ claimId: 'c', frozen: true, pending: 1, items: [
      { orderItemId: ITEM_A, name: '키링', variantName: null, qty: 2, defective: true, state: 'planned' },
      { orderItemId: ITEM_B, name: '엽서', variantName: '파랑', qty: 1, defective: false, state: null },
    ] }]);
  });

  it('불량 재고 목록 문서와 옵션별 수량을 읽는다', () => {
    expect(parseDefectiveStockList(null)).toBeNull();
    const list = parseDefectiveStockList({
      variants: [{ goodId: 'g', goodName: '굿즈', variantId: 'v', variantName: '옵션', variantCode: 'C1', qty: 3, entries: 2, lastRecordedAt: '2026-11-12T00:00:00Z' }],
      entries: [{ id: 'e', claimId: 'c', claimReference: 7, orderItemId: 'o', goodName: '굿즈', variantId: 'v', variantName: '옵션', variantCode: 'C1', qty: 1, recordedAt: '2026-11-12T00:00:00Z', recordedByName: '담당' },
        { id: 'x', claimId: 'cx', claimType: 'exchange', claimReference: 9, orderItemId: 'o2', goodName: '굿즈', variantId: 'v', variantName: '옵션', variantCode: 'C1', qty: 1, recordedAt: '2026-11-12T01:00:00Z', recordedByName: '담당' }],
      pending: [{ claimId: 'c2', claimReference: 8, qty: 2, items: 1 }],
    });
    expect(list?.variants[0]).toMatchObject({ variantId: 'v', qty: 3, entries: 2 });
    /* 출처가 없는 옛 응답은 반품이고, 교환 회수 불량(CLM-046)은 교환으로 읽는다. */
    expect(list?.entries[0]).toMatchObject({ claimReference: 7, recordedByName: '담당', claimType: 'return' });
    expect(list?.entries[1]).toMatchObject({ claimId: 'cx', claimType: 'exchange' });
    expect(list?.pending).toEqual([{ claimId: 'c2', claimReference: 8, qty: 2, items: 1 }]);
    expect(parseDefectiveQtyByVariant([{ variantId: 'v', qty: 2 }, { variantId: 'w', qty: 0 }, { qty: 1 }])).toEqual({ v: 2 });
  });
});

/* R-N4: 부분 반품의 품목별 재고 처리 칸은 주문 수량이 아니라 반품을 요청한 수량을 보인다(표시용 — 선택·저장 상태는 그대로). */
describe('부분 반품의 품목별 재고 처리 수량', () => {
  const stock = { claimId: 'c1', frozen: false, pending: 1, items: [
    { orderItemId: ITEM_A, name: 'A', variantName: null, qty: 2, defective: true, state: 'planned' as const },
    { orderItemId: ITEM_B, name: 'B', variantName: '파랑', qty: 3, defective: false, state: null },
  ] };

  it('요청에 담긴 품목만 요청한 수량으로 바꾼다 — 요청에 없는 품목과 그 밖의 값은 그대로다', () => {
    const shown = defectiveStockWithRequestedQty(stock, [{ orderItemId: ITEM_A.toUpperCase(), qty: 1 }])!;
    expect(shown.items.map((item) => item.qty)).toEqual([1, 3]);
    expect(shown.items[0]).toMatchObject({ orderItemId: ITEM_A, name: 'A', defective: true, state: 'planned' });
    expect(shown.items[1]).toBe(stock.items[1]);
    expect(shown).toMatchObject({ claimId: 'c1', frozen: false, pending: 1 });
    expect(stock.items[0].qty).toBe(2);
  });

  it('부분 반품이 아니거나 요청 품목을 모르면 받은 그대로 돌려준다', () => {
    expect(defectiveStockWithRequestedQty(stock, null)).toBe(stock);
    expect(defectiveStockWithRequestedQty(stock, undefined)).toBe(stock);
    expect(defectiveStockWithRequestedQty(stock, [])).toBe(stock);
    expect(defectiveStockWithRequestedQty(null, [{ orderItemId: ITEM_A, qty: 1 }])).toBeNull();
    expect(defectiveStockWithRequestedQty(undefined, [{ orderItemId: ITEM_A, qty: 1 }])).toBeUndefined();
  });
});
