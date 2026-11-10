import { describe, expect, it } from 'vitest';
import { parseMarketingCoupon, marketingCouponBenefit } from './marketing-coupons';
import { parseMarketingContent, parseMyMarketingMessage } from './marketing-messages';
export const coupon = { code: 'TEST-1000', name: 'TEST 할인', discountType: 'fixed' as const, discountValue: 1000, maxDiscountAmount: null, minSubtotal: 10000,
  startsAt: '2026-10-16T01:00:00Z', endsAt: null, validDays: 7, issueStartsAt: '2026-10-16T01:00:00Z', issueEndsAt: null, available: true };
const content = { template: 'text', title: '테스트', body: '테스트 본문', imagePath: null, goodIds: [], buttons: [], couponCode: coupon.code };
describe('메시지 쿠폰 첨부 계약', () => {
  it('기존 메시지는 그대로 읽고 선택 쿠폰을 보존한다', () => {
    const original = { ...content }; delete (original as { couponCode?: string }).couponCode;
    expect(parseMarketingContent(original)).toEqual(original); expect(parseMarketingContent(content)?.couponCode).toBe(coupon.code);
    for (const code of ['//external', 'a', 'CODE WITH SPACE', 3, {}, []]) expect(parseMarketingContent({ ...content, couponCode: code })).toBeNull();
  });
  it('금액·발급 상태·기한과 실제 첨부 대상을 검증한다', () => {
    expect(parseMarketingCoupon(coupon)).toEqual(coupon); expect(marketingCouponBenefit(coupon)).toBe('1,000원 할인');
    for (const patch of [{ discountValue: -1 }, { discountType: 'percent', discountValue: 101 }, { available: 'true' }, { issueStartsAt: 'bad' }]) expect(parseMarketingCoupon({ ...coupon, ...patch })).toBeNull();
    const message = { id: 'bf701900-0000-4000-8000-000000000001', registeredAt: coupon.startsAt, content, goodIds: [], coupon };
    expect(parseMyMarketingMessage(message)?.coupon?.code).toBe(coupon.code);
    expect(parseMyMarketingMessage({ ...message, coupon: { ...coupon, code: 'OTHER-1000' } })).toBeNull();
  });
});
