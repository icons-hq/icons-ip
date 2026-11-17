import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CampaignSummary } from '@/lib/campaigns';
import { CampaignHub } from './CampaignHub';

function campaign(overrides: Partial<CampaignSummary> & Pick<CampaignSummary, 'id'>): CampaignSummary {
  return {
    kind: 'event',
    title: `${overrides.id} 캠페인`,
    subtitle: null,
    cardImagePath: null,
    bannerImagePath: null,
    featuredOrder: null,
    startsAt: '2026-08-06T15:00:00.000Z',
    endsAt: '2099-08-31T14:59:00.000Z',
    status: 'published',
    displayState: 'ongoing',
    presentation: null,
    ...overrides,
  };
}

const summer = campaign({
  id: 'summer',
  title: '여름 코인 이벤트',
  subtitle: '출석하고 카드팩 받기',
  cardImagePath: 'https://cdn.test/summer.png',
});

const drop = campaign({
  id: 'ribbon',
  kind: 'drop',
  title: '리본 드랍',
  displayState: 'upcoming',
  startsAt: '2099-09-01T00:00:00.000Z',
  endsAt: '2099-09-30T00:00:00.000Z',
});

const archived = campaign({ id: 'spring', title: '봄 이벤트', displayState: 'ended' });

function cardCount(html: string) {
  return html.match(/class="wc-promo-card"/g)?.length ?? 0;
}

function cardTitles(html: string) {
  return [...html.matchAll(/<h3 class="wc-promo-card__title">([^<]*)<\/h3>/g)].map((match) => match[1]);
}

