import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogIpDetail, CatalogSnapshot } from '@/lib/catalog';
import type { CurrentAuthState } from '@/lib/auth/server';
import type { IpFollowState } from '@/lib/ip-follow';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  catalog: null as unknown as CatalogSnapshot,
  detail: null as unknown as CatalogIpDetail,
  followState: null as unknown as IpFollowState,
  ipHub: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found'); } }));
vi.mock('@/components/screens/IpHub', () => ({ IpHub: mocks.ipHub }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/catalog', () => ({
  getCatalogIpDetail: () => mocks.detail,
  getCatalogSnapshot: () => mocks.catalog,
}));
vi.mock('@/lib/ip-follow.server', () => ({ getIpFollowState: () => mocks.followState }));

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
  mocks.catalog = { source: 'mock', verticals: [], ips: [ip], goods: [], cards: [], events: [] };
  mocks.detail = { source: 'mock', ip, goods: [], cards: [], events: [], posts: [] };
  mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
  mocks.followState = { isFollowed: true, notifyDrops: true, notifyEvents: false };
  mocks.ipHub.mockClear();
});

describe('/ip/[id] page', () => {
  it('passes the loaded channel state and notification error flag to the hub', async () => {
    renderToStaticMarkup(await Page({
      params: Promise.resolve({ id: 'ip-1' }),
      searchParams: Promise.resolve({ notification_error: '1', notification_saved: '1' }),
    }));

    expect(mocks.ipHub.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      followState: mocks.followState,
      followError: false,
      notificationError: true,
      notificationSaved: true,
    }));
  });
});
