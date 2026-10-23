import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogIpDetail } from '@/lib/catalog';
import type { CurrentAuthState } from '@/lib/auth/server';
import type { IpFollowState } from '@/lib/ip-follow';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  detail: null as CatalogIpDetail | null,
  identity: null as { internalId: string; publicSlug: string; isAlias: boolean } | null,
  followState: null as unknown as IpFollowState,
  ipDetail: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('not found'); },
  permanentRedirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
}));
vi.mock('@/components/screens/IpDetail', () => ({ IpDetail: mocks.ipDetail }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/catalog', () => ({ getCatalogIpDetail: () => mocks.detail }));
vi.mock('@/lib/ip-identity.server', () => ({ resolvePublicIpIdentity: () => mocks.identity }));
vi.mock('@/lib/ip-follow.server', () => ({ getIpFollowState: () => mocks.followState }));
vi.mock('@/lib/catalog-categories.server', () => ({ loadPublicCatalogCategories: async () => [] }));
vi.mock('@/lib/wishlist-ids.server', () => ({ loadListingWishlist: async () => ({ viewerId: 'viewer-1', goodIds: ['g2'] }) }));

const ip = {
  id: 'ip-1',
  title: '화산강림',
  sub: 'ORIGINAL IP',
  v: { key: 'webtoon', label: '웹툰', color: '#38F0C0' },
  glyph: '火',
  tagline: '불꽃처럼 피어나는 이야기',
  synopsis: '화산강림 세계관',
  bg: 'linear-gradient(#111, #222)',
  fans: 100,
  goods: 0,
  cards: 0,
  featured: true,
};

beforeEach(() => {
  mocks.detail = { source: 'mock', ip, goods: [], cards: [], events: [], posts: [] };
  mocks.identity = { internalId: 'ip-1', publicSlug: 'ip-1', isAlias: false };
  mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
  mocks.followState = { isFollowed: true, notifyDrops: true, notifyEvents: false };
  mocks.ipDetail.mockClear();
});

describe('/ip/[id] page', () => {
  it('passes the loaded channel state and notification error flag to the hall screen', async () => {
    renderToStaticMarkup(await Page({
      params: Promise.resolve({ id: 'ip-1' }),
      searchParams: Promise.resolve({ notification_error: '1', notification_saved: '1' }),
    }));

    expect(mocks.ipDetail.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      detail: mocks.detail,
      publicSlug: 'ip-1',
      followState: mocks.followState,
      followError: false,
      notificationError: true,
      notificationSaved: true,
    }));
  });

  it('flags a follow save failure from the query string', async () => {
    renderToStaticMarkup(await Page({
      params: Promise.resolve({ id: 'ip-1' }),
      searchParams: Promise.resolve({ follow_error: '1' }),
    }));

    expect(mocks.ipDetail.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      followError: true,
      notificationError: false,
      notificationSaved: false,
    }));
  });

  it('renders notFound for an unknown ip id', async () => {
    mocks.identity = null;

    await expect(Page({
      params: Promise.resolve({ id: 'no-such-ip' }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow('not found');

    expect(mocks.ipDetail).not.toHaveBeenCalled();
  });

  it('redirects an old public alias to the current canonical slug while keeping the internal id', async () => {
    mocks.identity = { internalId: 'ip-1', publicSlug: 'mountain-fire', isAlias: true };

    await expect(Page({
      params: Promise.resolve({ id: 'hwasan' }),
      searchParams: Promise.resolve({ follow_error: '1', notification_saved: '1', unknown: 'drop-me' }),
    })).rejects.toThrow('NEXT_REDIRECT:/ip/mountain-fire?follow_error=1&notification_saved=1');
    expect(mocks.ipDetail).not.toHaveBeenCalled();
  });

  it('carries the goods collection filters and sort across the alias redirect', async () => {
    mocks.identity = { internalId: 'ip-1', publicSlug: 'mountain-fire', isAlias: true };

    await expect(Page({
      params: Promise.resolve({ id: 'hwasan' }),
      searchParams: Promise.resolve({ type: ['키링', '인형'], sort: 'price_asc', ip: 'other-ip' }),
    })).rejects.toThrow(`NEXT_REDIRECT:/ip/mountain-fire?type=${encodeURIComponent('키링')}&type=${encodeURIComponent('인형')}&sort=price_asc`);
  });

  /* 굿즈 영역은 IP로 좁힌 굿즈샵 컬렉션이다(11 IP-01) — 스코프가 이미 IP 하나라 ip 파라미터는 버린다. */
  it('computes the IP-scoped collection from the URL and passes the listing wish set', async () => {
    mocks.detail = {
      source: 'mock', ip, cards: [], events: [], posts: [],
      goods: [
        { id: 'g1', name: '화산 키링', ip: 'ip-1', type: '키링', price: 12000, badge: null, stock: 'ok', stockQty: 3, img: 'none' },
        { id: 'g2', name: '화산 인형', ip: 'ip-1', type: '인형', price: 30000, badge: null, stock: 'ok', stockQty: 3, img: 'none' },
      ],
    };
    renderToStaticMarkup(await Page({
      params: Promise.resolve({ id: 'ip-1' }),
      searchParams: Promise.resolve({ type: '인형', ip: 'ip-1', sort: 'price_desc' }),
    }));

    const props = mocks.ipDetail.mock.calls[0]?.[0] as { collection: { query: { ips: string[]; types: string[]; sort: string; view: string }; result: { goods: { id: string }[]; total: number } }; wishlist: unknown };
    expect(props.collection.query).toMatchObject({ ips: [], types: ['인형'], sort: 'price_desc', view: 'ip' });
    expect(props.collection.result.goods.map((good) => good.id)).toEqual(['g2']);
    expect(props.collection.result.total).toBe(2);
    expect(props.wishlist).toEqual({ viewerId: 'viewer-1', goodIds: ['g2'] });
  });
});
