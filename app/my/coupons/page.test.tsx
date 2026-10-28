import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import type { CouponCombinationPolicy } from '@/lib/coupon-combinations';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  transactionMode: 'legacy' as 'legacy' | 'transaction' | 'unavailable',
  policy: null as CouponCombinationPolicy | null,
  myCoupons: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/screens/MyCoupons', () => ({ MyCoupons: mocks.myCoupons }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/coupons.server', () => ({ loadMyCoupons: async () => [] }));
vi.mock('@/lib/checkout-transaction.server', () => ({ loadGoodsTransactionRuntimeMode: async () => mocks.transactionMode }));
vi.mock('@/lib/coupon-combinations.server', () => ({ loadCouponCombinationPolicy: async () => mocks.policy }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));

beforeEach(() => {
  mocks.auth = { isConfigured: true, user: { id: '00000000-0000-4000-8000-000000001201', email: 'fan@icons.gg' }, profile: null, isStaff: false } as unknown as CurrentAuthState;
  mocks.transactionMode = 'legacy';
  mocks.policy = null;
  mocks.myCoupons.mockClear();
});

/* R25: 쿠폰함 안내가 주문서 계약(거래 런타임·쿠폰 조합 정책)을 따르도록 쿠폰함에도 같은 판정을 넘긴다. */
describe('/my/coupons page — 주문서 계약 배선', () => {
  it('운영 주문서(legacy)면 그 계약을 넘긴다', async () => {
    renderToStaticMarkup(await Page());
    expect(mocks.myCoupons.mock.calls[0][0]).toEqual({ coupons: [], checkoutRules: { transactionMode: 'legacy', couponPolicy: null } });
  });

  it('거래 런타임이면 쿠폰 조합 정책과 함께 넘긴다', async () => {
    mocks.transactionMode = 'transaction';
    mocks.policy = { revision: 2, stackingEnabled: true, maxGoodsCoupons: 3, shippingEnabled: true };
    renderToStaticMarkup(await Page());
    expect(mocks.myCoupons.mock.calls[0][0].checkoutRules).toEqual({ transactionMode: 'transaction', couponPolicy: mocks.policy });
  });

  it('로그인하지 않았으면 쿠폰함 대신 로그인으로 보낸다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false } as unknown as CurrentAuthState;
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fmy%2Fcoupons');
    expect(mocks.myCoupons).not.toHaveBeenCalled();
  });
});
