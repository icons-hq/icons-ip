import { describe, expect, it } from 'vitest';
import { categoryDisplayQueryKey, categoryDisplayReviewSummaries, defaultCategoryDisplayValues, listingCategoryDisplayQuery, parseCategoryDisplayRequest, parseCategoryDisplayValues } from './category-display';
import { LISTING_SORTS } from './listing-sorts';
import { SHOP_SORTS } from './shop-catalog';
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
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, sort: 'best_selling' })).toBeNull();
  });
  it('같은 필터 집합을 정규화하되 알 수 없는 IP도 전체 목록으로 바꾸지 않는다', () => {
    const first = parseCategoryDisplayRequest({ displayCategory: categoryId, ip: ['unknown', 'ip1', 'ip1'], type: '키링', min: '100', sort: 'price_asc' })!;
    const second = parseCategoryDisplayRequest({ displayCategory: categoryId, ip: ['ip1', 'unknown'], type: '키링', min: '100', sort: 'price_asc' })!;
    expect(first.query.ips).toEqual(['unknown', 'ip1']);
    expect(categoryDisplayQueryKey(categoryId, first.query)).toBe(categoryDisplayQueryKey(categoryId, second.query));
  });
});

describe('카테고리 전시 목록 문법 (LFS 패리티 2차 L5 — CL-10·CL-11·CL-02 잔여)', () => {
  it('화면 정렬 7종(인기도·판매량·리뷰 많은순 포함)과 URL 호환용 이름순·오래된순을 받고 그 밖의 값은 거절한다', () => {
    /* C1 migration(category_display_listing_sorts)이 DB 화이트리스트에 세 정렬을 더했다 — SHOP_SORTS 가 그것과 같다. */
    for (const sort of [...LISTING_SORTS, 'name_asc', 'name_desc', 'oldest']) {
      expect(SHOP_SORTS, sort).toContain(sort);
      expect(parseCategoryDisplayRequest({ displayCategory: categoryId, sort })?.query.sort, sort).toBe(sort);
    }
    for (const sort of ['relevance', 'best', 'best_selling']) expect(parseCategoryDisplayRequest({ displayCategory: categoryId, sort }), sort).toBeNull();
  });
  it('화면에 쓰는 질의는 필터를 버리고 화면에서 뺀 정렬을 기본값으로 돌리되 전시 id 는 그대로 둔다', () => {
    const parsed = parseCategoryDisplayRequest({ displayCategory: categoryId, ip: 'ip1', type: '키링', min: '100', max: '900', sort: 'name_asc' })!;
    expect(parsed.query.ips).toEqual(['ip1']);
    expect(listingCategoryDisplayQuery(parsed.query)).toEqual({ displayCategory: categoryId, view: 'all', ips: [], types: [], priceMin: null, priceMax: null, sort: 'recommended' });
    for (const sort of LISTING_SORTS) {
      const kept = parseCategoryDisplayRequest({ displayCategory: categoryId, sort })!;
      expect(listingCategoryDisplayQuery(kept.query).sort, sort).toBe(sort);
    }
    expect(listingCategoryDisplayQuery(parseCategoryDisplayRequest({ displayCategory: categoryId, sort: 'oldest' })!.query).sort).toBe('recommended');
  });
  it("타입 축에 '예약판매'를 받아 notFound 로 떨어지지 않고, 분류 밖 값은 여전히 거절한다", () => {
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, type: '예약판매' })?.query.types).toEqual(['예약판매']);
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, type: ['키링', '예약판매', '예약판매'] })?.query.types).toEqual(['키링', '예약판매']);
    expect(parseCategoryDisplayRequest({ displayCategory: categoryId, type: ['피규어', '인형', '키링', '아크릴', '문구', '쿠션', '파우치', '세트', '기타', '예약판매'] })?.query.types).toHaveLength(10);
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
