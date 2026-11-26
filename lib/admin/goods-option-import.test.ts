import { describe, expect, it } from 'vitest';
import { diagnoseGoodsOptionImportSource, exactGoodsOptionIdentity, goodsOptionImportTargetVersion, parseGoodsOptionImportFilters, parseGoodsOptionImportSource, planGoodsOptionImport,
  type GoodsOptionImportSource, type GoodsOptionImportTarget } from './goods-option-import';
import type { GoodsOptionRow } from './goods-option-editor';

const id = '11111111-1111-4111-8111-111111111111', removedId = '22222222-2222-4222-8222-222222222222';
const source: GoodsOptionImportSource = { id: 'source', code: 'SOURCE', name: '원본 상품', basePrice: 10000, version: 'a'.repeat(64), rows: [
  { name: '원본 빨강', attributes: { 색상: '빨강' }, price: 12000 }, { name: '원본 파랑', attributes: { 색상: '파랑' }, price: 15000 },
] };
const existing: GoodsOptionRow = { id, name: '기존 빨강 이름', attributes: { 색상: '빨강' }, code: 'OWN-01', extraPrice: 700, stockQty: 8,
  expectedStockQty: 8, lowStockThreshold: 3, isActive: false, erpCode: 'ERP-01', erpName: '내 ERP', barcode: '0001', externalUpdatedAt: '2026-10-14T00:00:00Z' };
const removed: GoodsOptionRow = { ...existing, id: removedId, name: '이전 초록', attributes: { 색상: '초록' }, code: 'OWN-02', isActive: true, stockQty: 9, expectedStockQty: 9, erpCode: 'ERP-02' };
const blank: GoodsOptionRow = { name: '기본 옵션', attributes: {}, code: '', extraPrice: 0, stockQty: 0 };
function plan(current: GoodsOptionRow[], next = source, includePrices = false, basePrice = 5000) {
  return planGoodsOptionImport({ current, source: next, includePrices, basePrice });
}

