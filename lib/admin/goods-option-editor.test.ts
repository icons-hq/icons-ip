import { describe, expect, it } from 'vitest';
import {
  applyErpItemToGoodsOption, applyGoodsOptionBulkEdit, collapseGoodsOptionRows, goodsOptionCollapseNotice, generateGoodsOptionRows, goodsOptionRowKey, goodsOptionStockTotals,
  initialGoodsOptionRows, isSingleGoodsOption, parseGoodsOptionBulkEdit, parseGoodsOptionRows, removeGoodsOptionRows, restoreGoodsOptionRows,
  inheritRandomOptionLimits, predictGoodsOptionCodes, selectErpItemForGoodsOption, type GoodsOptionRow,
  emptyNewGoodsOptionStock, goodsOptionRowsForImport, goodsOptionStockMissing, shouldAutoFillErpSalePrice, GOODS_OPTION_STOCK_REQUIRED,
  goodsOptionGenerationLabel, goodsOptionGenerationNotice, goodsOptionGenerationSummary, goodsOptionPreviousSingleStock, goodsOptionRemovalNotice,
  previewGoodsOptionGeneration, GOODS_OPTION_REMOVAL_NOTE, GOODS_OPTION_STOP_PANEL_TITLE,
} from './goods-option-editor';
import { planGoodsOptionImport } from './goods-option-import';
describe('goods option editing', () => {
  it('세 축을 조합하면서 같은 조합의 옵션 식별자·가격·재고를 보존한다', () => {
    const existing = { id: '11111111-1111-4111-8111-111111111111', name: '빨강 / M / 기본', code: 'THREE-01', attributes: { 색상: '빨강', 사이즈: 'M', 구성: '기본' }, extraPrice: 500, stockQty: 7, expectedStockQty: 9 };
    const result = generateGoodsOptionRows([{ name: '색상', values: '빨강,파랑' }, { name: '사이즈', values: 'M' }, { name: '구성', values: '기본,선물' }], [existing]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.rows).toHaveLength(4); expect(result.rows[0]).toBe(existing);
    expect(result.rows[3].attributes).toEqual({ 색상: '파랑', 사이즈: 'M', 구성: '선물' });
    /* 0901-015: 새 조합의 재고 칸은 비어 있어 그대로는 저장하지 않는다. 재고를 넣으면(0 포함) 저장 계약은 그대로다. */
    expect(parseGoodsOptionRows(JSON.stringify(result.rows), 1000)).toEqual({ ok: false, error: '옵션 2(빨강 / M / 선물): 재고수량을 입력해주세요. 재고가 없으면 0을 입력합니다.' });
    const filled = result.rows.map((row) => Number.isFinite(row.stockQty) ? row : { ...row, stockQty: 0 });
    expect(parseGoodsOptionRows(JSON.stringify(filled), 1000)).toEqual({ ok: true, rows: filled });
    expect(generateGoodsOptionRows(Array.from({ length: 4 }, (_, i) => ({ name: `축${i}`, values: 'A' })), [])).toMatchObject({ ok: false });
    expect(parseGoodsOptionRows(JSON.stringify([{ ...existing, attributes: { ...existing.attributes, 네번째: '금지' } }]), 1000)).toMatchObject({ ok: false });
  });
  it('generates two axes with additive prices while preserving an existing combination', () => {
    const existing = [{ id: '11111111-1111-4111-8111-111111111111', name: '빨강 / M', code: 'RED-M', attributes: { 색상: '빨강', 사이즈: 'M' }, extraPrice: 500, stockQty: 4, expectedStockQty: 4 }];
    expect(generateGoodsOptionRows([{ name: '색상', values: '빨강, 파랑' }, { name: '사이즈', values: 'M, L' }], existing)).toEqual({ ok: true, rows: [
      existing[0],
      { name: '빨강 / L', code: '', attributes: { 색상: '빨강', 사이즈: 'L' }, extraPrice: 0, stockQty: Number.NaN },
      { name: '파랑 / M', code: '', attributes: { 색상: '파랑', 사이즈: 'M' }, extraPrice: 0, stockQty: Number.NaN },
      { name: '파랑 / L', code: '', attributes: { 색상: '파랑', 사이즈: 'L' }, extraPrice: 0, stockQty: Number.NaN },
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

/* 0901-015(11/11 결정 "비우면 저장 불가"): 새 재고 칸은 빈 값으로 시작하고, 비우면 저장을 막고, 0은 직접 입력하면 저장된다. */
describe('재고수량 빈 칸', () => {
  it('새 상품의 기본 옵션은 빈 재고 칸으로 시작하고 저장된 옵션은 저장된 재고를 쓴다', () => {
    const [fresh] = initialGoodsOptionRows([], 0);
    expect(Number.isNaN(fresh.stockQty)).toBe(true);
    expect(goodsOptionStockMissing([fresh])).toBe(1);
    expect(goodsOptionStockTotals([fresh])).toEqual({ total: 0, active: 0 });
    expect(initialGoodsOptionRows([{ id: '11111111-1111-4111-8111-111111111111', goodId: 'g', name: '기본 옵션', code: 'G-01', price: 1000, stockQty: 0, isDefault: true, archivedAt: null }], 1000)[0].stockQty).toBe(0);
  });

  it('빈 재고는 제출 JSON에서 null이고 서버 정규화가 막으며, 0은 저장한다', () => {
    const [fresh] = initialGoodsOptionRows([], 0);
    expect(JSON.parse(JSON.stringify([fresh]))[0].stockQty).toBeNull();
    expect(parseGoodsOptionRows(JSON.stringify([fresh]), 1000)).toEqual({ ok: false, error: GOODS_OPTION_STOCK_REQUIRED });
    expect(parseGoodsOptionRows(JSON.stringify([{ ...fresh, stockQty: 0 }]), 1000)).toMatchObject({ ok: true });
    /* 키가 아예 없는 행도 입력하지 않은 재고로 본다. */
    const withoutStock: Partial<GoodsOptionRow> = { ...fresh, stockQty: 0 };
    delete withoutStock.stockQty;
    expect(parseGoodsOptionRows(JSON.stringify([withoutStock]), 1000)).toEqual({ ok: false, error: GOODS_OPTION_STOCK_REQUIRED });
    const rows = [{ ...fresh, name: '빨강', attributes: { 색상: '빨강' }, stockQty: 3 }, { ...fresh, name: '파랑', attributes: { 색상: '파랑' } }];
    expect(parseGoodsOptionRows(JSON.stringify(rows), 1000)).toEqual({ ok: false, error: `옵션 2(파랑): ${GOODS_OPTION_STOCK_REQUIRED}` });
  });

  it('실패·자동복구·임시저장으로 되살릴 때 빈 재고 칸을 0으로 바꾸지 않는다', () => {
    const [fresh] = initialGoodsOptionRows([], 0);
    const restored = restoreGoodsOptionRows(JSON.stringify([fresh, { ...fresh, name: '파랑', attributes: { 색상: '파랑' }, stockQty: 0 }]))!;
    expect(Number.isNaN(restored[0].stockQty)).toBe(true);
    expect(restored[1].stockQty).toBe(0);
  });

  it('다른 상품 옵션 불러오기는 빈 칸을 0으로 비교하고, 적용 결과의 새 옵션·빈 옵션 재고 칸은 다시 비운다', () => {
    const [fresh] = initialGoodsOptionRows([], 0);
    const source = { id: 'source', code: 'SRC', name: '원본', basePrice: 10000, version: 'a'.repeat(64), rows: [{ name: '빨강', attributes: { 색상: '빨강' }, price: 10000 }] };
    expect(planGoodsOptionImport({ current: [fresh], source, basePrice: 10000, includePrices: false }).ok).toBe(false);
    const planned = planGoodsOptionImport({ current: goodsOptionRowsForImport([fresh]), source, basePrice: 10000, includePrices: false });
    if (!planned.ok) throw new Error(planned.error);
    const applied = emptyNewGoodsOptionStock(planned.plan.rows, [fresh]);
    expect(applied).toHaveLength(1);
    expect(Number.isNaN(applied[0].stockQty)).toBe(true);
    /* 직접 0을 넣은 기존 옵션은 그대로 0이다. */
    const kept = { ...fresh, name: '빨강', attributes: { 색상: '빨강' }, stockQty: 0 };
    const again = planGoodsOptionImport({ current: goodsOptionRowsForImport([kept]), source, basePrice: 10000, includePrices: false });
    if (!again.ok) throw new Error(again.error);
    expect(emptyNewGoodsOptionStock(again.plan.rows, [kept])[0].stockQty).toBe(0);
  });
});

/* 1007-045(11/11 결정 "빈 칸 자동"): 판매가 칸이 비어 있을 때만 ERP 판매가를 바로 넣는다. 0원 입력은 값이다. */
describe('ERP 판매가 빈 칸 자동 입력', () => {
  it('빈 판매가 칸만 채우고, 0원 입력·0원 ERP 판매가·옵션가가 있는 옵션은 건드리지 않는다', () => {
    expect(shouldAutoFillErpSalePrice({ salePrice: 12000, regularPrice: '', single: true, extraPrice: 0 })).toBe(true);
    expect(shouldAutoFillErpSalePrice({ salePrice: 12000, regularPrice: '  ', single: false, extraPrice: 0 })).toBe(true);
    expect(shouldAutoFillErpSalePrice({ salePrice: 12000, regularPrice: '0', single: true, extraPrice: 0 })).toBe(false);
    expect(shouldAutoFillErpSalePrice({ salePrice: 12000, regularPrice: '9900', single: true, extraPrice: 0 })).toBe(false);
    expect(shouldAutoFillErpSalePrice({ salePrice: 0, regularPrice: '', single: true, extraPrice: 0 })).toBe(false);
    expect(shouldAutoFillErpSalePrice({ salePrice: null, regularPrice: '', single: true, extraPrice: 0 })).toBe(false);
    expect(shouldAutoFillErpSalePrice({ salePrice: 12000, regularPrice: '', single: false, extraPrice: 500 })).toBe(false);
    expect(shouldAutoFillErpSalePrice({ salePrice: 12000, regularPrice: '', single: true, extraPrice: 500 })).toBe(true);
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

  it('선택삭제는 한 개 이상 남기고, 옵션 없음으로 바꾸면 첫 행의 식별자를 유지한다', () => {
    expect(removeGoodsOptionRows(rows, new Set([goodsOptionRowKey(fresh)]))).toEqual({ ok: true, rows: [saved, stopped] });
    /* 모두 빼려는 운영자에게는 옵션 없이 파는 방법을 화면에 적힌 이름('옵션 없음')으로 알린다. */
    expect(removeGoodsOptionRows(rows, new Set(rows.map(goodsOptionRowKey)))).toEqual({ ok: false, error: "옵션은 1개 이상 남아야 합니다. 옵션 없이 팔려면 위에서 '옵션 없음'을 골라주세요." });
    expect(removeGoodsOptionRows(rows, new Set())).toMatchObject({ ok: false });
    expect(collapseGoodsOptionRows(rows)).toEqual([{ ...saved, attributes: {} }]);
  });

  /* 2026-10-07 리뷰: 옵션 미사용 화면에는 옵션목록의 사용여부 칸이 없어, 중지된 첫 옵션을 남기면 되돌릴 수 없었다. */
  it('옵션 없음으로 바꾸면 남는 첫 옵션을 사용으로 바꾸고, 확인 문구에 그 사실과 빠지는 옵션의 수·이름을 적는다', () => {
    expect(collapseGoodsOptionRows([stopped, saved])).toEqual([{ ...stopped, attributes: {}, isActive: true }]);
    const stoppedNotice = goodsOptionCollapseNotice([stopped, saved, fresh]);
    expect(stoppedNotice).toContain("'옵션 없음'으로 바꾸면 첫 옵션(노랑)만 옵션값 없이 남습니다.");
    expect(stoppedNotice).toContain('첫 옵션은 사용 중지 상태라 사용으로 바꿉니다. 판매를 멈추려면 추가 설정의 판매상태를 판매 중지로 바꿔주세요.');
    expect(stoppedNotice).toContain('나머지 옵션 2개(빨강, 파랑)는 목록에서 빠지고 재고 입력도 사라집니다.');
    /* 저장된 옵션이 빠지면 상품을 저장할 때 일어나는 일(사용 중지로 남거나 지워짐)까지 말한다. */
    expect(stoppedNotice).toContain(GOODS_OPTION_REMOVAL_NOTE);
    const activeNotice = goodsOptionCollapseNotice([saved, fresh]);
    expect(activeNotice).not.toContain('사용 중지 상태라');
    expect(activeNotice).toContain('나머지 옵션 1개(파랑)');
    /* 아직 저장한 적 없는 줄만 빠지면 저장 때 달라지는 것이 없어 그 설명은 붙이지 않는다. */
    expect(activeNotice).not.toContain(GOODS_OPTION_REMOVAL_NOTE);
    /* 같은 상태·같은 대상은 한 이름이다(규칙 4): 설정안함·보관·기본 옵션으로 부르지 않는다. */
    for (const mixed of ['설정안함', '보관', '기본 옵션']) expect(stoppedNotice, mixed).not.toContain(mixed);
  });

  /* 규칙 7: 저장된 옵션을 뺄 때만 무엇이 일어나는지 말하고 확인받는다. 새 줄은 묻지 않는다. */
  it('삭제 확인 문구는 저장된 옵션을 뺄 때만 있고, 빠지는 옵션의 이름과 저장 때 일어나는 일을 말한다', () => {
    expect(goodsOptionRemovalNotice([fresh])).toBeNull();
    expect(goodsOptionRemovalNotice([])).toBeNull();
    expect(goodsOptionRemovalNotice([saved])).toBe(`옵션(빨강)을 목록에서 뺍니다. ${GOODS_OPTION_REMOVAL_NOTE}`);
    expect(goodsOptionRemovalNotice([saved, fresh, stopped])).toBe(`옵션 3개(빨강, 파랑, 노랑)를 목록에서 뺍니다. ${GOODS_OPTION_REMOVAL_NOTE}`);
    expect(GOODS_OPTION_REMOVAL_NOTE).toBe('주문·장바구니에 쓰인 옵션은 지워지지 않고 사용 중지로 남고, 한 번도 주문되지 않은 옵션은 재고와 함께 지워집니다. 상품을 저장해야 반영됩니다.');
    expect(GOODS_OPTION_STOP_PANEL_TITLE).toBe('옵션 사용 중지·다시 사용');
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

/*
 * 2026-11-25 상품등록 UX: 재고 1000을 넣고 옵션을 만들면 옵션 없이 넣은 재고 한 줄이 경고 없이 빠졌고, [옵션목록으로 적용]은
 * 옵션명을 한 글자만 고쳐도 모든 줄을 새로 만들면서 확인하지 않았다. 적는 동안 결과를 보이고, 빠지는 것이 있을 때만 확인한다.
 */
describe('옵션 만들기 미리보기와 확인', () => {
  const RED = '11111111-1111-4111-8111-111111111111';
  const single = (changes: Partial<GoodsOptionRow> = {}): GoodsOptionRow => ({ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: Number.NaN, ...changes });
  const option = (color: string, changes: Partial<GoodsOptionRow> = {}): GoodsOptionRow => ({ name: color, code: '', attributes: { 색상: color }, extraPrice: 0, stockQty: 3, ...changes });
  const axes = (...pairs: [string, string][]) => Array.from({ length: 3 }, (_, index) => ({ name: pairs[index]?.[0] ?? '', values: pairs[index]?.[1] ?? '' }));
  const ready = (preview: ReturnType<typeof previewGoodsOptionGeneration>) => { if (preview.state !== 'ready') throw new Error(`not ready: ${preview.state}`); return preview; };

  it('옵션값을 적는 동안 몇 개가 만들어지는지 보이고 버튼 이름이 그 결과다', () => {
    const preview = ready(previewGoodsOptionGeneration(axes(['색상', '빨강, 파랑, 빨강'], ['사이즈', 'S, M, L']), [single()]));
    expect(preview).toMatchObject({ count: 6, formula: '색상 2 × 사이즈 3', kept: 0, added: 6, fromSingle: true });
    expect(preview.rows.map((row) => row.name)).toEqual(['빨강 / S', '빨강 / M', '빨강 / L', '파랑 / S', '파랑 / M', '파랑 / L']);
    expect(goodsOptionGenerationSummary(preview)).toBe('옵션 6개가 만들어집니다(색상 2 × 사이즈 3).');
    expect(goodsOptionGenerationLabel(preview)).toBe('옵션 6개 만들기');
  });

  it('아직 적지 않았거나 덜 적었으면 만들 수 없고 무엇을 더 적을지 알린다', () => {
    const empty = previewGoodsOptionGeneration(axes(), [single()]);
    expect(empty).toEqual({ state: 'empty' });
    expect(goodsOptionGenerationSummary(empty)).toBeNull();
    expect(goodsOptionGenerationLabel(empty)).toBe('옵션 만들기');
    const reason = (...pairs: [string, string][]) => goodsOptionGenerationSummary(previewGoodsOptionGeneration(axes(...pairs), [single()]));
    expect(reason(['색상', ''])).toBe('옵션값 1을 적어 주세요.');
    expect(reason(['', '빨강'])).toBe('옵션명 1을 적어 주세요.');
    expect(reason(['색상', '빨강'], ['사이즈', ''])).toBe('옵션값 2를 적어 주세요.');
    expect(reason(['색상', '빨강'], ['', ''], ['', '기본'])).toBe('옵션명 3을 적어 주세요.');
    expect(reason(['색상', '빨강'], ['색상', 'S'])).toBe('옵션명이 겹칩니다. 서로 다른 이름으로 적어 주세요.');
    expect(reason(['가'.repeat(41), '빨강'])).toBe('옵션명 1은 40자까지 적을 수 있습니다.');
    expect(reason(['색상', '나'.repeat(81)])).toBe('옵션값 1은 하나에 80자까지 적을 수 있습니다.');
    expect(goodsOptionGenerationLabel(previewGoodsOptionGeneration(axes(['색상', '']), [single()]))).toBe('옵션 만들기');
  });

  it('100개를 넘으면 지금 개수를 알리고 만들 수 없다', () => {
    const values = Array.from({ length: 11 }, (_, index) => `값${index}`).join(',');
    const over = previewGoodsOptionGeneration(axes(['색상', values], ['사이즈', values]), [single()]);
    expect(over).toEqual({ state: 'over', count: 121, formula: '색상 11 × 사이즈 11' });
    expect(goodsOptionGenerationSummary(over)).toBe('옵션은 100개까지 만들 수 있습니다. 지금 121개입니다(색상 11 × 사이즈 11).');
    expect(goodsOptionGenerationLabel(over)).toBe('옵션 만들기');
    expect(goodsOptionGenerationNotice(over)).toBeNull();
    const limit = Array.from({ length: 100 }, (_, index) => `값${index}`).join(',');
    expect(previewGoodsOptionGeneration(axes(['색상', limit]), [single()])).toMatchObject({ state: 'ready', count: 100 });
  });

  it('지금 옵션목록과 같으면 바뀐 내용 없음이고, 순서만 다른 목록도 다시 만들지 않는다', () => {
    const rows = [option('빨강', { id: RED, expectedStockQty: 3 }), option('파랑')];
    const same = previewGoodsOptionGeneration(axes(['색상', '파랑, 빨강']), rows);
    expect(same).toEqual({ state: 'same', count: 2, formula: '색상 2' });
    expect(goodsOptionGenerationLabel(same)).toBe('바뀐 내용 없음');
    expect(goodsOptionGenerationSummary(same)).toBe('지금 옵션목록과 같습니다(색상 2).');
  });

  it('옵션 없음에서 재고를 넣어 둔 채 옵션을 만들면 그 재고가 나눠지지 않는다고 확인하고 이전 수량을 남긴다', () => {
    const preview = ready(previewGoodsOptionGeneration(axes(['색상', '빨강, 파랑']), [single({ stockQty: 1000 })]));
    expect(goodsOptionGenerationNotice(preview)).toBe('입력한 재고수량 1,000개는 옵션별 재고로 나눠지지 않습니다. 옵션마다 재고를 다시 넣어야 합니다.');
    expect(goodsOptionPreviousSingleStock(preview)).toBe(1000);
    /* 새 옵션의 재고 칸은 비어 있다 — 조용히 0으로 저장되지 않는다(0901-015). */
    expect(preview.rows.every((row) => Number.isNaN(row.stockQty))).toBe(true);
    const withCodes = ready(previewGoodsOptionGeneration(axes(['색상', '빨강']), [single({ stockQty: 5, erpCode: '000123', barcode: '0880', lowStockThreshold: 0 })]));
    expect(goodsOptionGenerationNotice(withCodes)).toBe('입력한 재고수량 5개는 옵션별 재고로 나눠지지 않습니다. 옵션마다 재고를 다시 넣어야 합니다. 적어 둔 ERP 코드·바코드·안전재고도 새 옵션으로 넘어가지 않습니다. 옵션마다 다시 넣어야 합니다.');
    const codesOnly = ready(previewGoodsOptionGeneration(axes(['색상', '빨강']), [single({ stockQty: 0, erpName: 'ERP 품명' })]));
    expect(goodsOptionGenerationNotice(codesOnly)).toBe('적어 둔 ERP 품명도 새 옵션으로 넘어가지 않습니다. 옵션마다 다시 넣어야 합니다.');
    expect(goodsOptionPreviousSingleStock(codesOnly)).toBeNull();
  });

  it('잃을 입력이 없으면 묻지 않는다(브레이크를 늘리지 않는다)', () => {
    for (const stockQty of [Number.NaN, 0]) {
      const preview = ready(previewGoodsOptionGeneration(axes(['색상', '빨강, 파랑']), [single({ stockQty })]));
      expect(goodsOptionGenerationNotice(preview)).toBeNull();
      expect(goodsOptionPreviousSingleStock(preview)).toBeNull();
    }
    /* 옵션값을 더하기만 하면 지금 옵션은 모두 남는다. */
    const rows = [option('빨강', { id: RED, expectedStockQty: 3 }), option('파랑')];
    const added = ready(previewGoodsOptionGeneration(axes(['색상', '빨강, 파랑, 초록']), rows));
    expect(added).toMatchObject({ kept: 2, added: 1, removed: [], fromSingle: false });
    expect(added.rows[0]).toBe(rows[0]);
    expect(goodsOptionGenerationNotice(added)).toBeNull();
    expect(goodsOptionGenerationSummary(added)).toBe('옵션이 3개가 됩니다(색상 3) · 그대로 2개 · 새로 1개');
    expect(goodsOptionGenerationLabel(added)).toBe('옵션 3개로 바꾸기');
    expect(goodsOptionPreviousSingleStock(added)).toBeNull();
  });

  it('지금 옵션이 목록에서 빠지면 몇 개가 빠지고 생기는지와 빠지는 옵션의 이름을 확인받는다', () => {
    const unsaved = [option('빨강'), option('파랑')];
    const dropped = ready(previewGoodsOptionGeneration(axes(['색상', '빨강, 초록']), unsaved));
    expect(dropped).toMatchObject({ kept: 1, added: 1, removed: [unsaved[1]] });
    expect(goodsOptionGenerationSummary(dropped)).toBe('옵션이 2개가 됩니다(색상 2) · 그대로 1개 · 새로 1개 · 빠짐 1개');
    expect(goodsOptionGenerationNotice(dropped)).toBe('지금 옵션 2개 중 1개가 목록에서 빠지고 새 옵션 1개가 생깁니다. 빠지는 옵션의 재고 입력도 사라집니다. 빠지는 옵션: 파랑.');
    /* 옵션값을 줄이기만 하면 새 옵션은 없다. */
    const fewer = ready(previewGoodsOptionGeneration(axes(['색상', '빨강']), unsaved));
    expect(goodsOptionGenerationNotice(fewer)).toBe('지금 옵션 2개 중 1개가 목록에서 빠집니다. 빠지는 옵션의 재고 입력도 사라집니다. 빠지는 옵션: 파랑.');
    /* 옵션명을 한 글자만 고쳐도 옵션값 조합이 달라져 모두 새 옵션이다. 저장된 옵션이 빠지면 저장 때 일어나는 일까지 말한다. */
    const saved = [option('빨강', { id: RED, expectedStockQty: 3 }), option('파랑'), option('초록'), option('노랑'), option('보라')];
    const renamed = ready(previewGoodsOptionGeneration(axes(['색', '빨강, 파랑']), saved));
    expect(renamed).toMatchObject({ kept: 0, added: 2 });
    expect(goodsOptionGenerationNotice(renamed)).toBe(`지금 옵션 5개 중 5개가 목록에서 빠지고 새 옵션 2개가 생깁니다. 빠지는 옵션의 재고 입력도 사라집니다. 빠지는 옵션: 빨강, 파랑, 초록 외 2개. ${GOODS_OPTION_REMOVAL_NOTE}`);
  });
});

/* 2026-10-07 QA: 옵션목록 적용 직후 옵션 자동코드 칸은 RIL-0001-01/-02로 보였지만, 저장하면 교체된 기본 옵션이 -01을 이미 써서 -02/-03이 붙었다. */
describe('옵션 자동코드 칸의 저장 시 코드 예상', () => {
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

  it('보관된 옵션·위 옵션의 옵션 자동코드를 피하고, 저장된 옵션은 비워도 기존 코드를 유지한다', () => {
    const saved = { goodCode: 'GOOD', options: [{ id: RED, code: 'GOOD-01' }, { id: ARCHIVED, code: 'GOOD-03' }] };
    expect(predictGoodsOptionCodes([kept(RED), fresh(' good-02 '), fresh(), fresh()], 'GOOD', saved))
      .toEqual(['GOOD-01', 'GOOD-02', 'GOOD-04', 'GOOD-05']);
  });

  it('저장된 옵션의 옵션 자동코드를 바꾸면 이전 코드는 아래 옵션이 받을 수 있다', () => {
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

/* D7② 옵션별 구매 제한 — 키를 보내지 않으면 DB가 기존 값을 유지한다(T6). 편집기는 읽은 값·입력한 값만 키로 보낸다. */
describe('옵션별 구매 제한 키', () => {
  const option = { name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 3 };
  const variant = {
    id: '11111111-1111-4111-8111-111111111111', goodId: 'good-1', name: '기본 옵션', code: 'GOOD-1-01',
    attributes: {}, price: 10000, stockQty: 3, isDefault: true, archivedAt: null,
  };

  it('양의 정수·null(제한 없음)은 저장하고, 0·소수·문자·상한 초과는 거절한다', () => {
    for (const limits of [{ orderMaxQty: 2, memberMaxQty: 5 }, { orderMaxQty: null, memberMaxQty: null }, { orderMaxQty: 2147483647 }, {}]) {
      const rows = [{ ...option, ...limits }];
      expect(parseGoodsOptionRows(JSON.stringify(rows), 10000)).toEqual({ ok: true, rows });
      expect(restoreGoodsOptionRows(JSON.stringify(rows))).toEqual(rows);
    }
    for (const invalid of [{ orderMaxQty: 0 }, { orderMaxQty: 1.5 }, { memberMaxQty: '3' }, { memberMaxQty: -1 }, { orderMaxQty: 2147483648 }]) {
      expect(parseGoodsOptionRows(JSON.stringify([{ ...option, ...invalid }]), 10000)).toMatchObject({ ok: false });
    }
  });

  it('저장된 옵션이 제한 값을 읽어 온 경우에만 키를 싣고, 읽지 않았으면 키를 빼 DB 값을 보존한다', () => {
    expect(initialGoodsOptionRows([variant], 10000)[0]).not.toHaveProperty('orderMaxQty');
    expect(initialGoodsOptionRows([variant], 10000)[0]).not.toHaveProperty('memberMaxQty');
    const loaded = initialGoodsOptionRows([{ ...variant, orderMaxQty: 2, memberMaxQty: null }], 10000)[0];
    expect(loaded).toMatchObject({ orderMaxQty: 2, memberMaxQty: null });
    expect(JSON.parse(JSON.stringify([loaded]))[0]).toHaveProperty('memberMaxQty', null);
  });

  it('옵션값을 다시 적용해도 같은 조합의 제한은 유지하고 새 조합에는 키가 없다', () => {
    const red = { ...option, name: '빨강', attributes: { 색상: '빨강' }, orderMaxQty: 1 };
    const result = generateGoodsOptionRows([{ name: '색상', values: '빨강, 파랑' }], [red]);
    if (!result.ok) throw new Error();
    expect(result.rows[0]).toBe(red);
    expect(result.rows[1]).not.toHaveProperty('orderMaxQty');
  });
});

describe('랜덤 판매 상품에 옵션을 더할 때의 같은 옵션 배정 상한', () => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
  const saved = (index: number, name: string, limits: Pick<GoodsOptionRow, 'orderMaxQty' | 'memberMaxQty'>, isActive = true): GoodsOptionRow => ({
    id: ids[index], name, code: `HSQ-0${index + 1}`, attributes: { 종류: name }, extraPrice: 0, stockQty: 5, expectedStockQty: 5, isActive, ...limits,
  });
  const limited = [saved(0, '기훈', { orderMaxQty: 2, memberMaxQty: 3 }), saved(1, '홍실', { orderMaxQty: 2, memberMaxQty: 3 })];
  /* 판매 중 옵션의 (주문당, 1인) 쌍이 하나뿐이어야 DB random_option_limit_mismatch를 통과한다. */
  const activePairs = (rows: GoodsOptionRow[]) => new Set(rows.filter((row) => row.isActive !== false).map((row) => `${row.orderMaxQty ?? null}|${row.memberMaxQty ?? null}`));

  /* 리뷰 #649 — 상한이 걸린 랜덤 상품에 옵션을 추가하면 새 행의 상한이 비어 커밋에서 random_option_limit_mismatch로 거절됐다. */
  it('옵션목록 적용으로 더한 옵션에 기존 공통 상한을 채운다', () => {
    const generated = generateGoodsOptionRows([{ name: '종류', values: '기훈, 홍실, 무영' }], limited);
    if (!generated.ok) throw new Error(generated.error);
    expect(generated.rows[2]).not.toHaveProperty('orderMaxQty');
    const rows = inheritRandomOptionLimits(limited, generated.rows);
    expect(rows[2]).toMatchObject({ name: '무영', orderMaxQty: 2, memberMaxQty: 3 });
    expect(rows[0]).toBe(limited[0]);
    expect(activePairs(rows).size).toBe(1);
  });

  it('다른 상품 옵션 불러오기로 더한 옵션과, 사용 중지에서 사용으로 바꾼 옵션에도 채운다', () => {
    const source = { id: 'source', code: 'SOURCE', name: '원본', basePrice: 12000, version: 'a'.repeat(64), rows: [
      { name: '기훈', attributes: { 종류: '기훈' }, price: 12000 }, { name: '홍실', attributes: { 종류: '홍실' }, price: 12000 }, { name: '무영', attributes: { 종류: '무영' }, price: 12000 },
    ] };
    const imported = planGoodsOptionImport({ current: limited, source, basePrice: 12000, includePrices: false });
    if (!imported.ok) throw new Error(imported.error);
    expect(activePairs(inheritRandomOptionLimits(limited, imported.plan.rows)).size).toBe(1);

    const withStopped = [...limited, saved(2, '무영', { orderMaxQty: 9, memberMaxQty: null }, false)];
    const reactivated = applyGoodsOptionBulkEdit(withStopped, new Set([ids[2]]), { isActive: true });
    expect(inheritRandomOptionLimits(withStopped, reactivated)[2]).toMatchObject({ isActive: true, orderMaxQty: 2, memberMaxQty: 3 });
  });

  it('상한이 없거나(제한 없음) 이미 같은 값이면 행을 바꾸지 않는다', () => {
    const open = [saved(0, '기훈', { orderMaxQty: null, memberMaxQty: null }), saved(1, '홍실', { orderMaxQty: null, memberMaxQty: null })];
    const generated = generateGoodsOptionRows([{ name: '종류', values: '기훈, 홍실, 무영' }], open);
    if (!generated.ok) throw new Error(generated.error);
    expect(inheritRandomOptionLimits(open, generated.rows)).toBe(generated.rows);
    const edited = limited.map((row) => ({ ...row, orderMaxQty: 1 }));
    expect(inheritRandomOptionLimits(limited, edited)).toBe(edited);
  });

  it('기존 판매 중 옵션끼리 값이 다르거나 값을 읽지 않았으면 추측해 채우지 않는다', () => {
    const add = (rows: GoodsOptionRow[]) => [...rows, { name: '무영', code: '', attributes: { 종류: '무영' }, extraPrice: 0, stockQty: 0 }];
    const mixed = [limited[0], { ...limited[1], orderMaxQty: 5 }];
    expect(inheritRandomOptionLimits(mixed, add(mixed))[2]).not.toHaveProperty('orderMaxQty');
    /* 상한을 읽지 않은 행은 키가 없다(initialGoodsOptionRows). */
    const unread = limited.map((row) => { const copy = { ...row }; delete copy.orderMaxQty; delete copy.memberMaxQty; return copy; });
    expect(inheritRandomOptionLimits(unread, add(unread))[2]).not.toHaveProperty('orderMaxQty');
  });
});
