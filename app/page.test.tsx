import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  cardRewardsEnabled: false,
  getFollowedIpIdsForUser: vi.fn(),
  getHomeSnapshot: vi.fn(),
}));

vi.mock('@/components/screens/Home', () => ({ Home: () => null }));
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
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    mocks.getHomeSnapshot.mockReset();
    mocks.getHomeSnapshot.mockResolvedValue(home);
    mocks.getFollowedIpIdsForUser.mockReset();
    mocks.getFollowedIpIdsForUser.mockResolvedValue(new Set(['hwasan']));
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
