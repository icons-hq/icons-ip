import { describe, expect, it } from 'vitest';
import {
  adminReviewAuthorLabel,
  adminReviewHref,
  adminReviewResetHref,
  DEFAULT_ADMIN_REVIEW_FILTERS,
  isLowReviewRating,
  normalizeAdminReviewFilters,
  ternaryFilterToBoolean,
} from './reviews';

const REVIEW_ID = '44444444-4444-4444-8444-444444444444';

describe('어드민 리뷰 필터 정규화', () => {
  it('빈 URL은 기본 조건이 된다', () => {
    expect(normalizeAdminReviewFilters({})).toEqual(DEFAULT_ADMIN_REVIEW_FILTERS);
  });

  it('아는 값만 통과시킨다', () => {
    const filters = normalizeAdminReviewFilters({
      field: 'nickname',
      photo: 'maybe',
      rating: '9',
      sort: 'stars',
      status: 'deleted',
    });

    expect(filters.field).toBe('all');
    expect(filters.photo).toBe('all');
    expect(filters.rating).toBe('all');
    expect(filters.sort).toBe('recent');
    expect(filters.status).toBe('all');
  });

  it('저평점 고정 필터는 low=1로 켜진다', () => {
    expect(normalizeAdminReviewFilters({ low: '1' }).lowRating).toBe(true);
    expect(normalizeAdminReviewFilters({ low: 'true' }).lowRating).toBe(false);
  });

  /* 뒤집힌 기간은 RPC가 거절한다. 화면이 오류로 죽는 대신 조건을 버린다. */
  it('뒤집힌 기간은 통째로 버린다', () => {
    const filters = normalizeAdminReviewFilters({ from: '2026-08-10', to: '2026-08-01' });
    expect(filters.from).toBeNull();
    expect(filters.to).toBeNull();
  });

  it('달력에 없는 날짜는 버린다', () => {
    expect(normalizeAdminReviewFilters({ from: '2026-02-30' }).from).toBeNull();
    expect(normalizeAdminReviewFilters({ from: '2026-02-28' }).from).toBe('2026-02-28');
  });

  /* 모더레이션 큐 딥링크는 uuid여야 한다 — 임의 문자열을 RPC로 흘려보내지 않는다. */
  it('리뷰 딥링크는 uuid만 받는다', () => {
    expect(normalizeAdminReviewFilters({ reviewId: REVIEW_ID }).reviewId).toBe(REVIEW_ID);
    expect(normalizeAdminReviewFilters({ reviewId: 'or 1=1' }).reviewId).toBeNull();
  });

  it('100자를 넘는 검색어는 버린다', () => {
    expect(normalizeAdminReviewFilters({ query: 'ㄱ'.repeat(101) }).query).toBe('');
    expect(normalizeAdminReviewFilters({ query: '  키링  ' }).query).toBe('키링');
  });
});

describe('어드민 리뷰 링크', () => {
  it('기본값은 쿼리에서 빼고 페이지만 남긴다', () => {
    expect(adminReviewHref(DEFAULT_ADMIN_REVIEW_FILTERS)).toBe('/admin/cs/reviews?page=1');
    expect(adminReviewResetHref()).toBe('/admin/cs/reviews?page=1');
  });

  it('저평점·답글 조건을 링크에 싣는다', () => {
    const href = adminReviewHref(DEFAULT_ADMIN_REVIEW_FILTERS, {
      lowRating: true,
      reply: 'without',
    });

    expect(href).toContain('low=1');
    expect(href).toContain('reply=without');
  });

  /* 검색 유형은 검색어가 있을 때만 의미가 있다. 혼자 남으면 URL만 길어진다. */
  it('검색어가 없으면 검색 유형도 싣지 않는다', () => {
    const href = adminReviewHref(DEFAULT_ADMIN_REVIEW_FILTERS, { field: 'author' });
    expect(href).not.toContain('field=');
  });

  it('검색어가 있으면 검색 유형을 함께 싣는다', () => {
    const href = adminReviewHref(DEFAULT_ADMIN_REVIEW_FILTERS, { field: 'author', query: '팬' });
    expect(href).toContain('field=author');
    expect(href).toContain('query=');
  });

  it('URL을 다시 읽으면 같은 조건이 나온다', () => {
    const filters = normalizeAdminReviewFilters({
      field: 'good',
      low: '1',
      page: '3',
      photo: 'with',
      query: '키링',
      rating: '2',
      reply: 'without',
      sort: 'rating_asc',
      status: 'hidden',
    });
    const href = adminReviewHref(filters);
    const roundTripped = normalizeAdminReviewFilters(
      Object.fromEntries(new URLSearchParams(href.split('?')[1])),
    );

    expect(roundTripped).toEqual(filters);
  });
});

describe('어드민 리뷰 표시 헬퍼', () => {
  /* `'all'`은 조건 자체를 걸지 않는다 — false로 접으면 "사진 없음"만 남는다. */
  it('삼중 필터는 전체를 null로 바꾼다', () => {
    expect(ternaryFilterToBoolean('all')).toBeNull();
    expect(ternaryFilterToBoolean('with')).toBe(true);
    expect(ternaryFilterToBoolean('without')).toBe(false);
  });

  it('저평점 경계는 2점이다', () => {
    expect(isLowReviewRating(2)).toBe(true);
    expect(isLowReviewRating(3)).toBe(false);
  });

  it('닉네임이 비면 fan_ 축약을 쓴다', () => {
    expect(adminReviewAuthorLabel('  ', REVIEW_ID)).toBe('fan_444444');
    expect(adminReviewAuthorLabel('팬', REVIEW_ID)).toBe('팬');
  });
});
