import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  cardRewardsEnabled: false,
  getHomeSnapshot: vi.fn(),
}));

vi.mock('@/components/screens/Home', () => ({ Home: () => null }));
vi.mock('@/lib/catalog', () => ({ getHomeSnapshot: mocks.getHomeSnapshot }));
vi.mock('@/lib/card-rewards/gate.server', () => ({
  readCardRewardsEnabled: () => mocks.cardRewardsEnabled,
}));

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
