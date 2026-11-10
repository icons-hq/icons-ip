import { describe, expect, it } from 'vitest';
import { exactGoodsOptionIdentity, goodsOptionImportTargetVersion, parseGoodsOptionImportFilters, parseGoodsOptionImportSource, planGoodsOptionImport,
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
    expect(plan([blank], { ...source, rows: [{ ...source.rows[0], price: 9000 }] }, true)).toMatchObject({ ok: false });
    expect(plan([blank], source, true, 2147483647)).toMatchObject({ ok: false });
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
    expect(plan(current)).toMatchObject({ ok: false, error: expect.stringContaining('101개') });
    expect(plan([{ ...blank, stockQty: -1 }])).toMatchObject({ ok: false });
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
});
