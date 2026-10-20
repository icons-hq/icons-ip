import { describe, expect, it } from 'vitest';
import type { Good, GoodOption } from './data';
import { goodOtherCompositionsNextChange, parseGoodOtherCompositionReferences, resolveGoodOtherCompositions, type GoodOtherCompositionReferences } from './good-other-compositions';

const groupId = '99000000-0000-4000-8000-000000000301';
const secondGroupId = '99000000-0000-4000-8000-000000000302';
const good = (id: string, overrides: Partial<Good> = {}): Good => ({ id, name: id, ip: 'public-ip', type: '굿즈', price: 3000, priceMax: 4500,
  compareAtPrice: 5000, badge: null, stock: 'ok', stockQty: 1, img: '#fff', ...overrides });
const reference = (): GoodOtherCompositionReferences => ({ groups: [{ id: groupId, title: '다른 구성도 살펴보세요',
  goods: [{ goodId: 'good-c', compositionLabel: '300mL' }, { goodId: 'good-b', compositionLabel: null }] }], nextChangeAt: '2026-10-16T00:00:00+00:00' });

describe('다른 구성 공개 계약', () => {
  it('비공개 대표 필드 없이 1~9개 후보와 Unicode 표시값을 받는다', () => {
    const data = reference();
    expect(parseGoodOtherCompositionReferences(data, 'good-current')).toEqual(data);
    for (const count of [1, 9]) {
      const goods = Array.from({ length: count }, (_, index) => ({ goodId: `good-${index}`, compositionLabel: '🌷'.repeat(40) }));
      expect(parseGoodOtherCompositionReferences({ ...data, groups: [{ ...data.groups[0], title: '🌷'.repeat(15), goods }] })).not.toBeNull();
    }
    expect(parseGoodOtherCompositionReferences({ groups: [], nextChangeAt: null })).toEqual({ groups: [], nextChangeAt: null });
  });

  it('내부 필드나 다른 유형의 DTO를 공개 응답으로 받아들이지 않는다', () => {
    const data = reference();
    for (const field of ['representativeGoodId', 'allGoodIds', 'kind', 'revision']) {
      expect(parseGoodOtherCompositionReferences({ ...data, groups: [{ ...data.groups[0], [field]: 'hidden-a' }] })).toBeNull();
    }
    expect(parseGoodOtherCompositionReferences({ ...data, unavailable: false })).toBeNull();
    expect(parseGoodOtherCompositionReferences({ ...data, groups: [{ ...data.groups[0], goods: [{ goodId: 'good-b', compositionLabel: null, hidden: true }] }] })).toBeNull();
    expect(parseGoodOtherCompositionReferences(JSON.stringify(data))).toBeNull();
    expect(parseGoodOtherCompositionReferences([])).toBeNull();
  });

  it('공백·제어문자·길이 초과 문구를 거절하며 누락 label을 추정하지 않는다', () => {
    const data = reference();
    for (const label of ['', ' ', ' 앞', '뒤 ', '줄\n바꿈', '제어\u0085문자', '🌷'.repeat(41), undefined, 42]) {
      expect(parseGoodOtherCompositionReferences({ ...data, groups: [{ ...data.groups[0], goods: [{ goodId: 'good-b', compositionLabel: label }] }] })).toBeNull();
    }
    for (const title of ['', ' ', ' 앞', '뒤 ', '줄\n바꿈', '🌷'.repeat(16)]) {
      expect(parseGoodOtherCompositionReferences({ ...data, groups: [{ ...data.groups[0], title }] })).toBeNull();
    }
  });

  it('현재 상품·중복·잘못된 ID·그룹 크기·중복 그룹을 거절한다', () => {
    const data = reference();
    for (const ids of [[], ['good-b', 'good-b'], ['good-current'], ['Good-B'], ['https://outside.test'], ['a'.repeat(121)], Array.from({ length: 10 }, (_, i) => `good-${i}`)]) {
      expect(parseGoodOtherCompositionReferences({ ...data, groups: [{ ...data.groups[0], goods: ids.map(goodId => ({ goodId, compositionLabel: null })) }] }, 'good-current')).toBeNull();
    }
    expect(parseGoodOtherCompositionReferences({ ...data, groups: [data.groups[0], data.groups[0]] })).toBeNull();
    expect(parseGoodOtherCompositionReferences({ ...data, groups: [{ ...data.groups[0], id: 'invalid' }] })).toBeNull();
  });

  it('Postgres 시간대·소수초를 받고 ISO가 아닌 경계를 거절한다', () => {
    for (const nextChangeAt of ['2026-10-16T09:00:00+09:00', '2026-10-16T00:00:00.123456+00:00', '2026-10-16T00:00:00Z']) {
      expect(parseGoodOtherCompositionReferences({ ...reference(), nextChangeAt })).not.toBeNull();
    }
    for (const nextChangeAt of ['', ' ', '2026-10-16', 'tomorrow', '2026-02-31T00:00:00Z', '2026-10-16T24:00:00Z', undefined]) {
      expect(parseGoodOtherCompositionReferences({ ...reference(), nextChangeAt })).toBeNull();
    }
  });
});

