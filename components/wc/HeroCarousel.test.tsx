import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeHeroSlide } from '@/lib/home-catalog';
import {
  HERO_AUTOPLAY_MS,
  HeroCarousel,
  isHeroPlaying,
  nextHeroIndex,
  type HeroPlaybackState,
} from './HeroCarousel';

const slides: HomeHeroSlide[] = [
  {
    id: 'hero-1',
    title: '여름 드랍',
    subtitle: 'SUMMER DROP',
    imageUrl: 'https://cdn.example/hero-1.webp',
    mobileImageUrl: 'https://cdn.example/hero-1-mo.webp',
    href: '/events/summer',
  },
  {
    id: 'hero-2',
    title: '신규 카드팩',
    subtitle: null,
    imageUrl: 'https://cdn.example/hero-2.webp',
    mobileImageUrl: null,
    href: '/packs',
  },
];

const playable: HeroPlaybackState = {
  focusWithin: false,
  hidden: false,
  hovered: false,
  interacted: false,
  paused: false,
  reducedMotion: false,
  slideCount: 2,
};

describe('HeroCarousel markup', () => {
  it('announces itself as a labelled carousel', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={slides} />);

    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="대표 큐레이션"');
    expect(html).toContain('class="wc-hero"');
  });

  /* 첫 슬라이드만 활성이다. CSS 가 data-active 로 opacity 를 가르므로 이 속성이 곧 전환 상태다. */
  it('marks only the first slide active', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={slides} />);

    expect((html.match(/data-active="true"/g) ?? []).length).toBe(1);
    expect((html.match(/data-active="false"/g) ?? []).length).toBe(1);
  });

  /*
   * 비활성 슬라이드는 화면에서 사라져도 DOM 에 남는다. aria-hidden 과 tabIndex -1 을 같이
   * 걸지 않으면 스크린리더 순회와 탭 순서에 보이지 않는 링크가 슬라이드 수만큼 쌓인다.
   */
  it('keeps the inactive slides out of the reading and tab order', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={slides} />);

    const inactive = html.match(/<div\b[^>]*data-active="false"[^>]*>[\s\S]*?<\/picture>/)?.[0] ?? '';
    expect(inactive).toContain('aria-hidden="true"');
    expect(inactive).toContain('tabindex="-1"');

    const active = html.match(/<div\b[^>]*data-active="true"[^>]*>[\s\S]*?<\/picture>/)?.[0] ?? '';
    expect(active).not.toContain('aria-hidden');
    expect(active).not.toContain('tabindex');
  });

  /* PC/MO 별도 아트웍이 있을 때만 source 를 낸다 — 없으면 img 하나로 떨어져야 한다. */
  it('splits the artwork only when a mobile image exists', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={slides} />);

    expect((html.match(/<source\b/g) ?? []).length).toBe(1);
    expect(html).toContain('media="(max-width: 749px)"');
    expect(html).toContain('srcSet="https://cdn.example/hero-1-mo.webp"');
    expect(html).toContain('src="https://cdn.example/hero-2.webp"');
  });

  /* 카피는 이미지에 베이크된 것이 아니라 텍스트다 — 부제는 없을 수 있다. */
  it('renders the overlay copy and drops an empty subtitle', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={slides} />);

    expect(html).toContain('<strong class="wc-hero__title">여름 드랍</strong>');
    expect(html).toContain('<span class="wc-hero__subtitle">SUMMER DROP</span>');
    expect((html.match(/wc-hero__subtitle/g) ?? []).length).toBe(1);
  });

  /* 세그먼트는 점이 아니라 진행바지만, 이름 없이는 스크린리더에서 빈 버튼 더미가 된다. */
  it('names every progress segment and flags the current one', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={slides} />);

    expect(html).toContain('aria-label="1번 슬라이드: 여름 드랍"');
    expect(html).toContain('aria-label="2번 슬라이드: 신규 카드팩"');

    const active = html.match(/<button\b[^>]*aria-label="1번 슬라이드: 여름 드랍"[^>]*>/)?.[0] ?? '';
    const idle = html.match(/<button\b[^>]*aria-label="2번 슬라이드: 신규 카드팩"[^>]*>/)?.[0] ?? '';
    expect(active).toContain('aria-current="true"');
    expect(active).toContain('wc-hero__segment is-active');
    expect(idle).not.toContain('aria-current');
  });

  /* 자동으로 움직이는 콘텐츠에는 멈출 수단과 현재 위치가 있어야 한다(WCAG 2.2.2). */
  it('offers a pause toggle and a screen-reader position', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={slides} />);

    const pause = html.match(/<button\b[^>]*wc-hero__pause[^>]*>/)?.[0] ?? '';
    expect(pause).toContain('aria-label="자동재생 일시정지"');
    expect(pause).toContain('aria-pressed="false"');
    expect(html).toContain('<p aria-live="off" class="wc-sr-only">1 / 2</p>');
  });

  it('renders both arrows with distinct accessible names', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={slides} />);

    expect(html).toContain('aria-label="이전 슬라이드"');
    expect(html).toContain('aria-label="다음 슬라이드"');
    expect(html).toContain('wc-hero__arrow wc-hero__arrow--prev');
    expect(html).toContain('wc-hero__arrow wc-hero__arrow--next');
  });

  /* 1장짜리 히어로는 넘길 곳이 없다 — 컨트롤을 남기면 아무 일도 안 하는 버튼 4개가 생긴다. */
  it('drops every control for a single slide', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={[slides[0]]} />);

    expect(html).not.toContain('wc-hero__progress');
    expect(html).not.toContain('wc-hero__arrow');
    expect(html).not.toContain('wc-hero__pause');
    expect(html).not.toContain('aria-live');
    expect(html).toContain('data-active="true"');
  });

  it('appends an extra class without dropping the base class', () => {
    const html = renderToStaticMarkup(<HeroCarousel className="wc-hero--compact" slides={slides} />);

    expect(html).toContain('class="wc-hero wc-hero--compact"');
  });
});

