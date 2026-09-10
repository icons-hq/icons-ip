import { describe, expect, it } from 'vitest';
import { parseCouponTargeting, couponTargetingLabel } from './coupon-targeting';
describe('쿠폰 발급 대상과 할인 상품', () => {
  it('선택 상품 조건을 켜고 대상을 비우면 전체 상품으로 해석하지 않는다', () => {
    const form = new FormData(); form.set('recipientSegment', 'first_purchase'); form.set('goodsScope', 'selected_goods'); form.set('targetGoodIds', '[]');
    expect(parseCouponTargeting(form)).toMatchObject({ ok: false, errors: { targetGoodIds: expect.any(String) } });
  });
  it('수신자 조건과 상품 대상을 독립적으로 보존한다', () => {
    const form = new FormData(); form.set('recipientSegment', 'repeat_purchase'); form.set('goodsScope', 'selected_goods'); form.set('targetGoodIds', '["good-one","good-two"]');
    expect(parseCouponTargeting(form)).toEqual({ ok: true, value: { recipientSegment: 'repeat_purchase', goodsScope: 'selected_goods', targetGoodIds: ['good-one', 'good-two'] } });
    expect(couponTargetingLabel({ recipientSegment: 'first_purchase', goodsScope: 'selected_goods', targetGoodIds: ['one'] })).toBe('첫구매 고객 · 선택 굿즈 1종');
  });
});
