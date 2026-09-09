import { describe, expect, it } from 'vitest';
import { generateGoodsOptionRows, parseGoodsOptionRows } from './goods-option-editor';
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
});
