import { describe, expect, it } from 'vitest';
import {
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
    expect(parseClaimDefectiveStock([{ claimId: 'c', pending: '1', items: [
      { orderItemId: ITEM_A, name: '키링', variantName: '', qty: 2, defective: true, state: 'planned' },
      { orderItemId: ITEM_B, name: '엽서', variantName: '파랑', qty: 1, defective: false, state: 'bogus' },
    ] }])).toEqual([{ claimId: 'c', pending: 1, items: [
      { orderItemId: ITEM_A, name: '키링', variantName: null, qty: 2, defective: true, state: 'planned' },
      { orderItemId: ITEM_B, name: '엽서', variantName: '파랑', qty: 1, defective: false, state: null },
    ] }]);
  });

  it('불량 재고 목록 문서와 옵션별 수량을 읽는다', () => {
    expect(parseDefectiveStockList(null)).toBeNull();
    const list = parseDefectiveStockList({
      variants: [{ goodId: 'g', goodName: '굿즈', variantId: 'v', variantName: '옵션', variantCode: 'C1', qty: 3, entries: 2, lastRecordedAt: '2026-11-12T00:00:00Z' }],
      entries: [{ id: 'e', claimId: 'c', claimReference: 7, orderItemId: 'o', goodName: '굿즈', variantId: 'v', variantName: '옵션', variantCode: 'C1', qty: 1, recordedAt: '2026-11-12T00:00:00Z', recordedByName: '담당' }],
      pending: [{ claimId: 'c2', claimReference: 8, qty: 2, items: 1 }],
    });
    expect(list?.variants[0]).toMatchObject({ variantId: 'v', qty: 3, entries: 2 });
    expect(list?.entries[0]).toMatchObject({ claimReference: 7, recordedByName: '담당' });
    expect(list?.pending).toEqual([{ claimId: 'c2', claimReference: 8, qty: 2, items: 1 }]);
    expect(parseDefectiveQtyByVariant([{ variantId: 'v', qty: 2 }, { variantId: 'w', qty: 0 }, { qty: 1 }])).toEqual({ v: 2 });
  });
});
