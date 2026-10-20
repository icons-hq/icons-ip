import { describe, expect, it } from 'vitest';
import { categoryDisplayQueryKey, defaultCategoryDisplayValues, parseCategoryDisplayRequest, parseCategoryDisplayValues } from './category-display';
const categoryId = '92930000-0000-4000-8000-000000000001';

describe('카테고리 전시 저장 계약', () => {
  it('비노출 초안과 모드별 선택은 함께 보존하고 입력 객체를 공유하지 않는다', () => {
    const input = { ...defaultCategoryDisplayValues(categoryId), goodIds: ['g1'], mode: 'manual' as const };
    const parsed = parseCategoryDisplayValues(input)!;
    expect(parsed).toEqual(input);
    parsed.goodIds.push('g2');
    expect(input.goodIds).toEqual(['g1']);
    expect(parsed.categoryIds).toEqual([categoryId]);
  });
  it('수동1000개를 수용하고 초과·중복·없는 형식·알 수 없는 필드를 거절한다', () => {
    const input = { ...defaultCategoryDisplayValues(categoryId), goodIds: Array.from({ length: 1000 }, (_, i) => `g${i}`) };
    expect(parseCategoryDisplayValues(input)?.goodIds).toHaveLength(1000);
    expect(parseCategoryDisplayValues({ ...input, goodIds: [...input.goodIds, 'g1000'] })).toBeNull();
    expect(parseCategoryDisplayValues({ ...input, goodIds: ['g1', 'g1'] })).toBeNull();
    expect(parseCategoryDisplayValues({ ...input, goodIds: ['../hidden'] })).toBeNull();
    expect(parseCategoryDisplayValues({ ...input, categoryName: '변경' })).toBeNull();
  });
  it('배너·영상·추천 ON 요구값과 실제 업로드 경로를 확인한다', () => {
    const values = defaultCategoryDisplayValues(categoryId);
    expect(parseCategoryDisplayValues({ ...values, banner: { ...values.banner, enabled: true } })).toBeNull();
    expect(parseCategoryDisplayValues({ ...values, video: { enabled: true, goodId: null } })).toBeNull();
    expect(parseCategoryDisplayValues({ ...values, banner: { ...values.banner, imagePath: 'https://external.example/image.jpg' } })).toBeNull();
    expect(parseCategoryDisplayValues({ ...values, banner: { ...values.banner, linkPath: '//external.example' } })).toBeNull();
    expect(parseCategoryDisplayValues({ ...values, recommendations: { ...values.recommendations, itemCount: 13 } })).toBeNull();
    expect(parseCategoryDisplayValues({ ...values, enabled: true, categoryIds: [] })).toBeNull();
    expect(parseCategoryDisplayValues({ ...values, enabled: true, mode: 'manual', goodIds: [] })?.enabled).toBe(true);
  });
});

describe('공개 전시 조건', () => {
  it('독립 전시 조건을 기존 category와 혼합하거나 잘못된 스코프로 넓히지 않는다', () => {
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, category: categoryId })).toBeNull();
    expect(parseCategoryDisplayRequest({ displayCategory: [categoryId, categoryId] })).toBeNull();
    expect(parseCategoryDisplayRequest({ displayCategory: 'missing' })).toBeNull();
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, min: '200', max: '100' })).toBeNull();
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, sort: 'sales' })).toBeNull();
  });
  it('같은 필터 집합을 정규화하되 알 수 없는 IP도 전체 목록으로 바꾸지 않는다', () => {
    const first = parseCategoryDisplayRequest({ displayCategory: categoryId, ip: ['unknown', 'ip1', 'ip1'], type: '키링', min: '100', sort: 'price_asc' })!;
    const second = parseCategoryDisplayRequest({ displayCategory: categoryId, ip: ['ip1', 'unknown'], type: '키링', min: '100', sort: 'price_asc' })!;
    expect(first.query.ips).toEqual(['unknown', 'ip1']);
    expect(categoryDisplayQueryKey(categoryId, first.query)).toBe(categoryDisplayQueryKey(categoryId, second.query));
  });
});
