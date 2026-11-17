import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignLandingSnapshot } from '@/lib/campaigns.server';
import type { CampaignPresentation } from '@/lib/campaign-presentation';
import Page, { generateMetadata } from './page';

/* 실제 notFound 는 throw 로 렌더를 끊는다. 대역이 그냥 반환하면 아래 렌더까지 실행돼 계약이 거꾸로 통과한다 — 대역도 throw 한다. */
const mocks = vi.hoisted(() => ({
  campaign: null as CampaignLandingSnapshot | null,
  landingProps: vi.fn(async (campaign: CampaignLandingSnapshot) => ({ campaign, signedIn: false })),
  screen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/components/screens/CampaignLanding', () => ({ CampaignLanding: mocks.screen }));
vi.mock('@/lib/campaign-landing.server', () => ({ loadCampaignLandingProps: mocks.landingProps }));
vi.mock('@/lib/campaigns.server', () => ({
  loadCampaignDetail: async (id: string) => (mocks.campaign?.id === id ? mocks.campaign : null),
}));

function campaignWith(presentation: CampaignPresentation | null, id = 'little-riize'): CampaignLandingSnapshot {
  return {
    id,
    kind: 'event',
    title: '리틀 라이즈 팝업',
    subtitle: '성수에서 만나요',
    cardImagePath: null,
    bannerImagePath: null,
    heroImagePath: null,
    featuredOrder: null,
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2099-11-30T00:00:00.000Z',
    status: 'published',
    displayState: 'ongoing',
    presentation,
    sections: [],
    resolvedSections: [{ type: 'intro', copy: '소개' }],
  };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mocks.campaign = null;
  mocks.screen.mockClear();
  mocks.landingProps.mockClear();
  mocks.notFound.mockClear();
});

describe('/popups/[id] POP-UP 캠페인 상세', () => {
  it('POP-UP 캠페인이면 /popups 경로와 방식·장소를 랜딩에 넘긴다', async () => {
    mocks.campaign = campaignWith({ popupMode: 'offline', popupLocation: '서울 마포구 월드컵로8길 69', cardLinkPath: null });

    renderToStaticMarkup(await Page(params('little-riize')));

    const props = mocks.screen.mock.calls[0]?.[0];
    expect(props?.campaign).toEqual(mocks.campaign);
    expect(props?.basePath).toBe('/popups');
    expect(props?.venue).toEqual({ mode: 'offline', location: '서울 마포구 월드컵로8길 69' });
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('장소가 없는 온라인 POP-UP 은 location null 로 넘긴다', async () => {
    mocks.campaign = campaignWith({ popupMode: 'online', popupLocation: null, cardLinkPath: null });

    renderToStaticMarkup(await Page(params('little-riize')));

    expect(mocks.screen.mock.calls[0]?.[0]?.venue).toEqual({ mode: 'online', location: null });
  });

  /* 일반 EVENT 캠페인의 정본 주소는 /events/<id>다. */
  it('POP-UP 이 아닌 캠페인은 404 다', async () => {
    mocks.campaign = campaignWith(null);
    await expect(Page(params('little-riize'))).rejects.toThrow('NEXT_NOT_FOUND');

    mocks.campaign = campaignWith({ popupMode: null, popupLocation: null, cardLinkPath: '/shop/g13' });
    await expect(Page(params('little-riize'))).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mocks.screen).not.toHaveBeenCalled();
    expect(mocks.landingProps).not.toHaveBeenCalled();
  });

  it('없는 id 도 404 다', async () => {
    await expect(Page(params('missing'))).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mocks.notFound).toHaveBeenCalled();
  });

  it('캠페인마다 다른 페이지 제목을 지금 패턴(— ICONS)으로 낸다', async () => {
    mocks.campaign = campaignWith({ popupMode: 'hybrid', popupLocation: null, cardLinkPath: null });

    const meta = await generateMetadata(params('little-riize'));

    expect(meta.title).toBe('리틀 라이즈 팝업 — ICONS');
    expect(meta.description).toBe('성수에서 만나요');
  });

  it('POP-UP 캠페인이 아니면 목록 제목으로 답한다', async () => {
    mocks.campaign = campaignWith(null);

    const meta = await generateMetadata(params('little-riize'));

    expect(meta.title).toBe('POP-UP — ICONS');
  });
});
