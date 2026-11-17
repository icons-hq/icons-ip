import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PopupItem } from '@/lib/popups';
import { PopupHub } from './PopupHub';

function item(overrides: Partial<PopupItem> & Pick<PopupItem, 'id'>): PopupItem {
  return {
    key: `campaign:${overrides.id}`,
    source: 'campaign',
    title: `${overrides.id} 팝업`,
    href: `/popups/${overrides.id}`,
    imageBg: null,
    phase: 'ongoing',
    startsAtMs: 0,
    meta: '오프라인 · 서울 마포구 · 2026.11.1 – 11.30',
    ...overrides,
  };
}

function cardCount(html: string) {
  return html.match(/class="wc-promo-card"/g)?.length ?? 0;
}

describe('PopupHub — POP-UP (Figma 2026-11-12)', () => {
  /* Figma POP-UP 프레임 = 열려 있는 POP-UP 이 없을 때의 빈 상태 화면이다(스펙 D10). */
  it('항목이 없으면 Figma 빈 상태 문구 그대로 그린다', () => {
    const html = renderToStaticMarkup(<PopupHub items={[]} />);

    expect(html).toContain('진행 중인 POP-UP이 없어요');
    expect(html).toContain('새 POP-UP이 열리면 이 자리에서 가장 먼저 알려 드릴게요.');
    expect(html).toContain('홈으로 가기');
    expect(html).toContain('href="/"');
    expect(cardCount(html)).toBe(0);
    expect(html).not.toContain('wc-promo-grid');
  });

  /* 빈 상태에는 보이는 제목이 없다 — 문서 구조용 h1 만 시각 숨김으로 남는다. */
  it('빈 상태의 h1 은 시각만 숨긴다', () => {
    const html = renderToStaticMarkup(<PopupHub items={[]} />);

    expect(html).toContain('<h1 class="wc-sr-only">POP-UP</h1>');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it('항목이 있으면 보이는 h1 "POP-UP" 아래에 프로모션 카드를 낸다 — 스트립 배너·탭은 없다', () => {
    const html = renderToStaticMarkup(<PopupHub items={[item({ id: 'a' }), item({ id: 'b' })]} />);

    expect(html).toContain('<h1 class="wc-promo-page__title">POP-UP</h1>');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('class="wc-promo-grid"');
    expect(cardCount(html)).toBe(2);
    expect(html).not.toContain('wc-strip-banner');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('진행 중인 POP-UP이 없어요');
  });

  it('카드는 항목의 주소로 가는 통짜 링크이고 제목을 h3 로 싣는다', () => {
    const html = renderToStaticMarkup(
      <PopupHub
        items={[
          item({ id: 'campaign-one', title: '리틀 라이즈 팝업' }),
          item({ key: 'event:e1', id: 'e1', source: 'event', href: '/offline-popups/e1', title: '성수 팝업스토어' }),
        ]}
      />,
    );

    expect(html).toContain('<a class="wc-promo-card" href="/popups/campaign-one">');
    expect(html).toContain('<h3 class="wc-promo-card__title">리틀 라이즈 팝업</h3>');
    expect(html).toContain('<a class="wc-promo-card" href="/offline-popups/e1">');
    expect(html).toContain('<h3 class="wc-promo-card__title">성수 팝업스토어</h3>');
  });

  it('제목 아래에 방식 · 장소 · 기간 메타 한 줄을 싣는다', () => {
    const html = renderToStaticMarkup(
      <PopupHub items={[item({ id: 'a', meta: '온·오프라인 · 서울 마포구 월드컵로8길 69 · 2026.11.1 – 11.30' })]} />,
    );

    expect(html).toContain('<p class="wc-promo-card__meta">온·오프라인 · 서울 마포구 월드컵로8길 69 · 2026.11.1 – 11.30</p>');
  });

  it('오픈 예정만 배지를 단다', () => {
    const html = renderToStaticMarkup(
      <PopupHub items={[item({ id: 'live' }), item({ id: 'soon', phase: 'upcoming' })]} />,
    );

    expect(html.match(/wc-promo-card__badge/g)).toHaveLength(1);
    expect(html).toContain('<span class="wc-promo-card__badge">오픈 예정</span>');
  });

  it('카드 이미지는 CSS 배경이고 없으면 회색 면이다', () => {
    const html = renderToStaticMarkup(
      <PopupHub items={[item({ id: 'art', imageBg: 'url("https://cdn.test/a.png") center / cover no-repeat' }), item({ id: 'bare' })]} />,
    );

    expect(html).toContain('https://cdn.test/a.png');
    expect(html.match(/<div aria-hidden="true" class="wc-promo-card__art"><\/div>/g)).toHaveLength(1);
  });

  /* 첫 줄 3장은 첫 화면이다 — 이미지를 우선 내려받는다. 그 뒤는 그렇지 않다. */
  it('첫 3장의 배경 이미지만 preload 한다', () => {
    const items = Array.from({ length: 5 }, (_, index) => item({
      id: `p${index}`,
      imageBg: `url("https://cdn.test/${index}.png") center / cover no-repeat`,
    }));
    const html = renderToStaticMarkup(<PopupHub items={items} />);

    expect(html.match(/rel="preload"/g)).toHaveLength(3);
    expect(html).toContain('href="https://cdn.test/0.png" as="image"');
    expect(html).toContain('href="https://cdn.test/2.png" as="image"');
    expect(html).not.toContain('href="https://cdn.test/3.png" as="image"');
  });

  it('메타가 비면 메타 줄을 그리지 않는다', () => {
    const html = renderToStaticMarkup(<PopupHub items={[item({ id: 'a', meta: '' })]} />);

    expect(html).not.toContain('wc-promo-card__meta');
  });

  it('화면 문구에 금지 어휘가 없다', () => {
    for (const html of [
      renderToStaticMarkup(<PopupHub items={[]} />),
      renderToStaticMarkup(<PopupHub items={[item({ id: 'a' })]} />),
    ]) {
      expect(html).not.toContain('가챠');
      expect(html).not.toContain('뽑기');
      expect(html).not.toContain('충전');
    }
  });
});
