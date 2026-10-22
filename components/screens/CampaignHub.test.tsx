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
    endsAt: '2026-08-31T14:59:00.000Z',
    status: 'published',
    displayState: 'ongoing',
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
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-09-30T00:00:00.000Z',
});

const archived = campaign({ id: 'spring', title: '봄 이벤트', displayState: 'ended' });

/* RLS 상 운영자만 받는 행이다 — 화면은 role 을 보지 않고 받은 데이터를 그대로 그린다. */
const draft = campaign({ id: 'winter', title: '겨울 캠페인', status: 'draft' });

function tabLabels(html: string) {
  return [...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
}

/** 탭 패널 하나의 마크업. 패널은 서로 이어져 있어 다음 패널 시작 전까지를 자른다. */
function panelHtml(html: string, id: 'all' | 'event' | 'drop') {
  const start = html.indexOf(`id="campaign-panel-${id}"`);
  const bodyStart = html.indexOf('>', start) + 1;
  const next = html.indexOf('role="tabpanel"', bodyStart);
  return html.slice(bodyStart, next === -1 ? undefined : next);
}

function cardCount(html: string) {
  return html.match(/class="wc-campaign-card"/g)?.length ?? 0;
}

describe('CampaignHub', () => {
  it('카드가 상세로 가는 통짜 링크이고 제목·부제를 싣는다', () => {
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[summer]} />);

    expect(html).toContain('href="/events/summer"');
    expect(html).toContain('여름 코인 이벤트');
    expect(html).toContain('출석하고 카드팩 받기');
  });

  /* 레퍼런스에는 없던 두 요소다 — 없으면 진행중과 종료가 리스트 순서로만 구분된다
     (R-06 §1.4·§13-2, DESIGN §6 campaign-hub 가 보완을 요구사항으로 못 박음). */
  it('카드에 기간 라벨과 상태 뱃지를 함께 그린다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub banners={[]} campaigns={[summer, drop, archived]} />,
    );

    expect(html).toContain('2026.8.7 – 8.31');
    expect(html).toContain('진행중');
    expect(html).toContain('예정');
    expect(html).toContain('종료');
    expect(html).toContain('wc-campaign-state--ongoing');
    expect(html).toContain('wc-campaign-state--upcoming');
    expect(html).toContain('wc-campaign-state--ended');
  });

  /* draft 는 기간이 이미 시작해 있어도 아직 공개된 편성이 아니다 — '진행중'과 같은
     뱃지를 달면 운영자가 목록에서 공개 여부를 구분할 수 없다. */
  it('draft 캠페인은 진행중 대신 비공개 뱃지를 단다', () => {
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[draft]} />);

    expect(html).toContain('비공개');
    expect(html).toContain('wc-campaign-state--draft');
    expect(html).not.toContain('wc-campaign-state--ongoing');
    expect(html).not.toContain('>진행중<');
  });

  /* 배너는 운영자가 직접 매긴 편성이라 draft 도 실릴 수 있다. 카드를 비워 배너
     자리만 남기고 센다 — 탭은 ALL·EVENT 두 패널을 모두 그려 카드가 중복된다. */
  it('배너에 실린 draft도 같은 비공개 뱃지를 쓴다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub banners={[{ ...draft, featuredOrder: 1 }]} campaigns={[]} />,
    );

    expect(html).toContain('wc-campaign-banner');
    expect(html.match(/wc-campaign-state--draft/g)?.length).toBe(1);
    expect(html).toContain('비공개');
  });

  /* 유형은 색이 아니라 텍스트로 구분한다(R-06 §1.4 — EVENT·DROP 모두 검정 면). */
  it('유형 뱃지를 텍스트로 싣는다', () => {
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[summer, drop]} />);

    expect(html).toContain('>EVENT<');
    expect(html).toContain('>DROP<');
  });

  /* 레퍼런스 탭은 14/700 라벨뿐이다 — 건수를 붙이지 않는다(11 §8 EV-01). */
  it('ALL·EVENT·DROP 세 탭을 건수 없이 낸다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub banners={[]} campaigns={[summer, drop, archived]} />,
    );

    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(tabLabels(html)).toEqual(['ALL', 'EVENT', 'DROP']);
    expect(html).not.toMatch(/(?:ALL|EVENT|DROP) \(\d+\)/);
  });

  /* 레퍼런스 허브는 보이는 제목·부제 없이 배너로 시작한다(R-06 §1.1). 제목은 문서 구조와
     스크린리더 탐색을 위해 시각적으로만 숨긴 h1 으로 남긴다. */
  it('보이는 제목·부제 없이 시각적으로 숨긴 h1 만 남긴다', () => {
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[summer]} />);

    expect(html).toContain('<h1 class="wc-sr-only">이벤트</h1>');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain('wc-section-heading');
    expect(html).not.toContain('기간 한정 캠페인과 프로모션을 모았어요');
  });

  /* 카드 리워드 게이트가 꺼져 있어도 허브 자신의 문구가 '카드팩'을 말하던 누수(CH-11).
     운영자가 넣은 캠페인 문구는 데이터라 여기서 보지 않는다 — 허브가 직접 쓰는 문구만 본다. */
  it('허브 자체 문구에 카드팩 안내가 없다', () => {
    const plain = campaign({ id: 'plain', title: '가을 이벤트' });
    for (const html of [
      renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[]} />),
      renderToStaticMarkup(<CampaignHub banners={[{ ...plain, featuredOrder: 1 }]} campaigns={[plain]} />),
    ]) {
      expect(html).not.toContain('카드팩');
      expect(html).not.toContain('코인');
    }
  });

  /* 11 §6 B21 — ALL 은 최대 100건을 한 번에, EVENT·DROP 은 10건 + [더보기 (n/총)]. */
  it('ALL 은 최대 100건을 싣고 EVENT·DROP 은 10건과 더보기로 시작한다', () => {
    const events = Array.from({ length: 23 }, (_, index) => campaign({ id: `event-${index}`, kind: 'event' }));
    const drops = Array.from({ length: 90 }, (_, index) => campaign({ id: `drop-${index}`, kind: 'drop' }));
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[...events, ...drops]} />);

    expect(cardCount(panelHtml(html, 'all'))).toBe(100);
    expect(panelHtml(html, 'all')).not.toContain('wc-view-more');

    expect(cardCount(panelHtml(html, 'event'))).toBe(10);
    expect(panelHtml(html, 'event')).toContain('더보기 (10/23)');
    expect(panelHtml(html, 'event')).toContain('href="/events/event-9"');
    expect(panelHtml(html, 'event')).not.toContain('href="/events/event-10"');

    expect(cardCount(panelHtml(html, 'drop'))).toBe(10);
    expect(panelHtml(html, 'drop')).toContain('더보기 (10/90)');
  });

  it('10건 이하인 탭에는 더보기를 두지 않는다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub banners={[]} campaigns={[summer, drop, archived]} />,
    );

    expect(html).not.toContain('wc-view-more');
    expect(cardCount(panelHtml(html, 'event'))).toBe(2);
  });

  it('배너는 캠페인 상세로 가는 링크에 텍스트 레이어를 얹는다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub banners={[{ ...summer, featuredOrder: 1 }]} campaigns={[summer]} />,
    );

    expect(html).toContain('wc-campaign-banner');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html.match(/href="\/events\/summer"/g)?.length).toBeGreaterThan(1);
  });

  /* 배너가 둘 이상이면 자동 넘김이 돈다 — 멈출 수단과 현재 위치가 함께 있어야 한다(DESIGN §10). */
  it('배너가 여러 장이면 위치·정지 버튼·좌우 화살표를 함께 낸다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub
        banners={[{ ...summer, featuredOrder: 1 }, { ...drop, featuredOrder: 2 }]}
        campaigns={[summer, drop]}
      />,
    );

    expect(html).toContain('aria-roledescription="slide"');
    expect(html).toContain('aria-label="1 / 2"');
    expect(html).toContain('aria-label="자동 넘김 일시정지"');
    expect(html).not.toContain('aria-pressed');
    expect(html).toMatch(/<button[^>]*aria-label="이전 배너"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*aria-label="다음 배너"(?![^>]*disabled)/);
  });

  /* 모든 목록에 빈 상태가 있어야 한다(DESIGN §9·§12). */
  it('캠페인이 없으면 탭 대신 빈 상태와 다음 행동을 낸다', () => {
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[]} />);

    expect(html).toContain('진행 중인 캠페인이 없어요');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('role="tab"');
  });

  it('한 탭이 비어도 그 패널에 빈 상태를 그린다', () => {
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[summer]} />);

    expect(html).toContain('예정된 드랍이 없어요');
  });

  /* 사용자-facing 표면에서 '가챠·뽑기·충전' 금지(CONTEXT.md · DESIGN §12). */
  it('허브 카피에 금지 어휘가 없다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub banners={[{ ...summer, featuredOrder: 1 }]} campaigns={[summer, drop, archived]} />,
    );

    expect(html).not.toContain('가챠');
    expect(html).not.toContain('뽑기');
    expect(html).not.toContain('충전');
  });
});
