import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeHeroSlide } from '@/lib/home-catalog';
import {
  HERO_AUTOPLAY_MS,
  HeroCarousel,
  isHeroKeyboardFocus,
  isHeroPlaying,
  nextHeroIndex,
  wrapHeroIndex,
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
  paused: false,
  reducedMotion: false,
  slideCount: 2,
};

describe('HeroCarousel markup', () => {
  it('keeps the legacy gradient only when image dim is absent and supports image-only full dim', () => {
    expect(renderToStaticMarkup(<HeroCarousel slides={[slides[0]]} />)).toContain('wc-hero__scrim');
    const none = renderToStaticMarkup(<HeroCarousel slides={[{ ...slides[0], imageDim: 'none', textColor: 'black' }]} />);
    expect(none).not.toContain('wc-hero__scrim'); expect(none).not.toContain('wc-hero__dim'); expect(none).toContain('data-text-color="black"');
    for (const imageDim of ['white', 'black'] as const) {
      const html = renderToStaticMarkup(<HeroCarousel slides={[{ ...slides[0], title: '', subtitle: null, imageDim }]} />);
      expect(html).toContain('wc-hero__dim'); expect(html).toContain(`data-tone="${imageDim}"`);
      expect(html).not.toContain('wc-hero__scrim'); expect(html).not.toContain('wc-hero__copy');
    }
  });
  it('링크 없는 배너는 클릭·탭 대상이 없고 이미지 설명은 별도로 읽힌다', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={[{ ...slides[0], href: null, imageAlt: '이미지 속 문구' }]} />);
    expect(html).not.toMatch(/<a\b/);
    expect(html).not.toContain('tabindex');
    expect(html).toContain('alt="이미지 속 문구"');
    expect(html).toContain('여름 드랍');
  });

  it('이미지 전용 배너는 가짜 제목·그라데이션을 표시하지 않고 링크에 이름을 제공한다', () => {
    const blank = { ...slides[0], title: '', subtitle: null, imageAlt: '' };
    const html = renderToStaticMarkup(<HeroCarousel slides={[blank]} />);
    expect(html).not.toContain('wc-hero__copy');
    expect(html).not.toContain('wc-hero__scrim');
    expect(html).toContain('aria-label="프로모션 배너 1 보기"');
    const decorative = renderToStaticMarkup(<HeroCarousel slides={[{ ...blank, href: null }]} />);
    expect(decorative).toContain('alt=""');
    expect(decorative).not.toMatch(/<a\b/);
  });

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
    /* 화면(과 읽는) 순서는 작은 줄(부제) → 큰 줄(제목)이다. */
    expect(html.indexOf('wc-hero__subtitle')).toBeLessThan(html.indexOf('wc-hero__title'));
  });

  /* 장마다의 세그먼트 버튼은 보이지 않는 히트 영역이지만, 이름 없이는 스크린리더에서 빈 버튼 더미가 된다. */
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

  /* Figma 구조: 안쪽 배너 상자(viewport) 아래에 조작 줄이 따로 선다 — 진행 막대(트랙 + 현재 칸) 와 일시정지·이전·다음. */
  it('puts the nav row below the banner box with a track, a moving current slot and the controls', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={slides} />);

    expect(html.indexOf('wc-hero__viewport')).toBeLessThan(html.indexOf('wc-hero__nav'));
    expect(html.indexOf('</div></section>')).toBeGreaterThan(html.indexOf('wc-hero__nav'));
    const viewport = html.match(/<div class="wc-hero__viewport">[\s\S]*?<div class="wc-hero__nav">/)?.[0] ?? '';
    expect(viewport).not.toContain('wc-hero__progress');
    expect(viewport).not.toContain('wc-hero__arrow');
    expect(html).toContain('<span aria-hidden="true" class="wc-hero__track"></span>');
    /* 현재 칸 = 전체 폭의 1/장수, 자리는 칸 단위 translateX. */
    expect(html).toContain('class="wc-hero__thumb" style="width:50%;transform:translateX(0%)"');
    const threeSlides = renderToStaticMarkup(<HeroCarousel slides={[...slides, { ...slides[1], id: 'hero-3' }]} />);
    expect(threeSlides).toContain('style="width:33.333333333333336%;transform:translateX(0%)"');
    expect((threeSlides.match(/class="wc-hero__segment[ "]/g) ?? []).length).toBe(3);
    /* 조작부 순서: 일시정지 → 이전 → 구분선 → 다음. */
    const controls = html.match(/<div class="wc-hero__controls">[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(controls.indexOf('wc-hero__pause')).toBeLessThan(controls.indexOf('wc-hero__arrow--prev'));
    expect(controls.indexOf('wc-hero__arrow--prev')).toBeLessThan(controls.indexOf('wc-hero__divider'));
    expect(controls.indexOf('wc-hero__divider')).toBeLessThan(controls.indexOf('wc-hero__arrow--next'));
  });

  /* 화살표는 Figma 원본 선 아이콘(32×32, 선 2)이고 색은 CSS 다. */
  it('draws the Figma arrow paths with a currentColor stroke', () => {
    const html = renderToStaticMarkup(<HeroCarousel slides={slides} />);

    expect(html).toContain('d="M19.5 10L12.5 16L19.5 22"');
    expect(html).toContain('d="M12 22L19 16L12 10"');
    expect(html).toContain('viewBox="0 0 32 32"');
    expect(html).toContain('viewBox="0 0 31 32"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="2"');
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

    expect(html).not.toContain('wc-hero__nav');
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
   * 자동재생을 막는 이유는 다섯 가지고 전부 독립이다. 하나라도 빠지면 사용자가 읽는 중에
   * 슬라이드가 넘어가거나, 탭이 백그라운드로 내려간 뒤에도 타이머가 계속 돈다.
   * paused 는 정지 버튼으로만 바뀐다 — 화살표·진행 막대로 장을 옮기는 것은 정지가 아니다
   * (HeroCarousel.client.test.tsx 가 컴포넌트 상태로 이를 확인한다).
   */
  it.each([
    ['정지 버튼', { paused: true }],
    ['포인터 호버', { hovered: true }],
    ['내부 포커스', { focusWithin: true }],
    ['문서 비활성', { hidden: true }],
    ['모션 최소화 설정', { reducedMotion: true }],
  ] as const)('멈춘다: %s', (_label, blocker) => {
    expect(isHeroPlaying({ ...playable, ...blocker })).toBe(false);
  });

  it('never plays a single slide', () => {
    expect(isHeroPlaying({ ...playable, slideCount: 1 })).toBe(false);
    expect(isHeroPlaying({ ...playable, slideCount: 0 })).toBe(false);
  });

  it('wraps manual moves in both directions', () => {
    expect(wrapHeroIndex(-1, 3)).toBe(2);
    expect(wrapHeroIndex(3, 3)).toBe(0);
    expect(wrapHeroIndex(1, 3)).toBe(1);
    expect(wrapHeroIndex(0, 0)).toBe(0);
  });

  /* 마우스로 누른 버튼의 포커스(키보드 포커스 링이 없는 :focus-visible 아님)는 자동재생을 멈추지 않는다. */
  it('stops autoplay for keyboard focus only', () => {
    expect(isHeroKeyboardFocus({ matches: (selector) => selector === ':focus-visible' })).toBe(true);
    expect(isHeroKeyboardFocus({ matches: () => false })).toBe(false);
    expect(isHeroKeyboardFocus(null)).toBe(false);
    /* :focus-visible 를 모르는 환경은 멈추는 쪽이 안전하다. */
    expect(isHeroKeyboardFocus({ matches: () => { throw new SyntaxError('unsupported'); } })).toBe(true);
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
