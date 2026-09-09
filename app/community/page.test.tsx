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
  canViewCommunity: true,
}));

vi.mock('@/lib/community-visibility.server', () => ({
  canViewCommunity: async () => mocks.canViewCommunity,
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: () => mocks.auth,
}));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: (profile: CurrentAuthState['profile']) => Boolean(profile?.onboarded_at),
}));
vi.mock('@/lib/community.server', () => ({
  getCommunitySnapshot: mocks.getCommunitySnapshot,
}));
vi.mock('@/components/screens/Community', () => ({
  Community: () => null,
}));

/* 게이트를 통과한 뒤의 피드 스코프 계약. 공개 스위치가 꺼진 동안에도 스태프 프리뷰가 이 경로를
   지나가므로, 게이트 mock 을 열어 두고 그대로 검증한다(lib/community-visibility.server.ts). */
describe('community page feed scope', () => {
  beforeEach(() => {
    mocks.getCommunitySnapshot.mockReset();
    mocks.getCommunitySnapshot.mockResolvedValue(mocks.snapshot);
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    mocks.canViewCommunity = true;
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

describe('커뮤니티 임시 비공개', () => {
  /* 게이트가 닫히면(비로그인·일반 회원) 라우트는 404다. 진입점을 지우는 것만으로는 직접 URL
     접근이 남으므로, 스냅샷 조회에 아예 닿지 않는지도 함께 잠근다. */
  it('게이트가 닫히면 라우트를 404로 닫고 스냅샷을 읽지 않는다', async () => {
    mocks.getCommunitySnapshot.mockReset();
    mocks.canViewCommunity = false;

    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
    expect(mocks.getCommunitySnapshot).not.toHaveBeenCalled();
  });
});
