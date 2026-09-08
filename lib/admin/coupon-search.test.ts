import { describe, expect, it } from 'vitest';
import {
  COUPON_SEARCH_PAGE_SIZE,
  EMPTY_COUPON_SEARCH,
  adminCouponHref,
  couponSearchArgs,
  hasCouponSearchFilter,
  normalizeCouponSearch,
} from './coupon-search';

describe('couponSearchArgs', () => {
  it('빈 조건은 전부 null 로 내려간다', () => {
    const args = couponSearchArgs(EMPTY_COUPON_SEARCH);

    expect(args).toMatchObject({
      p_query: null,
      p_status: null,
      p_target_kind: null,
      p_from: null,
      p_to: null,
      p_limit: COUPON_SEARCH_PAGE_SIZE,
      p_offset: 0,
    });
  });

  /* 기간의 끝은 「미만」으로 비교한다. 고른 날 0시를 그대로 넘기면 그 날 하루가 빠진다. */
  it('종료일은 다음 날 0시(KST)로 넘긴다', () => {
    const args = couponSearchArgs({ ...EMPTY_COUPON_SEARCH, from: '2026-09-01', to: '2026-09-30' });

    expect(args.p_from).toBe('2026-08-31T15:00:00.000Z');
    expect(args.p_to).toBe('2026-09-30T15:00:00.000Z');
  });

  it('페이지는 offset 으로 바뀐다', () => {
    expect(couponSearchArgs({ ...EMPTY_COUPON_SEARCH, page: 3 }).p_offset).toBe(
      COUPON_SEARCH_PAGE_SIZE * 2,
    );
  });

  it('모르는 상태·대상은 조건 없음으로 접는다', () => {
    const args = couponSearchArgs({
      ...EMPTY_COUPON_SEARCH,
      status: 'deleted',
      targetKind: 'vip_only',
    });

    expect(args.p_status).toBeNull();
    expect(args.p_target_kind).toBeNull();
  });
});

describe('normalizeCouponSearch', () => {
  it('주소의 조건을 그대로 읽는다', () => {
    const form = normalizeCouponSearch({
      query: ' AUTUMN ',
      status: 'archived',
      targetKind: 'bought_good',
      from: '2026-09-01',
      page: '4',
    });

    expect(form).toEqual({
      query: 'AUTUMN',
      status: 'archived',
      targetKind: 'bought_good',
      from: '2026-09-01',
      to: '',
      page: 4,
    });
  });

  it('깨진 날짜·페이지는 기본값으로 떨어뜨린다 — 조회가 실패하는 것보다 낫다', () => {
    const form = normalizeCouponSearch({ from: '9월 1일', page: '0' });

    expect(form.from).toBe('');
    expect(form.page).toBe(1);
  });
});

describe('adminCouponHref', () => {
  it('페이지를 넘겨도 조건이 남는다', () => {
    const href = adminCouponHref(
      { ...EMPTY_COUPON_SEARCH, query: 'AUTUMN', status: 'active' },
      { page: 2 },
    );

    expect(href).toBe('/admin/sales/coupons?query=AUTUMN&status=active&page=2');
  });

  it('조건이 없으면 맨 주소다', () => {
    expect(adminCouponHref(EMPTY_COUPON_SEARCH)).toBe('/admin/sales/coupons');
  });
});

describe('hasCouponSearchFilter', () => {
  it('조건이 하나라도 있으면 참', () => {
    expect(hasCouponSearchFilter(EMPTY_COUPON_SEARCH)).toBe(false);
    expect(hasCouponSearchFilter({ ...EMPTY_COUPON_SEARCH, targetKind: 'first_purchase' })).toBe(true);
  });
});
