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

  /* 유형은 색이 아니라 텍스트로 구분한다(R-06 §1.4 — EVENT·DROP 모두 검정 면). */
  it('유형 뱃지를 텍스트로 싣는다', () => {
    const html = renderToStaticMarkup(<CampaignHub banners={[]} campaigns={[summer, drop]} />);

    expect(html).toContain('>EVENT<');
    expect(html).toContain('>DROP<');
  });

  it('ALL·EVENT·DROP 세 탭을 카운트와 함께 낸다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub banners={[]} campaigns={[summer, drop, archived]} />,
    );

    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toContain('ALL (3)');
    expect(html).toContain('EVENT (2)');
    expect(html).toContain('DROP (1)');
  });

  it('배너는 캠페인 상세로 가는 링크에 텍스트 레이어를 얹는다', () => {
    const html = renderToStaticMarkup(
      <CampaignHub banners={[{ ...summer, featuredOrder: 1 }]} campaigns={[summer]} />,
    );

    expect(html).toContain('wc-campaign-banner');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html.match(/href="\/events\/summer"/g)?.length).toBeGreaterThan(1);
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
