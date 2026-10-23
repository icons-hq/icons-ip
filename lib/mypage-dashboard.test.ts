import { describe, expect, it } from 'vitest';
import type { UserCouponSummary } from './coupons';
import type { Good, Ip } from './data';
import { buildMypageDashboard, summarizeOrders, DASHBOARD_SHELF_LIMIT } from './mypage-dashboard';
import type { OrderListItem } from './orders';

function order(id: string, status: OrderListItem['status']): OrderListItem {
  return { id, status, total: 1000, createdAt: `2026-10-${id.padStart(2, '0')}T00:00:00.000Z`, itemLabel: id, itemCount: 1, paymentMethod: 'card' };
}

const goods = Array.from({ length: 12 }, (_, index) => ({ id: `g${index}`, ip: index % 2 ? 'ip-b' : 'ip-a', name: `굿즈 ${index}` }) as unknown as Good);
const ips = [{ id: 'ip-a', title: '에이' }, { id: 'ip-b', title: '비' }, { id: 'ip-c', title: '씨' }] as unknown as Ip[];

function held(id: string, state: 'usable' | 'used' | 'expired'): UserCouponSummary {
  return {
    id,
    status: state === 'used' ? 'used' : 'active',
    issuedAt: '2026-10-01T00:00:00.000Z',
    expiresAt: state === 'expired' ? '2026-10-02T00:00:00.000Z' : null,
    usedAt: state === 'used' ? '2026-10-03T00:00:00.000Z' : null,
    coupon: { code: id, name: id, discountType: 'fixed', discountValue: 1000, maxDiscountAmount: null, minSubtotal: 0, endsAt: null, gradeBenefit: null },
  };
}

describe('summarizeOrders', () => {
  it('counts the five ladder steps only and keeps the latest three orders', () => {
    const summary = summarizeOrders([
      order('9', 'shipping'), order('8', 'paid'), order('7', 'canceled'), order('6', 'done'), order('5', 'shipping'), order('4', 'pending'),
    ]);

    expect(summary.counts).toEqual({ paid: 1, confirmed: 0, shipping: 2, delivered: 0, done: 1 });
    expect(summary.recent.map((item) => item.id)).toEqual(['9', '8', '7']);
  });
});

describe('buildMypageDashboard', () => {
  const base = {
    orders: [order('1', 'paid')],
    wishEntries: [{ goodId: 'g1', createdAt: '' }, { goodId: 'gone', createdAt: '' }, ...goods.map((good) => ({ goodId: good.id, createdAt: '' }))],
    followedIpIds: ['ip-c', 'ip-hidden', 'ip-a'],
    coupons: [held('a', 'usable'), held('b', 'used'), held('c', 'expired'), held('d', 'usable')],
    storeCredit: { available: 4500 },
    catalog: { goods, ips },
    now: Date.parse('2026-10-23T00:00:00.000Z'),
  };

  it('joins wished goods and followed IPs with the public catalog in their saved order', () => {
    const dashboard = buildMypageDashboard(base);

    /* 판매 종료(카탈로그 밖) 굿즈도 찜 수에 든다 — 위시 화면의 '총 N개'와 같은 수다. */
    expect(dashboard.wishlist?.count).toBe(14);
    expect(dashboard.wishlist?.goods).toHaveLength(DASHBOARD_SHELF_LIMIT);
    expect(dashboard.wishlist?.goods?.[0]).toEqual({ good: goods[1], brand: '비' });
    expect(dashboard.follows).toEqual({ count: 2, ips: [ips[2], ips[0]] });
    expect(dashboard.coupons).toEqual({ usable: 2 });
    expect(dashboard.storeCredit).toEqual({ available: 4500 });
    expect(dashboard.orders?.counts.paid).toBe(1);
  });

  /* 블록은 서로 독립이다 — 한 조회가 실패하면 그 블록만 "확인하지 못했어요"가 된다. */
  it('folds each failed source to its own unavailable block', () => {
    const dashboard = buildMypageDashboard({ ...base, orders: null, coupons: null, storeCredit: null });
    expect(dashboard.orders).toBeNull();
    expect(dashboard.coupons).toBeNull();
    expect(dashboard.storeCredit).toBeNull();
    expect(dashboard.wishlist).not.toBeNull();

    /* 카탈로그만 못 읽으면 찜 수는 말하고 줄만 비운다. 팔로우는 공개 IP 만 세므로 수도 모른다. */
    const noCatalog = buildMypageDashboard({ ...base, catalog: null });
    expect(noCatalog.wishlist).toEqual({ count: 14, goods: null });
    expect(noCatalog.follows).toBeNull();
    expect(noCatalog.orders).not.toBeNull();

    expect(buildMypageDashboard({ ...base, wishEntries: null }).wishlist).toBeNull();
  });
});
