import { describe, expect, it } from 'vitest';
import { goodsRelationHref, normalizeGoodsRelationFilters, parseGoodsRelationInput, parseGoodsRelation } from './goods-relations';

const id = '74000000-0000-4000-8000-000000000001';
const values = { kind: 'together', title: ' 함께 구매 ', representativeGoodId: 'good-a', enabled: true, startsAt: '2026-10-13T09:00', endsAt: '2026-10-14T09:00', goodIds: ['good-a', 'good-b'] };
describe('연관상품 입력과 응답 경계', () => {
  it('순서와 대표를 보존하고 한국 시각을 절대 시각으로 바꾼다', () => {
    expect(parseGoodsRelationInput({ id, revision: 3, values })).toEqual({ ok: true, id, revision: 3, values: { ...values, title: '함께 구매', startsAt: '2026-10-13T00:00:00.000Z', endsAt: '2026-10-14T00:00:00.000Z' } });
    const filters = normalizeGoodsRelationFilters({ q: ' 100% 상품 ', kind: 'similar', page: '3', state: 'scheduled', pageSize: '50' });
    const url = new URL(goodsRelationHref(filters, 2), 'https://test.local');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '100% 상품', kind: 'similar', page: '2', state: 'scheduled', pageSize: '50' });
  });
  it('잘못된 구성·개수·대표·달력·역전 기간을 저장 전에 거른다', () => {
    for (const overrides of [{ goodIds: ['good-a'] }, { goodIds: ['good-a', 'good-a'] }, { representativeGoodId: 'good-c' },
      { goodIds: Array.from({ length: 7 }, (_, i) => `good-${i}`), representativeGoodId: 'good-0' },
      { startsAt: '2026-02-30T09:00' }, { endsAt: values.startsAt }, { enabled: 'true' }, { title: 'a'.repeat(16) }]) {
      expect(parseGoodsRelationInput({ id, revision: 0, values: { ...values, ...overrides } }).ok).toBe(false);
    }
  });
  it('실패나 깨진 응답을 유효한 편성으로 취급하지 않는다', () => {
    const saved = { id, revision: 1, kind: 'together', title: '함께 구매', representativeGoodId: 'good-a', enabled: true, startsAt: null, endsAt: null,
      createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', state: 'active', goods: ['good-a', 'good-b'].map(id => ({ id, name: id, code: id, imagePath: null, public: true })) };
    expect(parseGoodsRelation(saved)).toEqual(saved);
    expect(parseGoodsRelation({ ...saved, goods: saved.goods.slice(0, 1) })).toBeNull();
    expect(parseGoodsRelation({ ...saved, goods: [null] })).toBeNull();
  });
  it('이미지형과 코디는 2~5개, 검증 이미지와 현재 구성의 태그만 저장한다', () => {
    const visual = { imagePath: 'public-media/catalog/curation/99000000-0000-4000-8000-000000000301.webp', alt: '공간', description: '설명', hotspots: [{ goodId: 'good-a', x: 5000, y: 5000 }] };
    expect(parseGoodsRelationInput({ id, revision: 1, values: { ...values, kind: 'codi', visual } }).ok).toBe(true);
    expect(parseGoodsRelationInput({ id, revision: 1, values: { ...values, visual } }).ok).toBe(true);
    for (const patch of [{ kind: 'similar', visual }, { kind: 'codi', visual: null }, { visual, goodIds: ['good-a', 'good-b', 'good-c', 'good-d', 'good-e', 'good-f'] }, { visual: { ...visual, hotspots: [{ goodId: 'good-c', x: 1, y: 1 }] } }]) expect(parseGoodsRelationInput({ id, revision: 1, values: { ...values, ...patch } }).ok).toBe(false);
  });
  it('다른 구성은 2~10개와 선택적인 구성 표시값만 저장한다', () => {
    const other = { ...values, kind: 'other_composition', visual: null, compositionLabels: [{ goodId: 'good-a', label: '  300mL  ' }, { goodId: 'good-b', label: '　' }] };
    expect(parseGoodsRelationInput({ id, revision: 0, values: other })).toMatchObject({ ok: true, values: { compositionLabels: [{ goodId: 'good-a', label: '300mL' }] } });
    expect(parseGoodsRelationInput({ id, revision: 0, values: { ...other, goodIds: Array.from({ length: 10 }, (_, i) => `good-${i}`), representativeGoodId: 'good-0', compositionLabels: [] } }).ok).toBe(true);
    for (const patch of [
      { goodIds: Array.from({ length: 11 }, (_, i) => `good-${i}`), representativeGoodId: 'good-0', compositionLabels: [] },
      { compositionLabels: [{ goodId: 'missing', label: '2개' }] },
      { compositionLabels: [{ goodId: 'good-a', label: '2개' }, { goodId: 'good-a', label: '3개' }] },
      { compositionLabels: [{ goodId: 'good-a', label: '가'.repeat(41) }] },
      { compositionLabels: [{ goodId: 'good-a', label: '구성\n값' }] },
      { compositionLabels: [{ goodId: 'good-a', label: '2개', private: true }] },
      { kind: 'similar' },
    ]) expect(parseGoodsRelationInput({ id, revision: 0, values: { ...other, ...patch } }).ok).toBe(false);
    expect(normalizeGoodsRelationFilters({ kind: 'other_composition' }).kind).toBe('other_composition');
  });
  it('다른 구성의 관리자 응답은 대표 비공개와 null 표시값을 그대로 보존한다', () => {
    const saved = { id, revision: 1, kind: 'other_composition', title: '다른 구성', representativeGoodId: 'good-a', enabled: true, startsAt: null, endsAt: null,
      createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', state: 'active', visual: null,
      goods: ['good-a', 'good-b', 'good-c'].map((id, i) => ({ id, name: id, code: id, imagePath: null, public: i > 0, compositionLabel: i === 1 ? '2개 세트' : null })) };
    expect(parseGoodsRelation(saved)).toEqual(saved);
    expect(parseGoodsRelation({ ...saved, goods: saved.goods.map(good => ({ ...good, compositionLabel: undefined })) })).toBeNull();
    expect(parseGoodsRelation({ ...saved, kind: 'similar' })).toBeNull();
  });
  it('다른 구성 제목은 공개 parser와 같은 문자를 허용하고 기존 유형의 제목 계약을 유지한다', () => {
    const other = { ...values, kind: 'other_composition', visual: null, compositionLabels: [] };
    for (const title of ['줄\n바꿈', '탭\t문자', '제어\u0085문자']) {
      expect(parseGoodsRelationInput({ id, revision: 0, values: { ...other, title } }).ok).toBe(false);
    }
    expect(parseGoodsRelationInput({ id, revision: 0, values: { ...other, title: '\u00a0다른 구성\ufeff' } })).toMatchObject({ ok: true, values: { title: '다른 구성' } });
    expect(parseGoodsRelationInput({ id, revision: 0, values: { ...values, title: '기존\n제목' } }).ok).toBe(true);
  });
});
