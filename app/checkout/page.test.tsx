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
  draft: null as unknown,
  loadDraft: vi.fn(),
  deriveGoods: vi.fn(),
  deriveUser: vi.fn(),
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
vi.mock('@/lib/checkout-draft.server', () => ({ loadCheckoutDraft: async (...args: unknown[]) => { mocks.loadDraft(...args); return mocks.draft; } }));
vi.mock('@/lib/payments/goods-sale-restriction.server', () => ({
  deriveGoodsCartProvider: async (goodIds: string[]) => { mocks.deriveGoods(goodIds); return 'toss'; },
  deriveUserCartProvider: async (userId: string) => { mocks.deriveUser(userId); return 'toss'; },
}));
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
  mocks.draft = null;
  mocks.loadDraft.mockClear();
  mocks.deriveGoods.mockClear();
  mocks.deriveUser.mockClear();
  mocks.couponState = { selectedUserCouponId: null, coupons: [] };
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

/* 주문서 초안(ADR-0030): ?draft= 가 있으면 그 줄만 주문서에 올리고 결제사도 그 줄로 파생한다. */
describe('/checkout page — 주문서 초안', () => {
  const draftId = '00000000-0000-4000-8000-0000000000d1';
  const draft = { id: draftId, source: 'selection', baseGoodId: null, expiresAt: '2099-01-01T00:00:00Z', stale: false,
    lines: [{ goodId: 'g2', variantId: '00000000-0000-4000-8000-000000000002', qty: 1 }] };

  it('로그인 사용자의 초안을 읽어 주문서에 넘기고, 결제사는 장바구니 전체가 아니라 초안 줄로 파생한다', async () => {
    mocks.draft = draft;
    renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ draft: draftId }) }));
    expect(mocks.loadDraft).toHaveBeenCalledWith('00000000-0000-4000-8000-000000001201', draftId);
    expect(mocks.checkout.mock.calls[0][0].draft).toBe(draft);
    expect(mocks.deriveGoods).toHaveBeenCalledWith(['g2']);
    expect(mocks.deriveUser).not.toHaveBeenCalled();
  });

  it('초안이 없으면 지금처럼 장바구니 전체 주문서다', async () => {
    renderToStaticMarkup(await Page({}));
    expect(mocks.loadDraft).not.toHaveBeenCalled();
    expect(mocks.checkout.mock.calls[0][0].draft).toBeNull();
    expect(mocks.deriveUser).toHaveBeenCalled();
  });

  it('만료·남의 초안·잘못된 초안 번호는 장바구니 전체로 바꾸지 않고 다시 열라고 안내한다', async () => {
    for (const value of [draftId, 'not-a-draft']) {
      const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ draft: value }) }));
      expect(html).toContain('주문서를 다시 열어주세요');
      expect(html).toContain('href="/cart"');
    }
    mocks.draft = 'error';
    expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ draft: draftId }) }))).toContain('주문서를 불러오지 못했어요');
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it('로그인 전이면 초안 주문서로 돌아오게 로그인으로 보낸다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false } as unknown as CurrentAuthState;
    await expect(Page({ searchParams: Promise.resolve({ draft: draftId }) })).rejects.toThrow(
      `NEXT_REDIRECT:/login?next=${encodeURIComponent(`/checkout?draft=${draftId}`)}`);
  });
});