describe('다른 상품 선택형 옵션을 현재 초안에 적용', () => {
  it('기존 ID·재고·기대수량·ERP·중지 상태를 보존하고 신규만 0개, 빠진 항목도 중지 상태로 남긴다', () => {
    const original = structuredClone([existing, removed]);
    const result = plan(original);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.plan.rows).toEqual([existing, { name: '원본 파랑', attributes: { 색상: '파랑' }, code: '', extraPrice: 0, stockQty: 0, isActive: true }, { ...removed, isActive: false }]);
    expect(result.plan).toMatchObject({ retained: 1, added: 1, stopped: 1, priceChanged: 0 });
    expect(original).toEqual([existing, removed]);
  });
  it('명시 선택한 경우만 원본 저장 기준가와 옵션금액의 차액을 적용하며 대상 기준가는 바꾸지 않는다', () => {
    const result = plan([existing], source, true, 3000);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.plan.rows.map(row => row.extraPrice)).toEqual([2000, 5000]);
    expect(result.plan.rows[0]).toMatchObject({ id, code: 'OWN-01', stockQty: 8, expectedStockQty: 8, isActive: false });
    expect(result.plan.priceChanged).toBe(1);
    /* 옵션가를 불러올 수 없는 두 원인을 가려 말한다: 고른 상품의 옵션이 그 상품 판매가보다 쌈 / 불러온 뒤 금액이 저장할 수 있는 범위를 넘음. */
    expect(plan([blank], { ...source, rows: [{ ...source.rows[0], price: 9000 }] }, true)).toEqual({ ok: false,
      error: '고른 상품의 옵션(원본 빨강)이 그 상품 판매가보다 싸서 옵션가를 불러올 수 없습니다. [옵션가도 불러오기]를 끄고 다시 비교해 주세요.' });
    expect(plan([blank], source, true, 2147483647)).toEqual({ ok: false,
      error: '옵션(원본 빨강)의 불러온 뒤 판매 금액이 저장할 수 있는 금액을 넘습니다. 지금 상품의 판매가와 고른 상품의 옵션 판매가를 확인해 주세요.' });
    expect(plan([blank], { ...source, rows: [{ ...source.rows[0], price: 9000 }] })).toMatchObject({ ok: true });
  });
  it('축의 객체 순서만 바뀌면 같은 조합이며 축 이름·공백·한글 조합형은 함부로 합치지 않는다', () => {
    const original = { ...existing, attributes: { 색상: '빨강', 크기: 'M' } };
    const next = { ...source, rows: [{ name: '반대 축 순서', attributes: { 크기: 'M', 색상: '빨강' }, price: 10000 }] };
    const result = plan([original], next); if (!result.ok) throw new Error(result.error);
    expect(result.plan.rows[0].id).toBe(id); expect(result.plan.added).toBe(0);
    const different: Record<string, string>[] = [{ '색상 ': '빨강', 크기: 'M' }, { 색상: '빨강 ', 크기: 'M' }, { 색상: '빨강'.normalize('NFD'), 크기: 'M' }, { 종류: '빨강', 크기: 'M' }];
    for (const attributes of different) {
      const changed = plan([original], { ...source, rows: [{ name: '다른 조합', attributes, price: 10000 }] });
      if (!changed.ok) throw new Error(changed.error);
      expect(changed.plan.rows[0].id).toBeUndefined(); expect(changed.plan.rows[1]).toMatchObject({ id, isActive: false });
    }
    expect(exactGoodsOptionIdentity({ 가: 'a' })).not.toBe(exactGoodsOptionIdentity({ ['가'.normalize('NFD')]: 'a' }));
  });
  it('첫 기본 옵션은 미저장·빈 기본행일 때만 제거하며 사용자가 입력한 재고나 저장된 ID를 보존한다', () => {
    const fresh = plan([blank]); if (!fresh.ok) throw new Error(fresh.error); expect(fresh.plan.rows).toHaveLength(2);
    for (const row of [{ ...blank, stockQty: 2 }, { ...blank, id, expectedStockQty: 0 }, { ...blank, erpCode: '0001' }, { ...blank, name: '직접 쓴 이름' }]) {
      const result = plan([row]); if (!result.ok) throw new Error(result.error);
      expect(result.plan.rows.at(-1)).toEqual({ ...row, isActive: false });
    }
  });
  it('보존할 중지 옵션까지 100개 한도를 계산하고 잘못된 현재 입력은 덮어쓰지 않는다', () => {
    const current = Array.from({ length: 99 }, (_, i) => ({ ...blank, name: `기존 ${i}`, attributes: { 번호: String(i) } }));
    expect(plan(current)).toEqual({ ok: false, error: '지금 상품의 옵션에 불러올 옵션을 더하면 101개가 됩니다. 옵션은 사용 중지한 것까지 합쳐 100개까지 둘 수 있습니다. 쓰지 않는 옵션을 옵션목록에서 뺀 뒤 다시 비교해 주세요.' });
    expect(plan([{ ...blank, stockQty: -1 }])).toMatchObject({ ok: false, error: expect.stringContaining('저장할 수 없는 값이 있습니다') });
    expect(plan([{ ...blank, attributes: { 색상: '빨강' } }, { ...blank, attributes: { 색상: '빨강' } }])).toMatchObject({ ok: false });
  });
  it('원본에 삽입된 ID·재고·ERP는 반영하지 않고 세 축과 실제 존재하는 조합만 가져온다', () => {
    const raw = { ...source, stockQty: 999, rows: [
      { name: 'A', attributes: { 색상: '빨강', 크기: 'M', 포장: '기본' }, price: 10000, id, stockQty: 999, erpCode: 'SOURCE-ERP' },
      { name: 'B', attributes: { 색상: '파랑', 크기: 'L', 포장: '선물' }, price: 11000, id: removedId },
    ] };
    const parsed = parseGoodsOptionImportSource(raw)!;
    expect(parsed).not.toHaveProperty('stockQty'); expect(parsed.rows[0]).not.toHaveProperty('id'); expect(parsed.rows[0]).not.toHaveProperty('erpCode');
    const result = plan([blank], parsed); if (!result.ok) throw new Error(result.error);
    expect(result.plan.rows).toHaveLength(2); expect(result.plan.axes).toHaveLength(3); expect(result.plan.rows.every(row => !row.id && row.stockQty === 0)).toBe(true);
    expect(parseGoodsOptionImportSource({ ...source, rows: [{ name: '기본', attributes: {}, price: 10000 }] })).toBeNull();
  });
  it('대상 저장본 비교는 옵션 순서·속성 키순서를 무시하되 가격·재고·노출·실제 문자열 변경을 잡는다', () => {
    const target: GoodsOptionImportTarget = { id: 'target', publishedAt: null, archivedAt: null, price: 5000, compareAtPrice: 6000, variants: [
      { id, name: '기존', code: 'OWN-01', attributes: { 색상: '빨강', 크기: 'M' }, price: 5700, stockQty: 8, isDefault: true, archivedAt: null },
    ] };
    expect(goodsOptionImportTargetVersion(target)).toBe(goodsOptionImportTargetVersion({ ...target, variants: [{ ...target.variants[0], attributes: { 크기: 'M', 색상: '빨강' } }] }));
    for (const next of [{ ...target, price: 7000 }, { ...target, publishedAt: '2026-10-14T00:00:00Z' }, { ...target, variants: [{ ...target.variants[0], stockQty: 7 }] }]) {
      expect(goodsOptionImportTargetVersion(target)).not.toBe(goodsOptionImportTargetVersion(next));
    }
    for (const change of [{ erpCode: 'NEW' }, { erpName: '변경' }, { barcode: '001' }, { externalUpdatedAt: '2026-10-14T01:00:00Z' }]) {
      expect(goodsOptionImportTargetVersion(target)).not.toBe(goodsOptionImportTargetVersion({ ...target, variants: [{ ...target.variants[0], ...change }] }));
    }
  });
  it('검색 필드와 페이지 범위를 제한한다', () => {
    expect(parseGoodsOptionImportFilters({ query: ' 원본 ', field: 'code', categoryId: '', page: 2 })).toEqual({ query: '원본', field: 'code', categoryId: '', page: 2 });
    expect(parseGoodsOptionImportFilters({ query: '', field: 'erp', categoryId: '', page: 1 })).toBeNull();
    expect(parseGoodsOptionImportFilters({ query: '', field: 'name', categoryId: '', page: 0 })).toBeNull();
  });
  /* 화면 규칙 2: 옵션 불러오기 선택창만 "선택형 옵션이 있는 상품만"·"지금 편집 중인 상품 제외" 조건을 더한다. 기존 호출의 결과 모양은 그대로다. */
  it('옵션 원본 조건은 선택 인자다: 주지 않으면 기존 호출과 같은 값이고, 주면 정해진 모양만 받는다', () => {
    const base = { query: '', field: 'name', categoryId: '', page: 1 };
    const plain = parseGoodsOptionImportFilters(base)!;
    expect(Object.keys(plain).sort()).toEqual(['categoryId', 'field', 'page', 'query']);
    for (const absent of [{ optionSourcesOnly: undefined }, { optionSourcesOnly: null }, { optionSourcesOnly: false }, { excludeGoodId: null }]) {
      expect(parseGoodsOptionImportFilters({ ...base, ...absent })).toEqual(plain);
    }
    expect(parseGoodsOptionImportFilters({ ...base, optionSourcesOnly: true })).toEqual({ ...plain, optionSourcesOnly: true });
    expect(parseGoodsOptionImportFilters({ ...base, optionSourcesOnly: true, excludeGoodId: 'good-1' })).toEqual({ ...plain, optionSourcesOnly: true, excludeGoodId: 'good-1' });
    /* 제외 상품은 옵션 원본 조회에서만 뜻이 있다. 조건 없이 오면 기존 검색을 바꾸지 않게 버린다. */
    expect(parseGoodsOptionImportFilters({ ...base, excludeGoodId: 'good-1' })).toEqual(plain);
    for (const invalid of [{ optionSourcesOnly: 'true' }, { optionSourcesOnly: 1 }, { optionSourcesOnly: true, excludeGoodId: 'Bad/Id' }, { excludeGoodId: 7 }]) {
      expect(parseGoodsOptionImportFilters({ ...base, ...invalid })).toBeNull();
    }
  });
  /* 화면 규칙 2: 고시 '다른 상품에서 복사' 선택창은 "고시를 적어 둔 상품만"·"지금 편집 중인 상품 제외" 조건을 더한다. */
  it('고시 원본 조건도 선택 인자다: 주면 정해진 모양만 받고, 옵션 원본 조건과 함께는 받지 않는다', () => {
    const base = { query: '', field: 'name', categoryId: '', page: 1 };
    const plain = parseGoodsOptionImportFilters(base)!;
    for (const absent of [{ noticeSourcesOnly: undefined }, { noticeSourcesOnly: null }, { noticeSourcesOnly: false }, { noticeSourcesOnly: false, excludeGoodId: 'good-1' }]) {
      expect(parseGoodsOptionImportFilters({ ...base, ...absent })).toEqual(plain);
    }
    expect(parseGoodsOptionImportFilters({ ...base, noticeSourcesOnly: true })).toEqual({ ...plain, noticeSourcesOnly: true });
    expect(parseGoodsOptionImportFilters({ ...base, noticeSourcesOnly: true, excludeGoodId: 'good-1' })).toEqual({ ...plain, noticeSourcesOnly: true, excludeGoodId: 'good-1' });
    expect(parseGoodsOptionImportFilters({ ...base, noticeSourcesOnly: true, optionSourcesOnly: false, excludeGoodId: 'good-1' })).toEqual({ ...plain, noticeSourcesOnly: true, excludeGoodId: 'good-1' });
    for (const invalid of [{ noticeSourcesOnly: 'true' }, { noticeSourcesOnly: 1 }, { noticeSourcesOnly: true, excludeGoodId: 'Bad/Id' }, { noticeSourcesOnly: true, optionSourcesOnly: true }]) {
      expect(parseGoodsOptionImportFilters({ ...base, ...invalid })).toBeNull();
    }
  });
  /* 지금까지는 불러올 수 없는 모든 경우가 한 문구였다. 원인마다 무엇이 문제이고 어떻게 고치는지를 말한다. */
  it('불러올 수 없는 상품은 원인을 가려 알린다', () => {
    const row = (attributes: Record<string, string>, name = '옵션') => ({ name, attributes, price: 10000 });
    const problem = (rows: unknown[], overrides: Record<string, unknown> = {}) => {
      const result = diagnoseGoodsOptionImportSource({ ...source, ...overrides, rows });
      if (result.ok) throw new Error('expected a problem');
      /* 목록 조회·서버·화면이 같은 판정을 쓴다. */
      expect(parseGoodsOptionImportSource({ ...source, ...overrides, rows })).toBeNull();
      expect(plan([blank], { ...source, ...overrides, rows } as GoodsOptionImportSource)).toEqual({ ok: false, error: result.error });
      return [result.problem, result.error];
    };
    expect(problem([])).toEqual(['no_active', "이 상품은 옵션이 모두 사용 중지돼 있어 불러올 옵션이 없습니다. 그 상품의 '옵션 사용 중지·다시 사용'에서 [다시 사용]을 누른 뒤 불러와 주세요."]);
    expect(problem([row({}, '기본 옵션')])).toEqual(['no_options', '이 상품은 옵션 없이 파는 상품이라 불러올 옵션이 없습니다. 다른 상품을 골라 주세요.']);
    expect(problem([row({ 색상: '빨강' }), row({}, '기본 옵션')])).toEqual(['mixed', '이 상품에는 옵션값이 없는 옵션이 섞여 있어 불러올 수 없습니다. 그 상품의 옵션목록에서 옵션값이 없는 옵션을 사용 중지하거나 삭제한 뒤 불러와 주세요.']);
    expect(problem([row({ 색상: '빨강' }), row({ 색상: '빨강', 사이즈: 'M' })])[0]).toBe('axis_mismatch');
    expect(problem([row({ 색상: '빨강' }), row({ 사이즈: 'M' })])[1]).toContain('옵션마다 옵션명이 달라 불러올 수 없습니다');
    expect(problem([row({ 색상: '빨강' }), row({ 색상: '빨강' }, '또 빨강')])).toEqual(['duplicate', '이 상품에는 옵션값이 똑같은 옵션이 두 개 있어 불러올 수 없습니다. 그 상품에서 겹치는 옵션 하나를 사용 중지한 뒤 불러와 주세요.']);
    expect(problem(Array.from({ length: 101 }, (_, index) => row({ 번호: String(index) })))).toEqual(['too_many', '이 상품은 사용 중인 옵션이 101개라 불러올 수 없습니다. 옵션은 100개까지 불러올 수 있습니다.']);
    expect(problem([row({ 가: '1', 나: '2', 다: '3', 라: '4' })])[0]).toBe('axis_limit');
    /* 상품명·판매가·옵션 이름·옵션값을 읽을 수 없는 경우는 한 묶음이다. */
    for (const unreadable of [problem([row({ 색상: '빨강' })], { name: '' }), problem([row({ 색상: '빨강' })], { basePrice: -1 }),
      problem([{ ...row({ 색상: '빨강' }), price: 1.5 }]), problem([row({ 색상: '빨강' }, '')]), problem([row({ 색상: '가'.repeat(81) })])]) {
      expect(unreadable).toEqual(['unreadable', '이 상품의 상품명·판매가나 옵션 이름·옵션값·옵션 판매가를 읽지 못해 불러올 수 없습니다. 그 상품을 열어 값을 확인한 뒤 다시 불러와 주세요.']);
    }
    expect(diagnoseGoodsOptionImportSource(source)).toEqual({ ok: true, source });
  });
});
