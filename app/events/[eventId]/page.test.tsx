import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import type { CampaignLandingSnapshot } from '@/lib/campaigns.server';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { CoinOverview } from '@/lib/coins.server';
import type { FandomEvent } from '@/lib/data';
import Page, { generateMetadata } from './page';

/* 실제 notFound·permanentRedirect는 throw로 렌더를 끊는다. 대역이 그냥 반환하면
   미존재 id에서도 아래 리다이렉트까지 실행돼 계약이 거꾸로 통과한다 — 대역도 throw한다. */
const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  campaign: null as CampaignLandingSnapshot | null,
  catalog: null as CatalogSnapshot | null,
  coin: null as CoinOverview | null,
  screen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  permanentRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  permanentRedirect: mocks.permanentRedirect,
}));
vi.mock('@/components/screens/CampaignLanding', () => ({ CampaignLanding: mocks.screen }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/campaigns.server', () => ({
  loadCampaignDetail: async (id: string) => (mocks.campaign?.id === id ? mocks.campaign : null),
}));
vi.mock('@/lib/catalog', () => ({ getCatalogSnapshot: () => mocks.catalog }));
vi.mock('@/lib/coins.server', () => ({ loadCoinOverview: async () => mocks.coin }));

const event: FandomEvent = {
  id: 'e100',
  title: '테스트 팝업',
  ip: 'ip100',
  mode: '오프라인',
  status: '예매중',
  date: '7.25',
  loc: '성수',
  accent: '#38F0C0',
  img: 'linear-gradient(#111, #222)',
};

function snapshot(events: FandomEvent[]): CatalogSnapshot {
  return { source: 'mock', verticals: [], ips: [], goods: [], cards: [], events };
}

function campaignFor(id: string): CampaignLandingSnapshot {
  return {
    id,
    kind: 'event',
    title: '여름 코인 이벤트',
    subtitle: '출석하고 카드팩 받기',
    cardImagePath: null,
    bannerImagePath: null,
    heroImagePath: null,
    featuredOrder: null,
    startsAt: '2026-08-06T15:00:00.000Z',
    endsAt: '2026-08-31T14:59:00.000Z',
    status: 'published',
    displayState: 'ongoing',
    sections: [],
    resolvedSections: [{ type: 'attendance' }],
  };
}

function signedInAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: 'user-1', email: 'fan@icons.gg' },
    profile: null,
    isStaff: false,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
  mocks.campaign = null;
  mocks.catalog = snapshot([event]);
  mocks.coin = null;
  mocks.screen.mockClear();
  mocks.notFound.mockClear();
  mocks.permanentRedirect.mockClear();
});

describe('/events/[eventId] 캠페인 상세', () => {
  it('캠페인을 찾으면 상세 화면에 넘긴다', async () => {
    mocks.campaign = campaignFor('summer');

    renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: 'summer' }) }));

    expect(mocks.screen.mock.calls[0]?.[0]?.campaign).toEqual(mocks.campaign);
    expect(mocks.permanentRedirect).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  /* 공개 브라우징 — 비로그인도 본문을 그대로 읽는다. 로그인 여부는 참여 패널을
     로그인 CTA 로 바꾸는 데만 쓴다. */
  it('비로그인에게는 코인 상태 없이 signedIn=false로 넘긴다', async () => {
    mocks.campaign = campaignFor('summer');
    mocks.coin = { balance: 9, attendedToday: true };

    renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: 'summer' }) }));

    expect(mocks.screen.mock.calls[0]?.[0]?.signedIn).toBe(false);
    expect(mocks.screen.mock.calls[0]?.[0]?.coin).toBeNull();
  });

  it('로그인 상태면 잔액·출석 여부를 함께 넘긴다', async () => {
    mocks.campaign = campaignFor('summer');
    mocks.auth = signedInAuth();
    mocks.coin = { balance: 9, attendedToday: true };

    renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: 'summer' }) }));

    expect(mocks.screen.mock.calls[0]?.[0]?.signedIn).toBe(true);
    expect(mocks.screen.mock.calls[0]?.[0]?.coin).toEqual({ balance: 9, attendedToday: true });
  });

  /* 교환 폼의 멱등 키는 서버가 심는다 — 클라이언트가 만들면 재제출마다 새 키가 생겨
     같은 교환이 두 번 성립할 창이 열린다. */
  it('교환 폼용 멱등 키를 서버에서 만들어 넘긴다', async () => {
    mocks.campaign = campaignFor('summer');

    renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: 'summer' }) }));

    expect(String(mocks.screen.mock.calls[0]?.[0]?.operationId)).toMatch(UUID_PATTERN);
  });

  /* 조회 순서가 계약이다. 반대로 두면 슬러그가 겹친 캠페인이 영영 열리지 않는다. */
  it('같은 id가 캠페인과 오프라인 팝업 양쪽에 있으면 캠페인이 이긴다', async () => {
    mocks.campaign = campaignFor(event.id);

    renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: event.id }) }));

    expect(mocks.screen).toHaveBeenCalled();
    expect(mocks.permanentRedirect).not.toHaveBeenCalled();
  });

  it('캠페인마다 다른 페이지 제목을 낸다', async () => {
    mocks.campaign = campaignFor('summer');

    const meta = await generateMetadata({ params: Promise.resolve({ eventId: 'summer' }) });

    expect(meta.title).toBe('여름 코인 이벤트 — ICONS');
    expect(meta.description).toBe('출석하고 카드팩 받기');
  });

  it('캠페인이 아니면 허브 제목으로 답한다', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ eventId: event.id }) });

    expect(meta.title).toBe('이벤트 — ICONS');
  });
});

describe('/events/[eventId] 레거시 브리지', () => {
  it('저장된 오프라인 팝업 딥링크를 새 경로로 영구 이전한다', async () => {
    await expect(Page({ params: Promise.resolve({ eventId: event.id }) }))
      .rejects.toThrow(`NEXT_REDIRECT:/offline-popups/${event.id}`);

    expect(mocks.permanentRedirect).toHaveBeenCalledWith(`/offline-popups/${event.id}`);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('경로 세그먼트를 인코딩해 넘긴다', async () => {
    mocks.catalog = snapshot([{ ...event, id: 'e 100/x' }]);

    await expect(Page({ params: Promise.resolve({ eventId: 'e 100/x' }) }))
      .rejects.toThrow('NEXT_REDIRECT:/offline-popups/e%20100%2Fx');
  });

  it('카탈로그에 없는 id는 리다이렉트하지 않고 404로 끝낸다', async () => {
    await expect(Page({ params: Promise.resolve({ eventId: 'missing' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');

    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.permanentRedirect).not.toHaveBeenCalled();
  });
});
