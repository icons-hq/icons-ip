import { describe, expect, it } from 'vitest';
import {
  adminCouponListHref,
  normalizeAdminCouponFilters,
  normalizeAdminCouponForm,
} from './coupons';

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const valid = {
  code: 'autumn-3000',
  name: '가을 프로모션 3천원',
  discountType: 'fixed',
  discountValue: '3000',
  minSubtotal: '20000',
  startsAt: '2026-09-01T00:00',
  endsAt: '2026-09-30T23:59',
  status: 'active',
};

describe('normalizeAdminCouponForm', () => {
  it('코드를 대문자로 접고 KST 시각을 ISO 로 옮긴다', () => {
    const result = normalizeAdminCouponForm(form(valid));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toBe('AUTUMN-3000');
    expect(result.value.previousCode).toBeNull();
    /* KST 2026-09-01 00:00 = UTC 2026-08-31 15:00. */
    expect(result.value.startsAt).toBe('2026-08-31T15:00:00.000Z');
    expect(result.value.minSubtotal).toBe(20000);
    expect(result.value.issueLimit).toBeNull();
    expect(result.value.gradeBenefit).toBeNull();
  });

  it('코드 형식·이름·할인 값을 필드 단위로 거른다', () => {
    const result = normalizeAdminCouponForm(form({
      ...valid,
      code: '한글코드',
      name: '',
      discountValue: '0',
    }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.code).toContain('대문자');
    expect(result.errors.name).toContain('입력');
    expect(result.errors.discountValue).toContain('1 이상');
  });

  it('정률 100% 초과와 정액의 최대 할인액을 거른다', () => {
    const percent = normalizeAdminCouponForm(form({
      ...valid,
      discountType: 'percent',
      discountValue: '120',
    }));
    expect(percent.ok).toBe(false);
    if (!percent.ok) expect(percent.errors.discountValue).toContain('100%');

    const fixedWithCap = normalizeAdminCouponForm(form({
      ...valid,
      maxDiscountAmount: '5000',
    }));
    expect(fixedWithCap.ok).toBe(false);
    if (!fixedWithCap.ok) expect(fixedWithCap.errors.maxDiscountAmount).toContain('정액');
  });

  it('종료가 시작보다 앞서면 거부한다', () => {
    const result = normalizeAdminCouponForm(form({
      ...valid,
      startsAt: '2026-09-30T00:00',
      endsAt: '2026-09-01T00:00',
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.endsAt).toContain('뒤여야');
  });

  it('등급 혜택 값을 등급 사다리로 제한한다', () => {
    const bad = normalizeAdminCouponForm(form({ ...valid, gradeBenefit: 'vip' }));
    expect(bad.ok).toBe(false);

    const good = normalizeAdminCouponForm(form({ ...valid, gradeBenefit: 'gold' }));
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.gradeBenefit).toBe('gold');
  });
});

describe('admin coupon list URL state', () => {
  it('keeps the search, status, page, and selected coupon together', () => {
    const filters = normalizeAdminCouponFilters({
      couponCode: ' autumn-3000 ',
      page: '3',
      q: '가을',
      status: 'archived',
    });

    expect(filters).toEqual({
      query: '가을',
      status: 'archived',
      page: 3,
      selectedCode: 'AUTUMN-3000',
    });
    expect(adminCouponListHref(filters)).toBe(
      '/admin/sales/coupons?q=%EA%B0%80%EC%9D%84&status=archived&couponCode=AUTUMN-3000&page=3',
    );
    expect(adminCouponListHref(filters, { page: 4 })).toContain('couponCode=AUTUMN-3000');
  });

  it('fails closed for malformed filters and overlong search values', () => {
    expect(normalizeAdminCouponFilters({
      couponCode: 'not a code',
      page: '-1',
      q: 'x'.repeat(101),
      status: 'unknown',
    })).toEqual({
      query: '',
      status: 'all',
      page: 1,
      selectedCode: null,
      inputError: '검색어는 100자 이하로 입력해주세요.',
    });
  });
});
