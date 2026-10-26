import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMypageDashboard } from './mypage-dashboard.server';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  loadOrders: vi.fn(),
  loadMyWishlistEntries: vi.fn(),
  loadMyFollowedIpIds: vi.fn(),
  loadMyHeldCoupons: vi.fn(),
  loadMyStoreCreditHistory: vi.fn(),
  getCatalogSnapshot: vi.fn(),
}));

vi.mock('@/lib/orders.server', () => ({ loadOrders: mocks.loadOrders }));
vi.mock('@/lib/mypage-reads.server', () => ({
  loadMyWishlistEntries: mocks.loadMyWishlistEntries,
  loadMyHeldCoupons: mocks.loadMyHeldCoupons,
}));
vi.mock('@/lib/my-follows.server', () => ({ loadMyFollowedIpIds: mocks.loadMyFollowedIpIds }));
vi.mock('@/lib/store-credits.server', () => ({ loadMyStoreCreditHistory: mocks.loadMyStoreCreditHistory }));
vi.mock('@/lib/catalog', () => ({ getCatalogSnapshot: mocks.getCatalogSnapshot }));

describe('loadMypageDashboard', () => {
  beforeEach(() => {
    mocks.loadOrders.mockReset().mockResolvedValue([]);
    mocks.loadMyWishlistEntries.mockReset().mockResolvedValue([]);
    mocks.loadMyFollowedIpIds.mockReset().mockResolvedValue([]);
    mocks.loadMyHeldCoupons.mockReset().mockResolvedValue([]);
    mocks.loadMyStoreCreditHistory.mockReset().mockResolvedValue({ available: 1200 });
    mocks.getCatalogSnapshot.mockReset().mockResolvedValue({ goods: [], ips: [] });
  });

  it('reuses the existing member reads for the viewer', async () => {
    const dashboard = await loadMypageDashboard('user-1');

    expect(mocks.loadOrders).toHaveBeenCalledWith('user-1');
    expect(mocks.loadMyWishlistEntries).toHaveBeenCalledWith('user-1');
    expect(mocks.loadMyHeldCoupons).toHaveBeenCalledWith('user-1');
    expect(mocks.loadMyFollowedIpIds).toHaveBeenCalledWith('user-1');
    expect(mocks.loadMyStoreCreditHistory).toHaveBeenCalledWith(1);
    expect(dashboard.storeCredit).toEqual({ available: 1200 });
    expect(dashboard.orders?.recent).toEqual([]);
  });

  /* 주문·적립금·카탈로그 로더는 실패하면 던진다. 대시보드 하나 때문에 /my 가 500 이 되지 않게 블록만 접는다. */
  it('keeps the page alive when a throwing reader fails', async () => {
    mocks.loadOrders.mockRejectedValue(new Error('orders down'));
    mocks.loadMyStoreCreditHistory.mockRejectedValue(new Error('credit down'));
    mocks.getCatalogSnapshot.mockRejectedValue(new Error('catalog down'));

    const dashboard = await loadMypageDashboard('user-1');

    expect(dashboard).toEqual({ orders: null, wishlist: { count: 0, goods: null }, follows: null, coupons: { usable: 0 }, storeCredit: null });
  });

  /* 위시·쿠폰 읽기가 실패(null)하면 '0개'를 지어내지 않고 그 블록을 '확인하지 못했어요'로 접는다. */
  it('folds the wish and coupon blocks when their member reads fail', async () => {
    mocks.loadMyWishlistEntries.mockResolvedValue(null);
    mocks.loadMyHeldCoupons.mockResolvedValue(null);

    const dashboard = await loadMypageDashboard('user-1');

    expect(dashboard.wishlist).toBeNull();
    expect(dashboard.coupons).toBeNull();
    expect(dashboard.storeCredit).toEqual({ available: 1200 });
  });
});
