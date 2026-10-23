import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  cardRewardsEnabled: false,
  getHomeSnapshot: vi.fn(),
  wishlist: { viewerId: 'viewer-1', goodIds: ['g1'] } as { viewerId: string | null; goodIds: string[] } | null,
}));

vi.mock('@/lib/goods-announcement-popup.server', () => ({ loadHomeAnnouncementPopup: async () => ({ item: null, nextChangeAt: null }) }));
vi.mock('@/components/screens/Home', () => ({ Home: () => null }));
vi.mock('@/lib/catalog', () => ({ getHomeSnapshot: mocks.getHomeSnapshot }));
vi.mock('@/lib/card-rewards/gate.server', () => ({
  readCardRewardsEnabled: () => mocks.cardRewardsEnabled,
}));
vi.mock('@/lib/wishlist-ids.server', () => ({ loadListingWishlist: async () => mocks.wishlist }));

const home = {
  catalog: { source: 'supabase', verticals: [], ips: [], goods: [], cards: [], events: [] },
  curation: {
    hero: null,
    announcement: null,
    featuredIpIds: [],
    heroSlides: [
      {
        id: 'hero-1',
        title: '여름 드랍',
        subtitle: null,
        imageUrl: 'https://cdn.example/hero-1.webp',
        mobileImageUrl: null,
        href: '/events/summer',
      },
    ],
    editorPicks: [],
    goodsBands: [],
    categoryBestTabs: [],
    popularTabs: [],
    benefitTiles: [],
  },
  postPreviewByIpId: {},
};

describe('home page assembly', () => {
  beforeEach(() => {
    mocks.cardRewardsEnabled = false;
    mocks.getHomeSnapshot.mockReset();
    mocks.getHomeSnapshot.mockResolvedValue(home);
  });

  /* 새 홈은 전부 공개 큐레이션이다 — 뷰어별 인자가 붙으면 캐시가 사람 수만큼 갈라진다. */
  it('loads the public home snapshot without any viewer argument', async () => {
    const element = await Page();

    expect(mocks.getHomeSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.getHomeSnapshot).toHaveBeenCalledWith();
    expect(element.props.curation).toBe(home.curation);
  });

  /* 목록 하트(11 CL-01·HM-03)의 초기 상태만 회원별이다 — 위시 ID 집합 하나를 따로 읽어 넘기고,
     큐레이션 스냅샷은 여전히 뷰어 인자 없이 공개 데이터만 읽는다. */
  it('passes the viewer wish set for the listing hearts while the snapshot stays viewer-agnostic', async () => {
    const element = await Page();

    expect(element.props.wishlist).toEqual({ viewerId: 'viewer-1', goodIds: ['g1'] });
    expect(mocks.getHomeSnapshot).toHaveBeenCalledWith();
  });

  it('passes the card rewards gate straight through to the screen', async () => {
    expect((await Page()).props.cardRewardsEnabled).toBe(false);

    mocks.cardRewardsEnabled = true;
    expect((await Page()).props.cardRewardsEnabled).toBe(true);
  });

  /*
   * 팔로우 개인화는 /about 으로 이사했다. 여기서 다시 import 하면 공개 홈이 인증 상태를
   * 읽기 시작하고, 그 순간 홈은 정적 공개 표면이 아니게 된다. 호출 0회로는 못 잡는다 —
   * import 자체가 없어야 한다.
   */
  it('does not even import the private follow reader', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('getFollowedIpIdsForUser');
    expect(source).not.toContain('ip-follow.server');
    expect(source).not.toContain('getCurrentAuthState');
  });
});
