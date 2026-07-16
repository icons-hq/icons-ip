import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  snapshot: {
    source: 'supabase' as const,
    channels: [],
    goods: [],
    posts: [],
    trending: [],
  },
  getCommunitySnapshot: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: () => mocks.auth,
}));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: (profile: CurrentAuthState['profile']) => Boolean(profile?.onboarded_at),
}));
vi.mock('@/lib/community', async () => await import('../../lib/community'));
vi.mock('@/lib/community.server', () => ({
  getCommunitySnapshot: mocks.getCommunitySnapshot,
}));
vi.mock('@/components/screens/Community', () => ({
  Community: () => null,
}));

describe('community page feed scope', () => {
  beforeEach(() => {
    mocks.getCommunitySnapshot.mockReset();
    mocks.getCommunitySnapshot.mockResolvedValue(mocks.snapshot);
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
  });

  it('loads the explicit fandom feed and exposes the guest state to its screen', async () => {
    const element = await Page({ searchParams: Promise.resolve({ feed: 'fandom', ip: 'hwasan' }) });

    expect(mocks.getCommunitySnapshot).toHaveBeenCalledWith({
      viewerId: null,
      isStaff: false,
      feed: 'fandom',
    });
    expect(element.props).toEqual(expect.objectContaining({
      feedScope: 'fandom',
      viewerState: 'guest',
    }));
    expect(element.key).toBe('fandom');
  });

  it('normalizes repeated or unknown feed values to all and detects incomplete onboarding', async () => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'viewer-1', email: 'fan@icons.gg' },
      profile: null,
      isStaff: false,
    };

    const element = await Page({ searchParams: Promise.resolve({ feed: ['fandom', 'all'] }) });

    expect(mocks.getCommunitySnapshot).toHaveBeenCalledWith({
      viewerId: 'viewer-1',
      isStaff: false,
      feed: 'all',
    });
    expect(element.props).toEqual(expect.objectContaining({
      feedScope: 'all',
      viewerState: 'onboarding',
    }));
    expect(element.key).toBe('all');
  });

  it('marks a complete profile as onboarded', async () => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'viewer-1', email: 'fan@icons.gg' },
      profile: {
        email: 'fan@icons.gg',
        nickname: 'fan',
        birth_date: '2000-01-01',
        consents: { terms: true, privacy: true, marketing: false },
        onboarded_at: '2026-07-01T00:00:00.000Z',
      },
      isStaff: false,
    };

    const element = await Page({ searchParams: Promise.resolve({ feed: 'fandom' }) });

    expect(element.props.viewerState).toBe('onboarded');
  });
});
