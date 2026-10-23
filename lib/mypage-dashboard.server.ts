import 'server-only';

import { getCatalogSnapshot } from '@/lib/catalog';
import { loadMyCoupons } from '@/lib/coupons.server';
import { loadMyFollowedIpIds } from '@/lib/my-follows.server';
import { loadOrders } from '@/lib/orders.server';
import { loadMyStoreCreditHistory } from '@/lib/store-credits.server';
import { getWishlistEntries } from '@/lib/wishlist.server';
import { buildMypageDashboard, type MypageDashboard } from './mypage-dashboard';

/* 마이페이지 대시보드 로더 (LFS 패리티 2차 L6 · MY-02·MY-04).
 *
 * 블록마다 기존 서버 조회를 그대로 쓴다 — 주문 목록(loadOrders)·위시(getWishlistEntries)·쿠폰함(loadMyCoupons)·
 * 적립금 내역(loadMyStoreCreditHistory)·카탈로그 스냅샷. 새로 더한 것은 팔로우한 IP 목록뿐이다.
 * 조회는 서로를 기다리지 않게 함께 부르고, 던지는 조회는 그 블록만 null 로 접는다(마이페이지가 500 이 되지 않게). */
export async function loadMypageDashboard(userId: string): Promise<MypageDashboard> {
  const [orders, wishEntries, followedIpIds, coupons, storeCredit, catalog] = await Promise.all([
    loadOrders(userId).catch(() => null),
    getWishlistEntries().catch(() => null),
    loadMyFollowedIpIds(userId),
    loadMyCoupons().catch(() => null),
    loadMyStoreCreditHistory(1).catch(() => null),
    getCatalogSnapshot().catch(() => null),
  ]);
  return buildMypageDashboard({ orders, wishEntries, followedIpIds, coupons, storeCredit, catalog });
}
