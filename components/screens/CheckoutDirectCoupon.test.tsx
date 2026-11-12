import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { UserCouponSummary } from '@/lib/coupons';

vi.mock('@/app/my/coupons/actions', () => ({ claimCouponCodeAction: vi.fn() }));

import { CheckoutDirectCoupon } from './CheckoutDirectCoupon';

const first: UserCouponSummary = {
  id: '11111111-1111-4111-8111-111111111111', status: 'active', issuedAt: '2026-11-01T00:00:00Z', expiresAt: null, usedAt: null,
  coupon: { code: 'CPNFIRST', name: '첫구매 3천원', discountType: 'fixed', discountValue: 3000, maxDiscountAmount: null, minSubtotal: 10000, endsAt: null, gradeBenefit: null },
};
const order = { orderId: '33333333-3333-4333-8333-333333333333', orderNumber: '2026111200000001', paymentMethod: 'card' as const, replaceable: true };
const held: UserCouponSummary = { ...first, status: 'used', usedAt: '2026-11-12T00:00:00Z', pendingOrder: order };

const render = (coupons: UserCouponSummary[], selectedUserCouponId: string | null = null) => renderToStaticMarkup(
  <CheckoutDirectCoupon couponState={{ selectedUserCouponId: null, coupons }} onSelect={() => {}} selectedUserCouponId={selectedUserCouponId} />,
);

/* QA1 S-D2-08 A: 결제 대기 주문이 잡은 첫구매 쿠폰이 바로구매 주문서 쿠폰 칸에 아예 없어 18,000원으로 접수됐다. */
describe('CheckoutDirectCoupon — 진행 중인 주문이 잡은 쿠폰', () => {
  it('목록에 두고, 이 주문을 접수하면 그 주문이 닫히고 쿠폰을 여기에 쓴다고 알린다', () => {
    const markup = render([held]);
    expect(markup).toContain(`<option value="${held.id}">첫구매 3천원 · ₩3,000 할인 · 주문 진행 중</option>`);
    expect(markup).toContain('‘첫구매 3천원’ 쿠폰은 진행 중인 주문에서 사용 중이에요. 이 주문을 접수하면 그 주문은 결제 없이 닫히고 쿠폰을 여기에 써요.');
    expect(markup).toContain(`href="/orders/${order.orderId}">진행 중인 주문 확인</a>`);
    expect(markup).not.toContain('사용할 수 있는 쿠폰이 없어요');
  });

  it('고르면 선택으로 보이고 혜택·조건을 함께 보인다', () => {
    const markup = render([held], held.id);
    expect(markup).toContain(`<option value="${held.id}" selected="">`);
    expect(markup).toContain('₩10,000 이상 구매 시');
  });

  it('결제 승인을 확인 중인 주문이 잡은 쿠폰은 고를 수 없다', () => {
    const markup = render([{ ...held, pendingOrder: { ...order, replaceable: false } }]);
    expect(markup).not.toContain(`<option value="${held.id}"`);
    expect(markup).toContain('사용할 수 있는 쿠폰이 없어요');
    expect(markup).not.toContain('진행 중인 주문 확인');
  });
});
