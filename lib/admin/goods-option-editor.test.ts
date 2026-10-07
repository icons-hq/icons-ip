import { describe, expect, it } from 'vitest';
import {
  applyErpItemToGoodsOption, applyGoodsOptionBulkEdit, collapseGoodsOptionRows, goodsOptionCollapseNotice, generateGoodsOptionRows, goodsOptionRowKey, goodsOptionStockTotals,
  initialGoodsOptionRows, isSingleGoodsOption, parseGoodsOptionBulkEdit, parseGoodsOptionRows, removeGoodsOptionRows, restoreGoodsOptionRows,
} from './goods-option-editor';
describe('goods option editing', () => {
  it('generates two axes with additive prices while preserving an existing combination', () => {
    const existing = [{ id: '11111111-1111-4111-8111-111111111111', name: '빨강 / M', code: 'RED-M', attributes: { 색상: '빨강', 사이즈: 'M' }, extraPrice: 500, stockQty: 4, expectedStockQty: 4 }];
    expect(generateGoodsOptionRows([{ name: '색상', values: '빨강, 파랑' }, { name: '사이즈', values: 'M, L' }], existing)).toEqual({ ok: true, rows: [
      existing[0],
      { name: '빨강 / L', code: '', attributes: { 색상: '빨강', 사이즈: 'L' }, extraPrice: 0, stockQty: 0 },
      { name: '파랑 / M', code: '', attributes: { 색상: '파랑', 사이즈: 'M' }, extraPrice: 0, stockQty: 0 },
      { name: '파랑 / L', code: '', attributes: { 색상: '파랑', 사이즈: 'L' }, extraPrice: 0, stockQty: 0 },
    ] });
    expect(generateGoodsOptionRows([{ name: '색', values: Array.from({ length: 101 }, (_, i) => `색${i}`).join(',') }], [])).toMatchObject({ ok: false });
    expect(parseGoodsOptionRows('[{"name":"단일","code":"","attributes":{},"extraPrice":-1,"stockQty":0}]', 1000)).toMatchObject({ ok: false });
  });
  it('모든 옵션을 중지해도 기본 옵션의 코드·할당 재고·안전재고를 편집과 실패 복구에서 보존한다', () => {
    const rows = initialGoodsOptionRows([{
      id: '11111111-1111-4111-8111-111111111111', goodId: 'good-1', name: '기본 옵션', code: 'GOOD-1-01',
      attributes: {}, price: 10000, stockQty: 10, lowStockThreshold: 3,
      isDefault: true, archivedAt: '2026-09-10T06:00:00Z',
    }], 10000);
    expect(rows).toEqual([{
      id: '11111111-1111-4111-8111-111111111111', name: '기본 옵션', code: 'GOOD-1-01', attributes: {},
      extraPrice: 0, stockQty: 10, expectedStockQty: 10, lowStockThreshold: 3, isActive: false,
      erpCode: null, erpName: null, barcode: null, externalUpdatedAt: null,
    }]);
    expect(restoreGoodsOptionRows(JSON.stringify(rows))).toEqual(rows);
    expect(parseGoodsOptionRows(JSON.stringify(rows), 10000)).toEqual({ ok: true, rows });
  });
  it('안전재고 공란과 0을 구별하고 잘못된 기준·사용 상태는 저장하지 않는다', () => {
    const option = { name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 10 };
    for (const lowStockThreshold of [null, 0, 3]) {
      const rows = [{ ...option, lowStockThreshold, isActive: false }];
      expect(parseGoodsOptionRows(JSON.stringify(rows), 10000)).toEqual({ ok: true, rows });
    }
    for (const invalid of [
      { lowStockThreshold: -1 }, { lowStockThreshold: 1.5 }, { lowStockThreshold: '3' },
      { lowStockThreshold: 2147483648 }, { isActive: 'false' }, { isActive: null },
    ]) expect(parseGoodsOptionRows(JSON.stringify([{ ...option, ...invalid }]), 10000)).toMatchObject({ ok: false });
  });
  it('옵션 ERP 식별자는 선행 0과 optimistic timestamp를 입력 복구까지 보존한다', () => {
    const rows = [{
      name: '기본 옵션', code: 'OWN-01', attributes: {}, extraPrice: 0, stockQty: 2,
      erpCode: '0000123', erpName: 'ERP 품명', barcode: '0007',
      externalUpdatedAt: '2026-09-10T07:00:00.000Z',
    }];
    expect(parseGoodsOptionRows(JSON.stringify(rows), 1000)).toEqual({ ok: true, rows });
    expect(restoreGoodsOptionRows(JSON.stringify(rows))).toEqual(rows);
    expect(parseGoodsOptionRows(JSON.stringify([{ ...rows[0], erpCode: 'x'.repeat(121) }]), 1000)).toMatchObject({ ok: false });
    expect(parseGoodsOptionRows(JSON.stringify([{ ...rows[0], externalUpdatedAt: 'stale' }]), 1000)).toMatchObject({ ok: false });
  });
});

