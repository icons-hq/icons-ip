import { describe, expect, it } from 'vitest';
import {
  applyErpItemToGoodsOption, applyGoodsOptionBulkEdit, collapseGoodsOptionRows, goodsOptionCollapseNotice, generateGoodsOptionRows, goodsOptionRowKey, goodsOptionStockTotals,
  initialGoodsOptionRows, isSingleGoodsOption, parseGoodsOptionBulkEdit, parseGoodsOptionRows, removeGoodsOptionRows, restoreGoodsOptionRows,
  predictGoodsOptionCodes, selectErpItemForGoodsOption, type GoodsOptionRow,
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

  /* 2026-10-07 3차 리뷰: 같은 ERP 품목을 두 옵션에 고르면 저장이 전역 unique 위반으로만 실패했다. */
  describe('같은 상품의 다른 옵션이 쓰는 ERP 품목 선택', () => {
    const item = { code: '000123', name: '아크릴 키링', barcode: '0880000000123' };
    const red = { ...saved, erpCode: null, erpName: null, barcode: null };
    const blue = { ...fresh, erpCode: '000123', erpName: '아크릴 키링', barcode: null };

    it('다른 옵션에 이미 있는 ERP 코드면 채우지 않고 그 옵션과 맞바꾸기 방법을 알린다', () => {
      const result = selectErpItemForGoodsOption([red, blue], goodsOptionRowKey(red), { ...item, code: ' 000123 ' });
      expect(result).toEqual({ ok: false, error: '옵션 2(파랑)에 이미 같은 ERP 코드(000123)가 있어 채우지 않았습니다. 한 ERP 품목은 옵션 하나에만 연결할 수 있습니다. 두 옵션의 ERP 품목을 맞바꾸려면 한쪽을 비우고 저장한 뒤 다시 지정해주세요.' });
    });

    it('ERP 코드는 대소문자·앞뒤 공백 없이 비교하고, 바코드는 비어 있어 채울 때만 비교한다', () => {
      expect(selectErpItemForGoodsOption([red, { ...blue, erpCode: 'ab-1' }], goodsOptionRowKey(red), { ...item, code: 'AB-1' }))
        .toMatchObject({ ok: false, error: expect.stringContaining('같은 ERP 코드(AB-1)') });
      const barcodeTaken = [red, { ...blue, erpCode: '000999', barcode: '0880000000123' }];
      expect(selectErpItemForGoodsOption(barcodeTaken, goodsOptionRowKey(red), item))
        .toMatchObject({ ok: false, error: expect.stringContaining('옵션 2(파랑)에 이미 같은 바코드(0880000000123)가 있어') });
      /* 자기 바코드가 있으면 ERP 품목 바코드를 쓰지 않으므로 겹치지 않는다. */
      expect(selectErpItemForGoodsOption([{ ...red, barcode: '0007' }, barcodeTaken[1]], goodsOptionRowKey(red), item))
        .toEqual({ ok: true, row: { ...red, barcode: '0007', erpCode: '000123', erpName: '아크릴 키링' } });
    });

    it('겹치지 않으면 고른 행만 채우고, 같은 행을 다시 골라도 자기 값과는 겹치지 않는다', () => {
      expect(selectErpItemForGoodsOption([red, { ...blue, erpCode: '000124' }], goodsOptionRowKey(red), item))
        .toEqual({ ok: true, row: applyErpItemToGoodsOption(red, item) });
      expect(selectErpItemForGoodsOption([red, blue], goodsOptionRowKey(blue), item))
        .toEqual({ ok: true, row: applyErpItemToGoodsOption(blue, item) });
      expect(selectErpItemForGoodsOption([red], 'missing', item)).toMatchObject({ ok: false });
    });
  });
});

/* 2026-10-07 QA: 옵션목록 적용 직후 관리코드 칸은 RIL-0001-01/-02로 보였지만, 저장하면 교체된 기본 옵션이 -01을 이미 써서 -02/-03이 붙었다. */
describe('관리코드 칸의 저장 시 코드 예상', () => {
  const DEFAULT = '33333333-3333-4333-8333-333333333333';
  const RED = '44444444-4444-4444-8444-444444444444';
  const ARCHIVED = '55555555-5555-4555-8555-555555555555';
  const fresh = (code = ''): GoodsOptionRow => ({ name: '새 옵션', code, attributes: {}, extraPrice: 0, stockQty: 0 });
  const kept = (id: string, code = ''): GoodsOptionRow => ({ id, name: '저장된 옵션', code, attributes: {}, extraPrice: 0, stockQty: 0, expectedStockQty: 0 });

  it('기본 옵션을 옵션목록으로 바꾸면 기본 옵션 코드(-01)를 건너뛴 다음 빈 번호를 보인다', () => {
    const generated = generateGoodsOptionRows([{ name: '색상', values: '빨강, 파랑' }], [kept(DEFAULT, 'RIL-0001-01')]);
    if (!generated.ok) throw new Error();
    expect(predictGoodsOptionCodes(generated.rows, 'RIL-0001', { goodCode: 'RIL-0001', options: [{ id: DEFAULT, code: 'RIL-0001-01' }] }))
      .toEqual(['RIL-0001-02', 'RIL-0001-03']);
  });

  it('보관된 옵션·위 옵션의 관리코드를 피하고, 저장된 옵션은 비워도 기존 코드를 유지한다', () => {
    const saved = { goodCode: 'GOOD', options: [{ id: RED, code: 'GOOD-01' }, { id: ARCHIVED, code: 'GOOD-03' }] };
    expect(predictGoodsOptionCodes([kept(RED), fresh(' good-02 '), fresh(), fresh()], 'GOOD', saved))
      .toEqual(['GOOD-01', 'GOOD-02', 'GOOD-04', 'GOOD-05']);
  });

  it('저장된 옵션의 관리코드를 바꾸면 이전 코드는 아래 옵션이 받을 수 있다', () => {
    expect(predictGoodsOptionCodes([kept(RED, 'red-x'), fresh()], 'GOOD', { goodCode: 'GOOD', options: [{ id: RED, code: 'GOOD-01' }] }))
      .toEqual(['RED-X', 'GOOD-01']);
  });

  it('새 상품은 첫 저장에서 옵션을 다시 만들므로 -01부터 차례로 붙이고, 100번째부터는 세 자리다', () => {
    expect(predictGoodsOptionCodes([fresh(), fresh()], ' ril-0002 ', { goodCode: null, options: [] })).toEqual(['RIL-0002-01', 'RIL-0002-02']);
    expect(predictGoodsOptionCodes(Array.from({ length: 100 }, () => fresh()), 'X', { goodCode: null, options: [] }).at(-1)).toBe('X-100');
  });

  it('저장된 옵션 정보가 없거나, 상품코드를 이번에 바꾸거나, 모르는 옵션이 있으면 예상하지 않는다', () => {
    const saved = { goodCode: 'GOOD', options: [{ id: RED, code: 'GOOD-01' }] };
    expect(predictGoodsOptionCodes([fresh(), fresh()], 'GOOD', undefined)).toEqual([null, null]);
    expect(predictGoodsOptionCodes([fresh()], 'NEW', saved)).toEqual([null]);
    expect(predictGoodsOptionCodes([fresh()], '', { goodCode: null, options: [] })).toEqual([null]);
    expect(predictGoodsOptionCodes([kept(DEFAULT), fresh()], 'GOOD', saved)).toEqual([null, null]);
    expect(predictGoodsOptionCodes([kept(RED), fresh()], 'GOOD', { goodCode: null, options: [] })).toEqual([null, null]);
  });
});
