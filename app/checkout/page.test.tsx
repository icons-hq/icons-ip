import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import type { UserCouponSummary } from '@/lib/coupons';
import type { CartCouponState } from '@/lib/coupons.server';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  couponState: null as unknown as CartCouponState,
  transactionMode: 'legacy' as 'legacy' | 'transaction' | 'unavailable',
  checkout: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  transactionCheckout: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/screens/Checkout', () => ({ Checkout: mocks.checkout }));
vi.mock('@/components/screens/GoodsTransactionCheckout', () => ({ GoodsTransactionCheckout: mocks.transactionCheckout }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', () => ({ isOnboarded: () => true, onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}` }));
vi.mock('@/lib/address-book', () => ({ addressBookOpenFor: () => true }));
vi.mock('@/lib/catalog', () => ({ getCatalogSnapshot: async () => ({ goods: [], ips: [] }) }));
vi.mock('@/lib/checkout.server', () => ({
  loadCheckoutAddressPrefill: async () => ({ address: null, source: null, book: [] }),
  loadLatestPendingCheckoutOrderId: async () => null,
}));
vi.mock('@/lib/coupons.server', () => ({ loadCartCouponState: async () => mocks.couponState }));
vi.mock('@/lib/coupon-combinations.server', () => ({ loadCouponCombinationPolicy: async () => null }));
vi.mock('@/lib/checkout-transaction.server', () => ({ loadGoodsTransactionRuntimeMode: async () => mocks.transactionMode }));
vi.mock('@/lib/payments/bank-transfer.server', () => ({ bankTransferCheckoutEnabled: async () => true }));
vi.mock('@/lib/payments/goods-checkout-availability', () => ({ goodsCheckoutPaymentsEnabled: () => true }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));

const held = (id: string, name: string): UserCouponSummary => ({
  id, status: 'active', issuedAt: '2026-08-30T00:00:00Z', expiresAt: null, usedAt: null,
  coupon: { code: 'CPNFIX5K', name, discountType: 'fixed', discountValue: 5000, maxDiscountAmount: null, minSubtotal: 0, endsAt: null, gradeBenefit: null },
});

beforeEach(() => {
  mocks.auth = {
    isConfigured: true,
    user: { id: '00000000-0000-4000-8000-000000001201', email: 'fan@icons.gg' },
    profile: null,
    isStaff: false,
  } as unknown as CurrentAuthState;
  mocks.transactionMode = 'legacy';
  mocks.checkout.mockClear();
  mocks.transactionCheckout.mockClear();
});

/* R25(D3①): 운영 주문서는 장바구니와 같은 보유 쿠폰 목록·선택을 받아야 장바구니에서 고르지 않은 쿠폰도 고를 수 있다. */
describe('/checkout page — 쿠폰 배선', () => {
  it('보유 쿠폰 전체와 장바구니 선택을 주문서에 넘긴다(장바구니에서 고르지 않았어도)', async () => {
    mocks.couponState = { selectedUserCouponId: null, coupons: [held('11111111-1111-4111-8111-111111111111', '5천원 할인'), held('22222222-2222-4222-8222-222222222222', '3천원 할인')] };

    renderToStaticMarkup(await Page({}));

    expect(mocks.checkout).toHaveBeenCalledTimes(1);
    const props = mocks.checkout.mock.calls[0][0];
    expect(props.couponState).toBe(mocks.couponState);
    expect(props.appliedCoupon).toBeNull();
  });

  it('장바구니에서 고른 쿠폰은 적용 쿠폰으로도 넘긴다', async () => {
    const chosen = held('11111111-1111-4111-8111-111111111111', '5천원 할인');
    mocks.couponState = { selectedUserCouponId: chosen.id, coupons: [chosen] };

    renderToStaticMarkup(await Page({}));

    const props = mocks.checkout.mock.calls[0][0];
    expect(props.couponState).toBe(mocks.couponState);
    expect(props.appliedCoupon).toBe(chosen);
  });

  it('보유 쿠폰을 불러오지 못한 상태도 그대로 넘겨 주문서가 사실대로 알린다', async () => {
    mocks.couponState = { selectedUserCouponId: null, coupons: [], unavailable: true };

    renderToStaticMarkup(await Page({}));

    expect(mocks.checkout.mock.calls[0][0].couponState).toEqual({ selectedUserCouponId: null, coupons: [], unavailable: true });
  });
});
