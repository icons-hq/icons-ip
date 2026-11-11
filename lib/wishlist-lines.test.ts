import { describe, expect, it } from 'vitest';
import type { Good, Ip } from './data';
import { followedIpList, wishlistLines, wishlistTab, wishlistTabHref } from './wishlist-lines';

const goods = [{ id: 'g1', ip: 'ip-a' }, { id: 'g2', ip: 'ip-gone' }] as unknown as Good[];
const ips = [{ id: 'ip-a', title: '에이' }, { id: 'ip-b', title: '비' }] as unknown as Ip[];

describe('wishlist lines', () => {
  it('keeps every wished entry in saved order, delisted goods as null lines', () => {
    expect(wishlistLines([
      { goodId: 'gone', createdAt: '2026-10-03' },
      { goodId: 'g1', createdAt: '2026-10-02' },
      { goodId: 'g2', createdAt: '2026-10-01' },
    ], { goods, ips })).toEqual([
      { goodId: 'gone', good: null, brand: null },
      { goodId: 'g1', good: goods[0], brand: '에이' },
      { goodId: 'g2', good: goods[1], brand: null },
    ]);
  });

  it('joins followed IPs in follow order and keeps an unreadable list unreadable', () => {
    expect(followedIpList(['ip-b', 'ip-hidden', 'ip-a'], ips)).toEqual([ips[1], ips[0]]);
    expect(followedIpList([], ips)).toEqual([]);
    expect(followedIpList(null, ips)).toBeNull();
  });

  it('reads the tab from the query and writes its URL back', () => {
    expect(wishlistTab('ip')).toBe('ip');
    expect(wishlistTab(['ip', 'goods'])).toBe('ip');
    expect(wishlistTab('brand')).toBe('goods');
    expect(wishlistTab(undefined)).toBe('goods');
    expect(wishlistTabHref('ip')).toBe('/my/wishlist?tab=ip');
    expect(wishlistTabHref('goods')).toBe('/my/wishlist');
  });
});
