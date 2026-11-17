'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import type { HomeHeroSlide } from '@/lib/home-catalog';

export interface HeroCarouselProps {
  slides: HomeHeroSlide[];
  className?: string;
}

/** 전환 1s(CSS), 자동 넘김 5s. */
export const HERO_AUTOPLAY_MS = 5000;

export interface HeroPlaybackState {
  focusWithin: boolean;
  hidden: boolean;
  hovered: boolean;
  paused: boolean;
  reducedMotion: boolean;
  slideCount: number;
}

/*
 * 자동재생을 막을 이유는 다섯 가지고 전부 서로 독립이다. 조건을 effect 안에 흩어두면
 * 하나를 고칠 때 나머지가 조용히 빠지므로, "막을 이유가 하나도 없을 때만 돈다"를
 * 이 함수 한 곳에 모은다. DOM 없이도 검증 가능한 지점이기도 하다.
 * `paused` 는 정지 버튼으로만 바뀐다 — 정지 버튼의 aria-pressed·라벨이 실제 재생 상태와
 * 어긋나지 않고, 같은 버튼으로 재개할 수 있다. 화살표·진행 막대로 장을 옮기는 것은
 * 정지가 아니다(MD 요청: 메인 배너는 일정 시간 뒤 자동으로 넘어간다 — 직접 넘겨 본 뒤에도 계속).
 */
export function isHeroPlaying(state: HeroPlaybackState) {
  return (
    state.slideCount > 1
    && !state.paused
    && !state.hovered
    && !state.focusWithin
    && !state.hidden
    && !state.reducedMotion
  );
}

/** 마지막 장 다음은 첫 장이다 — 루프는 여기서만 계산한다. */
export function nextHeroIndex(current: number, slideCount: number) {
  return slideCount > 0 ? (current + 1) % slideCount : 0;
}

/** 어느 방향으로 옮기든 인덱스는 0..slideCount-1 안으로 감긴다. */
export function wrapHeroIndex(index: number, slideCount: number) {
  return slideCount > 0 ? ((index % slideCount) + slideCount) % slideCount : 0;
}

/*
 * 포커스가 히어로 안에 있다는 이유로 자동재생을 멈추는 것은 키보드 포커스일 때만이다. 마우스로 화살표를 누르면
 * 브라우저가 그 버튼에 포커스를 주지만(키보드 포커스 링이 뜨지 않는 :focus-visible 아님) 그것은 "읽는 중"이 아니라
 * 방금 누른 흔적이라, 이걸로 멈추면 직접 한 번 넘겨 본 배너가 다시 안 넘어간다. 판정을 못 하는 환경이면 멈추는 쪽이 안전하다.
 */
export function isHeroKeyboardFocus(target: { matches(selector: string): boolean } | null) {
  if (!target) return false;
  try {
    return target.matches(':focus-visible');
  } catch {
    return true;
  }
}

/* Figma 원본 화살표(refs/figma/assets/icon-arrow-prev·next.svg) 경로. 선은 currentColor, 색은 CSS(--wc-x-control). */
const ARROW_PREV = 'M19.5 10L12.5 16L19.5 22';
const ARROW_NEXT = 'M12 22L19 16L12 10';

/*
 * 전환은 전부 CSS(opacity)가 한다. JS 는 어느 인덱스가 활성인지만 바꾼다 —
 * 위치 계산·트랜스폼을 JS 로 옮기면 prefers-reduced-motion 을 두 곳에서 지켜야 한다.
 *
 * 비활성 슬라이드는 화면에서 사라져도 DOM 에 남아 있어, aria-hidden 과 tabIndex -1 을
 * 같이 걸지 않으면 스크린리더 순회와 탭 순서에 보이지 않는 링크가 슬라이드 수만큼 쌓인다.
 *
 * 구조(X SQUARE Figma Main Page): 안쪽 배치된 배너 상자(.wc-hero__viewport) 아래에 조작 줄(.wc-hero__nav)이 따로 선다 —
 * 진행 막대(전체 폭 중 현재 칸이 슬라이드 수만큼 나뉜 길이로 움직인다) + 일시정지·이전·다음.
 */
