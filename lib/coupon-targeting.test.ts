import { describe, expect, it } from 'vitest';
import { parseCouponTargeting, parseCouponTargetingRecord, parseCouponTargetCategories, couponTargetingLabel } from './coupon-targeting';
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
  it('카테고리 범위를 비우면 등록을 막고 다른 범위로 전환할 때 잔여 선택을 전달하지 않는다', () => {
    const form = new FormData(); form.set('goodsScope', 'selected_categories'); form.set('targetCategoryIds', '[]');
    expect(parseCouponTargeting(form)).toMatchObject({ ok: false, errors: { targetCategoryIds: expect.any(String) } });
    const id = 'ca109300-0000-4000-8000-000000000001'; form.set('targetCategoryIds', JSON.stringify([id, id])); form.set('issuanceMode', 'targeted');
    expect(parseCouponTargeting(form)).toMatchObject({ ok: true, value: { goodsScope: 'selected_categories', targetCategoryIds: [id], targetGoodIds: [], issuanceMode: 'targeted' } });
    form.set('goodsScope', 'all'); expect(parseCouponTargeting(form)).toMatchObject({ ok: true, value: { targetCategoryIds: [] } });
  });
  it('카테고리 응답의 잘못된 ID·중복·다른 범위의 잔여 대상과 발급 방식을 거절한다', () => {
    const id = 'ca109300-0000-4000-8000-000000000001';
    const value = { recipientSegment: 'all', goodsScope: 'selected_categories', targetGoodIds: [], targetCategoryIds: [id], issuanceMode: 'targeted' };
    expect(parseCouponTargetingRecord(value)).toEqual(value);
    for (const invalid of [{ ...value, targetCategoryIds: undefined }, { ...value, targetCategoryIds: ['bad'] }, { ...value, targetCategoryIds: [id, id] }, { ...value, goodsScope: 'all' }, { ...value, issuanceMode: 'public' }, { ...value, targetGoodIds: ['g1'] }]) expect(parseCouponTargetingRecord(invalid)).toBeNull();
    expect(parseCouponTargetCategories([{ id, name: '분류', path: '상위 > 분류', blocked: false }])).toHaveLength(1);
    expect(parseCouponTargetCategories([{ id, name: '분류', path: '상위 > 분류', blocked: 'false' }])).toBeNull();
    expect(couponTargetingLabel(value as Parameters<typeof couponTargetingLabel>[0])).toBe('지정 고객 · 선택 카테고리 1개');
  });
});
