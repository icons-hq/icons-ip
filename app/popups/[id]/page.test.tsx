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
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock('@/components/screens/CampaignLanding', () => ({ CampaignLanding: mocks.screen }));
vi.mock('@/lib/campaign-landing.server', () => ({ loadCampaignLandingProps: mocks.landingProps }));
vi.mock('@/lib/campaigns.server', () => ({
  loadCampaignDetail: async (id: string) => (mocks.campaign?.id === id ? mocks.campaign : null),
}));

function campaignWith(
  presentation: CampaignPresentation | null,
  id = 'little-riize',
  status: CampaignLandingSnapshot['status'] = 'published',
): CampaignLandingSnapshot {
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
    status,
    displayState: 'ongoing',
    presentation,
    sections: [],
    resolvedSections: [{ type: 'intro', copy: '소개' }],
  };
}

const params = (id: string, searchParams: Record<string, string | string[] | undefined> = {}) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(searchParams),
});

beforeEach(() => {
  mocks.campaign = null;
  mocks.screen.mockClear();
  mocks.landingProps.mockClear();
  mocks.notFound.mockClear();
  mocks.redirect.mockClear();
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

  /* 일반 EVENT 캠페인의 정본 주소는 /events/<id>다. POP-UP 기간에 공유된 /popups/<id> 링크가 EVENT 로 되돌린 뒤에도 열리도록
     게시된 캠페인은 404 대신 /events/<id>로 임시 이동한다. */
  it('게시된 캠페인이 POP-UP 이 아니면 /events/<id>로 임시 이동한다', async () => {
    mocks.campaign = campaignWith(null);
    await expect(Page(params('little-riize'))).rejects.toThrow('NEXT_REDIRECT:/events/little-riize');

    mocks.campaign = campaignWith({ popupMode: null, popupLocation: null, cardLinkPath: '/shop/g13' });
    await expect(Page(params('little-riize'))).rejects.toThrow('NEXT_REDIRECT:/events/little-riize');

    // 임시 이동이다: 영구 이동(permanentRedirect)이 아니라 redirect 를 쓴다.
    expect(mocks.redirect).toHaveBeenCalledTimes(2);
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.screen).not.toHaveBeenCalled();
    expect(mocks.landingProps).not.toHaveBeenCalled();
  });

  it('이동할 때 원 링크의 쿼리를 그대로 옮긴다(같은 키 여러 번 포함)', async () => {
    mocks.campaign = campaignWith(null);

    await expect(Page(params('little-riize', { utm_source: 'kakao', tag: ['a', 'b'], empty: undefined })))
      .rejects.toThrow('NEXT_REDIRECT:/events/little-riize?utm_source=kakao&tag=a&tag=b');
  });

  it('id 는 주소에 맞게 인코딩해 이동한다', async () => {
    mocks.campaign = campaignWith(null, 'little riize/2');

    await expect(Page(params('little riize/2'))).rejects.toThrow('NEXT_REDIRECT:/events/little%20riize%2F2');
  });

  it('종료(ended)로 표시된 공개 캠페인도 /events/<id>가 열 수 있으므로 이동한다', async () => {
    mocks.campaign = campaignWith(null, 'little-riize', 'ended');

    await expect(Page(params('little-riize'))).rejects.toThrow('NEXT_REDIRECT:/events/little-riize');
  });

  it('draft 캠페인(운영자 미리보기)은 POP-UP 이 아니면 이동하지 않고 404 다', async () => {
    mocks.campaign = campaignWith(null, 'little-riize', 'draft');
    await expect(Page(params('little-riize', { utm_source: 'x' }))).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.screen).not.toHaveBeenCalled();
  });

  it('draft 이지만 POP-UP 으로 설정된 캠페인은 운영자에게 랜딩을 그린다', async () => {
    mocks.campaign = campaignWith({ popupMode: 'online', popupLocation: null, cardLinkPath: null }, 'little-riize', 'draft');

    renderToStaticMarkup(await Page(params('little-riize')));

    expect(mocks.screen).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('없는 id 도 404 다', async () => {
    await expect(Page(params('missing'))).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('캠페인마다 다른 페이지 제목을 지금 패턴(— 엑스스퀘어)으로 낸다', async () => {
    mocks.campaign = campaignWith({ popupMode: 'hybrid', popupLocation: null, cardLinkPath: null });

    const meta = await generateMetadata(params('little-riize'));

    expect(meta.title).toBe('리틀 라이즈 팝업 — 엑스스퀘어');
    expect(meta.description).toBe('성수에서 만나요');
  });

  it('POP-UP 캠페인이 아니면 목록 제목으로 답한다', async () => {
    mocks.campaign = campaignWith(null);

    const meta = await generateMetadata(params('little-riize'));

    expect(meta.title).toBe('POP-UP — 엑스스퀘어');
  });
});