describe('CampaignHub — EVENT (Figma 2026-11-12)', () => {
  /* Figma: 스트립 배너 → "EVENT" 32 Bold → 카드 3열. 탭·기간 줄·상태 뱃지는 없다. */
  it('보이는 h1 "EVENT" 와 프로모션 카드 목록을 낸다', () => {
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[summer]} />);

    expect(html).toContain('<h1 class="wc-promo-page__title">EVENT</h1>');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain('wc-sr-only');
    expect(html).toContain('class="wc-promo-grid"');
    expect(cardCount(html)).toBe(1);
  });

  it('카드가 캠페인 랜딩으로 가는 통짜 링크이고 제목을 h3 로 싣는다', () => {
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[summer]} />);

    expect(html).toContain('<a class="wc-promo-card" href="/events/summer">');
    expect(cardTitles(html)).toEqual(['여름 코인 이벤트']);
    /* 카드 이미지는 CSS 배경이다. */
    expect(html).toContain('https://cdn.test/summer.png');
  });

  it('ALL·EVENT·DROP 탭과 기간 줄·상태 뱃지·유형 뱃지가 없다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub banners={[]} campaigns={[summer, drop, archived]} />,
    );

    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('wc-tabs');
    expect(html).not.toContain('wc-campaign-state');
    expect(html).not.toContain('wc-campaign-card');
    expect(html).not.toContain('>ALL<');
    expect(html).not.toContain('>DROP<');
    expect(html).not.toContain('2099.');
    expect(html).not.toContain('더보기');
  });

  /* "현재 마케팅 중인" 것만 — 종료와 초안, POP-UP 캠페인은 EVENT 에 싣지 않는다. */
  it('진행중·오픈 예정만 싣고 종료·초안·POP-UP 캠페인은 뺀다', () => {
    const draft = campaign({ id: 'winter', title: '겨울 캠페인', status: 'draft' });
    const popup = campaign({
      id: 'little-riize',
      title: '리틀 라이즈 팝업',
      presentation: { popupMode: 'offline', popupLocation: '서울 마포구', cardLinkPath: null },
    });
    const html = renderToStaticMarkup(
      <CampaignHub banners={[]} campaigns={[summer, drop, archived, draft, popup]} />,
    );

    expect(cardTitles(html)).toEqual(['여름 코인 이벤트', '리본 드랍']);
    expect(html).not.toContain('봄 이벤트');
    expect(html).not.toContain('겨울 캠페인');
    expect(html).not.toContain('리틀 라이즈 팝업');
  });

  it('진행중은 시작 최신순, 오픈 예정은 그 뒤에 이른순으로 낸다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub
        banners={[]}
        campaigns={[
          campaign({ id: 'up-late', title: '늦은 예정', displayState: 'upcoming', startsAt: '2099-10-01T00:00:00.000Z' }),
          campaign({ id: 'on-old', title: '옛 진행', startsAt: '2026-08-01T00:00:00.000Z' }),
          campaign({ id: 'up-soon', title: '빠른 예정', displayState: 'upcoming', startsAt: '2099-09-01T00:00:00.000Z' }),
          campaign({ id: 'on-new', title: '새 진행', startsAt: '2026-09-01T00:00:00.000Z' }),
        ]}
      />,
    );

    expect(cardTitles(html)).toEqual(['새 진행', '옛 진행', '빠른 예정', '늦은 예정']);
  });

  it('오픈 예정만 배지를 단다', () => {
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[summer, drop]} />);

    expect(html.match(/wc-promo-card__badge/g)).toHaveLength(1);
    expect(html).toContain('<span class="wc-promo-card__badge">오픈 예정</span>');
  });

  /* 마케팅 중인 제품·IP 로 바로 가는 링크 — 노출 설정의 바로가기가 캠페인 랜딩보다 우선이다. */
  it('노출 설정의 바로가기가 있으면 카드가 그곳으로 간다', () => {
    const promo = campaign({
      id: 'promo',
      title: '홍실 신상 기획',
      presentation: { popupMode: null, popupLocation: null, cardLinkPath: '/ip/hong-sil-quest' },
    });
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[promo]} />);

    expect(html).toContain('href="/ip/hong-sil-quest"');
    expect(html).not.toContain('href="/events/promo"');
  });

  it('카드 이미지는 카드 → 배너 이미지 순으로 고르고 없으면 배경 없이 회색 면이다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub
        banners={[]}
        campaigns={[
          campaign({ id: 'banner-only', bannerImagePath: 'https://cdn.test/banner-only.png' }),
          campaign({ id: 'bare' }),
        ]}
      />,
    );

    expect(html).toContain('https://cdn.test/banner-only.png');
    expect(html.match(/<div aria-hidden="true" class="wc-promo-card__art"><\/div>/g)).toHaveLength(1);
  });

  /* Figma 스트립 배너에는 글 레이어가 없다 — 이미지만이고, 링크의 접근 이름은 캠페인 제목(img alt)이다. */
  it('배너는 이미지만 싣고 캠페인 제목을 접근 이름으로 단다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub
        banners={[{ ...summer, bannerImagePath: 'https://cdn.test/summer-banner.png', featuredOrder: 1 }]}
        campaigns={[summer]}
      />,
    );

    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('class="wc-strip-banner"');
    expect(html).toContain('data-size="page"');
    expect(html).toContain('src="https://cdn.test/summer-banner.png"');
    expect(html).toContain('alt="여름 코인 이벤트"');
    expect(html).toContain('<a class="wc-strip-banner__link" href="/events/summer">');
    expect(html).not.toContain('wc-campaign-banner__body');
    expect(html).not.toContain('출석하고 카드팩 받기');
  });

  it('배너 이미지가 없으면 카드 이미지로 대신한다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub banners={[{ ...summer, featuredOrder: 1 }]} campaigns={[summer]} />,
    );

    expect(html).toContain('src="https://cdn.test/summer.png"');
  });

  it('바로가기가 있는 캠페인의 배너도 그곳으로 간다', () => {
    const promo = campaign({
      id: 'promo',
      bannerImagePath: 'https://cdn.test/promo.png',
      featuredOrder: 1,
      presentation: { popupMode: null, popupLocation: null, cardLinkPath: '/shop/g13' },
    });
    const html = renderToStaticMarkup(<CampaignHub banners={[promo]} campaigns={[promo]} />);

    expect(html).toContain('<a class="wc-strip-banner__link" href="/shop/g13">');
  });

  it('종료·POP-UP 캠페인과 이미지 없는 캠페인은 배너에 싣지 않는다', () => {
    const popup = campaign({
      id: 'pop',
      bannerImagePath: 'https://cdn.test/pop.png',
      featuredOrder: 1,
      presentation: { popupMode: 'online', popupLocation: null, cardLinkPath: null },
    });
    const ended = { ...archived, bannerImagePath: 'https://cdn.test/ended.png', featuredOrder: 2 };
    const blank = campaign({ id: 'blank', featuredOrder: 3 });
    const html = renderToStaticMarkup(
      <CampaignHub banners={[popup, ended, blank]} campaigns={[summer, popup, ended, blank]} />,
    );

    expect(html).not.toContain('wc-strip-banner');
    expect(html).not.toContain('aria-roledescription="carousel"');
  });

  /* 배너가 둘 이상이면 자동 넘김이 돈다 — 멈출 수단과 현재 위치가 함께 있어야 한다(DESIGN §10). */
  it('배너가 여러 장이면 위치·정지 버튼·좌우 화살표를 함께 낸다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub
        banners={[
          { ...summer, bannerImagePath: 'https://cdn.test/a.png', featuredOrder: 1 },
          { ...drop, bannerImagePath: 'https://cdn.test/b.png', featuredOrder: 2 },
        ]}
        campaigns={[summer, drop]}
      />,
    );

    expect(html).toContain('aria-roledescription="slide"');
    expect(html).toContain('aria-label="1 / 2"');
    expect(html).toContain('aria-label="자동 넘김 일시정지"');
    expect(html).not.toContain('aria-pressed');
    expect(html).toContain('<button aria-disabled="true" aria-label="이전 배너"');
    expect(html).toMatch(/<button aria-label="다음 배너" class="wc-campaign-banners__arrow/);
  });

  it('배너는 featured_order 순서로 낸다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub
        banners={[
          { ...drop, bannerImagePath: 'https://cdn.test/second.png', featuredOrder: 2 },
          { ...summer, bannerImagePath: 'https://cdn.test/first.png', featuredOrder: 1 },
        ]}
        campaigns={[summer, drop]}
      />,
    );

    expect(html.indexOf('https://cdn.test/first.png')).toBeLessThan(html.indexOf('https://cdn.test/second.png'));
  });

  /* 모든 목록에 빈 상태가 있어야 한다(DESIGN §9·§12) — 문구는 지금 그대로다. */
  it('캠페인이 없으면 빈 상태와 다음 행동을 낸다', () => {
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[]} />);

    expect(html).toContain('진행 중인 캠페인이 없어요');
    expect(html).toContain('새 캠페인이 열리면 이 자리에서 가장 먼저 알려 드릴게요.');
    expect(html).toContain('href="/"');
    expect(html).toContain('홈으로 가기');
    /* Figma 의 빈 상태에는 보이는 제목이 없다 — 문서 구조용 h1 만 시각 숨김으로 남는다. */
    expect(html).toContain('<h1 class="wc-sr-only">EVENT</h1>');
    expect(cardCount(html)).toBe(0);
  });

  it('종료·POP-UP 캠페인뿐이어도 빈 상태다', () => {
    const popup = campaign({
      id: 'pop',
      presentation: { popupMode: 'hybrid', popupLocation: null, cardLinkPath: null },
    });
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[archived, popup]} />);

    expect(html).toContain('진행 중인 캠페인이 없어요');
    expect(cardCount(html)).toBe(0);
  });

  /* 카드 리워드 게이트가 꺼져 있어도 허브 자신의 문구가 '카드팩'을 말하던 누수(CH-11). */
  it('허브 자체 문구에 카드팩·금지 어휘가 없다', () => {
    const plain = campaign({ id: 'plain', title: '가을 이벤트' });
    for (const html of [
      renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[]} />),
      renderToStaticMarkup(<CampaignHub banners={[{ ...plain, bannerImagePath: 'https://cdn.test/p.png', featuredOrder: 1 }]} campaigns={[plain, drop]} />),
    ]) {
      expect(html).not.toContain('카드팩');
      expect(html).not.toContain('코인');
      expect(html).not.toContain('가챠');
      expect(html).not.toContain('뽑기');
      expect(html).not.toContain('충전');
    }
  });
});
