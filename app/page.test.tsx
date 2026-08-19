import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  cardRewardsEnabled: false,
  getFollowedIpIdsForUser: vi.fn(),
  getHomeSnapshot: vi.fn(),
  home: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  homePrototype: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/screens/Home', () => ({ Home: mocks.home }));
vi.mock('@/components/prototype/line-friends/LineFriendsHomePrototype', () => ({
  LineFriendsHomePrototype: mocks.homePrototype,
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: (profile: CurrentAuthState['profile']) => Boolean(profile?.onboarded_at),
}));
vi.mock('@/lib/ip-follow.server', () => ({
  getFollowedIpIdsForUser: mocks.getFollowedIpIdsForUser,
}));
vi.mock('@/lib/catalog', () => ({ getHomeSnapshot: mocks.getHomeSnapshot }));
vi.mock('@/lib/card-rewards/gate.server', () => ({
  readCardRewardsEnabled: () => mocks.cardRewardsEnabled,
}));

const home = {
  catalog: { source: 'supabase', verticals: [], ips: [], goods: [], cards: [], events: [] },
  curation: {
    hero: { id: 'hero-1', title: '운영 히어로', imageBg: 'hero-bg', href: '/events' },
    announcement: null,
    featuredIpIds: ['hwasan'],
  },
  postPreviewByIpId: {},
};

describe('home community personalization', () => {
  beforeEach(() => {
    delete process.env.ICONS_PROTOTYPE;
    delete process.env.VERCEL_ENV;
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    mocks.getHomeSnapshot.mockReset();
    mocks.getHomeSnapshot.mockResolvedValue(home);
    mocks.getFollowedIpIdsForUser.mockReset();
    mocks.getFollowedIpIdsForUser.mockResolvedValue(new Set(['hwasan']));
    mocks.home.mockClear();
    mocks.homePrototype.mockClear();
  });

  afterEach(() => {
    delete process.env.ICONS_PROTOTYPE;
    delete process.env.VERCEL_ENV;
  });

  it('keeps the public home order for guests without reading private follows', async () => {
    const element = await Page();

    expect(mocks.getHomeSnapshot).toHaveBeenCalledWith({ viewerId: null, isStaff: false });
    expect(mocks.getFollowedIpIdsForUser).not.toHaveBeenCalled();
    expect(element.props.followedIpIds).toEqual([]);
    expect(element.props.curation).toBe(home.curation);
    expect(element.props.cardRewardsEnabled).toBe(false);
  });

  it('prioritizes followed IPs only for an onboarded viewer', async () => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'viewer-1', email: 'fan@icons.gg' },
      profile: {
        email: 'fan@icons.gg',
        nickname: 'fan',
        birth_date: '2000-01-01',
        consents: { terms: true, privacy: true },
        onboarded_at: '2026-07-01T00:00:00.000Z',
      },
      isStaff: false,
    };

    const element = await Page();

    expect(mocks.getHomeSnapshot).toHaveBeenCalledWith({ viewerId: 'viewer-1', isStaff: false });
    expect(mocks.getFollowedIpIdsForUser).toHaveBeenCalledWith('viewer-1');
    expect(element.props.followedIpIds).toEqual(['hwasan']);
  });

  it('does not personalize the home for an incomplete account', async () => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'viewer-1', email: 'fan@icons.gg' },
      profile: null,
      isStaff: false,
    };

    const element = await Page();

    expect(mocks.getFollowedIpIdsForUser).not.toHaveBeenCalled();
    expect(element.props.followedIpIds).toEqual([]);
  });
});

describe('LINE FRIENDS storefront prototype routing', () => {
  beforeEach(() => {
    delete process.env.ICONS_PROTOTYPE;
    delete process.env.VERCEL_ENV;
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    mocks.getHomeSnapshot.mockReset();
    mocks.getHomeSnapshot.mockResolvedValue(home);
    mocks.getFollowedIpIdsForUser.mockReset();
    mocks.home.mockClear();
    mocks.homePrototype.mockClear();
  });

  afterEach(() => {
    delete process.env.ICONS_PROTOTYPE;
    delete process.env.VERCEL_ENV;
  });

  it('keeps the current home when the prototype flag is not configured', async () => {
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ variant: 'B' }) }),
    );

    expect(mocks.home).toHaveBeenCalledOnce();
    expect(mocks.homePrototype).not.toHaveBeenCalled();
    expect(html).not.toContain('/prototype/line-friends/');
  });

  it.each(['A', 'B', 'C'] as const)(
    'renders storefront prototype variant %s when enabled',
    async (variant) => {
      process.env.ICONS_PROTOTYPE = '1';

      const html = renderToStaticMarkup(
        await Page({ searchParams: Promise.resolve({ variant }) }),
      );

      expect(mocks.home).not.toHaveBeenCalled();
      expect(mocks.homePrototype.mock.calls[0]?.[0]).toEqual({
        catalog: home.catalog,
        curation: home.curation,
        followedIpIds: [],
        postPreviewByIpId: home.postPreviewByIpId,
        variant,
      });
      expect(html).toContain('/prototype/line-friends/chrome.css');
      expect(html).toContain('/prototype/line-friends/home.css');
    },
  );

  it.each([
    ['an invalid variant', { variant: 'unexpected' }],
    ['a missing variant', {}],
  ])('falls back to variant A for %s', async (_case, searchParams) => {
    process.env.ICONS_PROTOTYPE = '1';

    renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve(searchParams) }),
    );

    expect(mocks.homePrototype.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ variant: 'A' }),
    );
  });

  it('keeps the current home in Vercel production even when the prototype flag is set', async () => {
    process.env.ICONS_PROTOTYPE = '1';
    process.env.VERCEL_ENV = 'production';

    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ variant: 'C' }) }),
    );

    expect(mocks.home).toHaveBeenCalledOnce();
    expect(mocks.homePrototype).not.toHaveBeenCalled();
    expect(html).not.toContain('/prototype/line-friends/');
  });
});
