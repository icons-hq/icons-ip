import { describe, expect, it } from 'vitest';
import { generateGoodsOptionRows, initialGoodsOptionRows, parseGoodsOptionRows, restoreGoodsOptionRows } from './goods-option-editor';
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