export function HeroCarousel({ className, slides }: HeroCarouselProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  /* 서버에는 document·matchMedia 가 없다. 첫 렌더는 둘 다 '재생 가능'으로 두고
     마운트 직후 effect 가 실제 값으로 덮어써 하이드레이션 불일치를 피한다. */
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const slideCount = slides.length;
  const hasControls = slideCount > 1;

  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const playing = isHeroPlaying({
    focusWithin,
    hidden,
    hovered,
    paused,
    reducedMotion,
    slideCount,
  });

  /* 인덱스가 목록 밖으로 나가면 어떤 슬라이드도 활성이 아닌 빈 히어로가 남는다. */
  const activeIndex = current < slideCount ? current : 0;

  /* 장이 바뀔 때마다(자동이든 직접이든) 5초를 처음부터 센다 — 직접 넘긴 장이 곧바로 다시 넘어가 버리지 않게. */
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(
      () => setCurrent(nextHeroIndex(activeIndex, slideCount)),
      HERO_AUTOPLAY_MS,
    );
    return () => clearTimeout(timer);
  }, [playing, slideCount, activeIndex]);

  /* 화살표·진행 막대로 장을 옮겨도 자동재생은 멈추지 않는다(paused 를 건드리지 않는다). 멈춤은 정지 버튼이 맡는다. */
  const goTo = (index: number) => setCurrent(wrapHeroIndex(index, slideCount));

  const onFocusCapture = (event: FocusEvent<HTMLElement>) => {
    if (isHeroKeyboardFocus(event.target)) setFocusWithin(true);
  };

  const onBlurCapture = (event: FocusEvent<HTMLElement>) => {
    // 포커스가 히어로 안에서 옮겨 다니는 동안에는 다시 재생하지 않는다.
    if (rootRef.current?.contains(event.relatedTarget)) return;
    setFocusWithin(false);
  };

  return (
    <section
      ref={rootRef}
      aria-label="대표 큐레이션"
      aria-roledescription="carousel"
      className={`wc-hero${className ? ` ${className}` : ''}`}
      onBlurCapture={onBlurCapture}
      onFocusCapture={onFocusCapture}
    >
      {/* 포인터 정지는 배너 이미지 위에서만이다 — 아래 조작 줄의 화살표를 누른 채 포인터가 그 위에 있어도 자동 넘김이 이어진다. */}
      <div
        className="wc-hero__viewport"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {slides.map((slide, index) => {
          const active = index === activeIndex;
          const content = <>
            <picture className="wc-hero__media">
              {slide.mobileImageUrl ? <source media="(max-width: 749px)" srcSet={slide.mobileImageUrl} /> : null}
              <img alt={slide.imageAlt ?? ''} src={slide.imageUrl} />
            </picture>
            {slide.imageDim === 'white' || slide.imageDim === 'black' ? <span aria-hidden className="wc-hero__dim" data-tone={slide.imageDim} /> : null}
            {!slide.imageDim && (slide.title || slide.subtitle) ? <span aria-hidden className="wc-hero__scrim" /> : null}
            {/* 화면 순서 = 작은 줄(부제) → 큰 줄(제목). 읽는 순서도 같다. */}
            {slide.title || slide.subtitle ? <>
            <span className="wc-hero__copy">
              {slide.subtitle ? <span className="wc-hero__subtitle">{slide.subtitle}</span> : null}
              {slide.title ? <strong className="wc-hero__title">{slide.title}</strong> : null}
            </span>
            </> : null}
          </>;
          return (
            <div
              key={slide.id}
              aria-hidden={active ? undefined : true}
              className="wc-hero__slide"
              data-active={active ? 'true' : 'false'}
              data-text-color={slide.textColor ?? 'white'}
            >
              {slide.href ? <Link aria-label={!slide.title && !slide.subtitle && !slide.imageAlt ? `프로모션 배너 ${index + 1} 보기` : undefined} className="wc-hero__link" href={slide.href} tabIndex={active ? undefined : -1}>{content}</Link>
                : <div className="wc-hero__link">{content}</div>}
            </div>
          );
        })}
      </div>
      {hasControls ? (
        <div className="wc-hero__nav">
          <div className="wc-hero__progress">
            <span aria-hidden className="wc-hero__track" />
            <span
              aria-hidden
              className="wc-hero__thumb"
              style={{ width: `${100 / slideCount}%`, transform: `translateX(${activeIndex * 100}%)` }}
            />
            {/* 장마다 투명 버튼이 막대 위에 겹친다 — 막대는 3px 이지만 히트는 44px 이다. */}
            <div className="wc-hero__segments">
              {slides.map((slide, index) => (
                <button
                  key={slide.id}
                  aria-current={index === activeIndex ? 'true' : undefined}
                  aria-label={`${index + 1}번 슬라이드: ${slide.title || '프로모션 배너'}`}
                  className={`wc-hero__segment${index === activeIndex ? ' is-active' : ''}`}
                  onClick={() => goTo(index)}
                  type="button"
                />
              ))}
            </div>
          </div>
          <div className="wc-hero__controls">
            {/* 자동으로 움직이는 콘텐츠에는 멈출 수단이 있어야 한다(WCAG 2.2.2). Figma 에는 없는 버튼이라 같은 회색 선 아이콘으로 맞춘다. */}
            <button
              aria-label={paused ? '자동재생 재생' : '자동재생 일시정지'}
              aria-pressed={paused}
              className="wc-hero__pause"
              onClick={() => setPaused((value) => !value)}
              type="button"
            >
              {paused ? (
                <svg aria-hidden fill="currentColor" height="14" viewBox="0 0 14 14" width="14">
                  <path d="M3.5 1.5 12 7 3.5 12.5Z" />
                </svg>
              ) : (
                <svg aria-hidden fill="currentColor" height="14" viewBox="0 0 14 14" width="14">
                  <path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" />
                </svg>
              )}
            </button>
            <button
              aria-label="이전 슬라이드"
              className="wc-hero__arrow wc-hero__arrow--prev"
              onClick={() => goTo(activeIndex - 1)}
              type="button"
            >
              <svg aria-hidden fill="none" height="32" viewBox="0 0 32 32" width="32">
                <path d={ARROW_PREV} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </button>
            <span aria-hidden className="wc-hero__divider" />
            <button
              aria-label="다음 슬라이드"
              className="wc-hero__arrow wc-hero__arrow--next"
              onClick={() => goTo(activeIndex + 1)}
              type="button"
            >
              <svg aria-hidden fill="none" height="32" viewBox="0 0 31 32" width="31">
                <path d={ARROW_NEXT} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </button>
          </div>
          {/* 자동 전환마다 읽어주면 방해가 된다 — 위치는 조회할 때만 닿도록 off 로 둔다. */}
          <p aria-live="off" className="wc-sr-only">{`${activeIndex + 1} / ${slideCount}`}</p>
        </div>
      ) : null}
    </section>
  );
}