describe('옵션목록 선택·일괄수정·재고 합계', () => {
  const saved = { id: '11111111-1111-4111-8111-111111111111', name: '빨강', code: 'R', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 4, expectedStockQty: 4, isActive: true };
  const fresh = { name: '파랑', code: '', attributes: { 색상: '파랑' }, extraPrice: 500, stockQty: 6 };
  const stopped = { ...saved, id: '22222222-2222-4222-8222-222222222222', name: '노랑', attributes: { 색상: '노랑' }, stockQty: 3, isActive: false };
  const rows = [saved, fresh, stopped];

  it('저장된 옵션은 id, 새 조합은 옵션값으로 행을 구분한다', () => {
    expect(goodsOptionRowKey(saved)).toBe(saved.id);
    expect(goodsOptionRowKey(fresh)).toBe(goodsOptionRowKey({ attributes: { 색상: '파랑' } }));
    expect(goodsOptionRowKey(fresh)).not.toBe(goodsOptionRowKey(saved));
  });

  it('옵션 재고수량 합계와 사용 중 합계를 함께 계산한다', () => {
    expect(goodsOptionStockTotals(rows)).toEqual({ total: 13, active: 10 });
    expect(isSingleGoodsOption([{ ...saved, attributes: {} }])).toBe(true);
    expect(isSingleGoodsOption([saved])).toBe(false);
  });

  it('선택한 행만 빈 칸이 아닌 값으로 일괄수정한다', () => {
    const parsed = parseGoodsOptionBulkEdit({ extraPrice: '1,000', stockQty: '', isActive: 'stopped' });
    expect(parsed).toEqual({ ok: true, edit: { extraPrice: 1000, isActive: false } });
    if (!parsed.ok) throw new Error();
    const next = applyGoodsOptionBulkEdit(rows, new Set([goodsOptionRowKey(fresh)]), parsed.edit);
    expect(next[1]).toMatchObject({ extraPrice: 1000, stockQty: 6, isActive: false });
    expect(next[0]).toBe(rows[0]);
    expect(parseGoodsOptionBulkEdit({ extraPrice: '', stockQty: '', isActive: '' })).toMatchObject({ ok: false });
    expect(parseGoodsOptionBulkEdit({ extraPrice: '-1', stockQty: '', isActive: '' })).toMatchObject({ ok: false });
    expect(parseGoodsOptionBulkEdit({ extraPrice: '', stockQty: '1.5', isActive: '' })).toMatchObject({ ok: false });
  });

  it('선택삭제는 한 개 이상 남기고, 옵션 사용 해제는 첫 행의 식별자를 유지한다', () => {
    expect(removeGoodsOptionRows(rows, new Set([goodsOptionRowKey(fresh)]))).toEqual({ ok: true, rows: [saved, stopped] });
    expect(removeGoodsOptionRows(rows, new Set(rows.map(goodsOptionRowKey)))).toMatchObject({ ok: false });
    expect(removeGoodsOptionRows(rows, new Set())).toMatchObject({ ok: false });
    expect(collapseGoodsOptionRows(rows)).toEqual([{ ...saved, attributes: {} }]);
  });

  /* 2026-10-07 리뷰: 옵션 미사용 화면에는 옵션목록의 사용여부 칸이 없어, 중지된 첫 옵션을 남기면 되돌릴 수 없었다. */
  it('옵션 사용 해제는 남는 첫 옵션을 사용으로 바꾸고, 확인 문구에 그 사실과 빠지는 옵션 수를 적는다', () => {
    expect(collapseGoodsOptionRows([stopped, saved])).toEqual([{ ...stopped, attributes: {}, isActive: true }]);
    const stoppedNotice = goodsOptionCollapseNotice([stopped, saved, fresh]);
    expect(stoppedNotice).toContain('첫 옵션(노랑)');
    expect(stoppedNotice).toContain('사용 중지 상태라 사용으로 바꿉니다');
    expect(stoppedNotice).toContain('나머지 옵션 2개');
    const activeNotice = goodsOptionCollapseNotice([saved, fresh]);
    expect(activeNotice).not.toContain('사용 중지');
    expect(activeNotice).toContain('나머지 옵션 1개');
  });

  it('ERP 품목 선택은 품명·품번을 덮어쓰고 비어 있는 바코드만 채운다', () => {
    const item = { code: '000123', name: 'ERP 품명', barcode: '0880' };
    expect(applyErpItemToGoodsOption({ ...saved, erpCode: 'OLD', erpName: '이전', barcode: '' }, item))
      .toMatchObject({ erpCode: '000123', erpName: 'ERP 품명', barcode: '0880' });
    expect(applyErpItemToGoodsOption({ ...saved, barcode: '0007' }, item)).toMatchObject({ barcode: '0007' });
    expect(applyErpItemToGoodsOption({ ...saved, barcode: null }, { ...item, barcode: null })).toMatchObject({ barcode: null });
  });
});