describe('다른 구성 카드 결합', () => {
  it('비공개 대표가 없어도 공개 B/C를 표시하고 상품 가격·옵션·품절을 그대로 보존한다', () => {
    const data = reference();
    const soldOut = good('good-c', { stock: 'soldout', stockQty: 0 });
    const result = resolveGoodOtherCompositions(data, [good('good-current'), good('good-b'), soldOut], 'good-current');
    expect(result.groups[0].goods.map(member => member.good.id)).toEqual(['good-c', 'good-b']);
    expect(result.groups[0].goods[0]).toEqual({ good: soldOut, compositionLabel: '300mL' });
    expect(result.groups[0].goods[0].good).toBe(soldOut);
  });

  it('현재 상품이나 모든 후보가 공개 재조회에서 사라지면 그룹을 숨긴다', () => {
    expect(resolveGoodOtherCompositions(reference(), [good('good-b')], 'good-current').groups).toEqual([]);
    expect(resolveGoodOtherCompositions(reference(), [good('good-current')], 'good-current').groups).toEqual([]);
    const result = resolveGoodOtherCompositions(reference(), [good('good-b')], 'good-b');
    expect(result.groups).toEqual([]);
    expect(result.nextChangeAt).toBe(reference().nextChangeAt);
  });

  it('복수 그룹을 병합하거나 전이하지 않고 같은 상품의 그룹별 label을 유지한다', () => {
    const data = reference();
    data.groups.push({ id: secondGroupId, title: '두 번째 구성', goods: [{ goodId: 'good-b', compositionLabel: '2개 세트' }, { goodId: 'good-d', compositionLabel: null }] });
    const result = resolveGoodOtherCompositions(data, [good('good-current'), good('good-b'), good('good-d')], 'good-current');
    expect(result.groups.map(group => group.goods.map(({ good, compositionLabel }) => [good.id, compositionLabel])))
      .toEqual([[['good-b', null]], [['good-b', '2개 세트'], ['good-d', null]]]);
  });

  it('그룹 시작·종료 및 옵션 가격·공급·상품 판매기간 중 가장 빠른 경계를 UTC로 합친다', () => {
    const option: GoodOption = { id: 'option', name: '기본', code: 'SKU', price: 3000, stockQty: 1, isDefault: true, attributes: {},
      pricing: { regularPrice: 5000, effectivePrice: 3000, pricePeriodId: null, startsAt: null, endsAt: null, calculatedAt: '2026-10-15T00:00:00Z', nextChangeAt: '2026-10-15T13:00:00+09:00' },
      supply: { mode: 'stock', availableQty: 1, policyId: null, policyRevision: null, state: 'stock', startsAt: null, endsAt: null, expectedShipDate: null, calculatedAt: '2026-10-15T00:00:00Z', nextChangeAt: '2026-10-15T03:00:00Z' } };
    const card = good('good-b', { options: [option], salePeriod: { startsAt: null, endsAt: null, state: 'open', calculatedAt: '2026-10-15T00:00:00Z', nextChangeAt: '2026-10-15T05:00:00Z' } });
    const data = resolveGoodOtherCompositions(reference(), [good('good-current'), card], 'good-current');
    expect(goodOtherCompositionsNextChange(data)).toBe('2026-10-15T03:00:00.000Z');
    expect(goodOtherCompositionsNextChange({ ...data, nextChangeAt: '2026-10-15T01:00:00Z' })).toBe('2026-10-15T01:00:00.000Z');
    expect(goodOtherCompositionsNextChange({ groups: [], nextChangeAt: null })).toBeNull();
  });
});