describe('hero autoplay conditions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays only when nothing is blocking it', () => {
    expect(isHeroPlaying(playable)).toBe(true);
  });

  /*
   * 자동재생을 막는 이유는 여섯 가지고 전부 독립이다. 하나라도 빠지면 사용자가 읽는 중에
   * 슬라이드가 넘어가거나, 탭이 백그라운드로 내려간 뒤에도 타이머가 계속 돈다.
   */
  it.each([
    ['정지 버튼', { paused: true }],
    ['포인터 호버', { hovered: true }],
    ['내부 포커스', { focusWithin: true }],
    ['문서 비활성', { hidden: true }],
    ['모션 최소화 설정', { reducedMotion: true }],
    ['사용자 조작 이후', { interacted: true }],
  ] as const)('멈춘다: %s', (_label, blocker) => {
    expect(isHeroPlaying({ ...playable, ...blocker })).toBe(false);
  });

  it('never plays a single slide', () => {
    expect(isHeroPlaying({ ...playable, slideCount: 1 })).toBe(false);
    expect(isHeroPlaying({ ...playable, slideCount: 0 })).toBe(false);
  });

  it('wraps from the last slide back to the first', () => {
    expect(nextHeroIndex(0, 3)).toBe(1);
    expect(nextHeroIndex(2, 3)).toBe(0);
    /* 슬라이드가 사라진 순간에도 인덱스가 NaN 으로 새지 않아야 한다. */
    expect(nextHeroIndex(0, 0)).toBe(0);
  });

  /* 5초 간격과 루프 계산이 같이 맞아야 R-스펙의 autoplay 가 재현된다. */
  it('advances one slide per interval tick', () => {
    vi.useFakeTimers();
    let index = 0;
    const timer = setInterval(() => { index = nextHeroIndex(index, slides.length); }, HERO_AUTOPLAY_MS);

    vi.advanceTimersByTime(HERO_AUTOPLAY_MS - 1);
    expect(index).toBe(0);
    vi.advanceTimersByTime(1);
    expect(index).toBe(1);
    vi.advanceTimersByTime(HERO_AUTOPLAY_MS);
    expect(index).toBe(0);

    clearInterval(timer);
  });
});
