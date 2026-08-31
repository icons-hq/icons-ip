import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignSummary } from '@/lib/campaigns';
import type { CampaignHubSnapshot } from '@/lib/campaigns.server';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  hub: { banners: [], campaigns: [] } as CampaignHubSnapshot,
  screen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/screens/CampaignHub', () => ({ CampaignHub: mocks.screen }));
vi.mock('@/lib/campaigns.server', () => ({ loadCampaignHub: async () => mocks.hub }));

const summer: CampaignSummary = {
  id: 'summer',
  kind: 'event',
  title: '여름 코인 이벤트',
  subtitle: null,
  cardImagePath: null,
  bannerImagePath: null,
  featuredOrder: 1,
  startsAt: '2026-08-06T15:00:00.000Z',
  endsAt: '2026-08-31T14:59:00.000Z',
  status: 'published',
  displayState: 'ongoing',
};

beforeEach(() => {
  mocks.screen.mockClear();
  mocks.hub = { banners: [summer], campaigns: [summer] };
});

describe('/events 캠페인 허브', () => {
  /* 공개 브라우징 — 로그인 상태를 묻지 않고 허브를 넘긴다. */
  it('로더가 낸 배너와 목록을 화면에 그대로 넘긴다', async () => {
    renderToStaticMarkup(await Page());

    expect(mocks.screen.mock.calls[0]?.[0]?.banners).toEqual([summer]);
    expect(mocks.screen.mock.calls[0]?.[0]?.campaigns).toEqual([summer]);
  });

  /* 로더는 mock 모드·조회 실패에서도 빈 허브를 낸다 — 라우트가 그 빈 값을 그대로 그려야
     비로그인 방문자에게 500 이 아니라 빈 상태가 보인다. */
  it('빈 허브도 그대로 화면에 넘긴다', async () => {
    mocks.hub = { banners: [], campaigns: [] };

    renderToStaticMarkup(await Page());

    expect(mocks.screen.mock.calls[0]?.[0]?.campaigns).toEqual([]);
  });

  it('허브 제목을 유지한다', () => {
    expect(metadata.title).toBe('이벤트 — ICONS');
  });
});
