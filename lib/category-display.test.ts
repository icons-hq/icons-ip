import { describe, expect, it } from 'vitest';
import { categoryDisplayQueryKey, categoryDisplayReviewSummaries, defaultCategoryDisplayValues, parseCategoryDisplayRequest, parseCategoryDisplayValues } from './category-display';
import { SHOP_VIEW_SORTS } from './shop-catalog';
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

describe('카테고리 전시 목록 문법 (LFS 패리티 2차 L5 — CL-10·CL-11·CL-02 잔여)', () => {
  it('컬렉션과 같은 정렬 7종을 받고 그 밖의 값은 거절한다', () => {
    for (const sort of SHOP_VIEW_SORTS.all) {
      expect(parseCategoryDisplayRequest({ displayCategory: categoryId, sort })?.query.sort, sort).toBe(sort);
    }
    for (const sort of ['relevance', 'sales', 'best']) expect(parseCategoryDisplayRequest({ displayCategory: categoryId, sort }), sort).toBeNull();
  });
  it("타입 축에 '예약판매'를 받아 notFound 로 떨어지지 않고, 분류 밖 값은 여전히 거절한다", () => {
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, type: '예약판매' })?.query.types).toEqual(['예약판매']);
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, type: ['키링', '예약판매', '예약판매'] })?.query.types).toEqual(['키링', '예약판매']);
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, type: ['피규어', '인형', '키링', '아크릴', '문구', '쿠션', '파우치', '세트', '예약판매'] })?.query.types).toHaveLength(9);
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, type: '중고' })).toBeNull();
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, type: 'PRE-ORDER' })).toBeNull();
  });
  it('다음 묶음의 별점은 그 묶음 굿즈 몫의 올바른 값만 받는다', () => {
    const summaries = categoryDisplayReviewSummaries({
      g1: { count: 3, average: 4.33 }, g2: { count: 0, average: 4 }, g3: { count: 2, average: 6 }, outside: { count: 1, average: 5 }, g4: 'bad',
    }, ['g1', 'g2', 'g3', 'g4']);
    expect(summaries).toEqual({ g1: { count: 3, average: 4.33 } });
    expect(categoryDisplayReviewSummaries(undefined, ['g1'])).toEqual({});
    expect(categoryDisplayReviewSummaries([{ goodId: 'g1' }], ['g1'])).toEqual({});
  });
});
