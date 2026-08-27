'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import type { HomeHeroSlide } from '@/lib/home-catalog';

export interface HeroCarouselProps {
  slides: HomeHeroSlide[];
  className?: string;
}

/** R-스펙 02 §2 ① — 전환 1s(CSS), 자동 넘김 5s. */
export const HERO_AUTOPLAY_MS = 5000;

export interface HeroPlaybackState {
  focusWithin: boolean;
  hidden: boolean;
  hovered: boolean;
  interacted: boolean;
  paused: boolean;
  reducedMotion: boolean;
  slideCount: number;
}

/*
 * 자동재생을 막을 이유는 여섯 가지고 전부 서로 독립이다. 조건을 effect 안에 흩어두면
 * 하나를 고칠 때 나머지가 조용히 빠지므로, "막을 이유가 하나도 없을 때만 돈다"를
 * 이 함수 한 곳에 모은다. DOM 없이도 검증 가능한 지점이기도 하다.
 */
export function isHeroPlaying(state: HeroPlaybackState) {
  return (
    state.slideCount > 1
    && !state.paused
    && !state.hovered
    && !state.focusWithin
    && !state.hidden
    && !state.reducedMotion
    && !state.interacted
  );
}

/** 마지막 장 다음은 첫 장이다 — 루프는 여기서만 계산한다. */
export function nextHeroIndex(current: number, slideCount: number) {
  return slideCount > 0 ? (current + 1) % slideCount : 0;
}

const CHEVRON_PREV = 'M6.5 1 1.5 6.5 6.5 12';
const CHEVRON_NEXT = 'M1.5 1 6.5 6.5 1.5 12';

/*
 * 전환은 전부 CSS(opacity)가 한다. JS 는 어느 인덱스가 활성인지만 바꾼다 —
 * 위치 계산·트랜스폼을 JS 로 옮기면 prefers-reduced-motion 을 두 곳에서 지켜야 한다.
 *
 * 비활성 슬라이드는 화면에서 사라져도 DOM 에 남아 있어, aria-hidden 과 tabIndex -1 을
 * 같이 걸지 않으면 스크린리더 순회와 탭 순서에 보이지 않는 링크가 슬라이드 수만큼 쌓인다.
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
  const [interacted, setInteracted] = useState(false);

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
    interacted,
    paused,
    reducedMotion,
    slideCount,
  });

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setCurrent((index) => nextHeroIndex(index, slideCount)),
      HERO_AUTOPLAY_MS,
    );
    return () => clearInterval(timer);
  }, [playing, slideCount]);

  /* 인덱스가 목록 밖으로 나가면 어떤 슬라이드도 활성이 아닌 빈 히어로가 남는다. */
  const activeIndex = current < slideCount ? current : 0;

  const goTo = (index: number) => {
    setInteracted(true);
    setCurrent(((index % slideCount) + slideCount) % slideCount);
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
      onFocusCapture={() => setFocusWithin(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="wc-hero__viewport">
        {slides.map((slide, index) => {
          const active = index === activeIndex;
          return (
            <div
              key={slide.id}
              aria-hidden={active ? undefined : true}
              className="wc-hero__slide"
              data-active={active ? 'true' : 'false'}
            >
              <Link className="wc-hero__link" href={slide.href} tabIndex={active ? undefined : -1}>
                <picture className="wc-hero__media">
                  {slide.mobileImageUrl ? (
                    <source media="(max-width: 749px)" srcSet={slide.mobileImageUrl} />
                  ) : null}
                  <img alt="" src={slide.imageUrl} />
                </picture>
                <span aria-hidden className="wc-hero__scrim" />
                <span className="wc-hero__copy">
                  <strong className="wc-hero__title">{slide.title}</strong>
                  {slide.subtitle ? <span className="wc-hero__subtitle">{slide.subtitle}</span> : null}
                </span>
              </Link>
            </div>
          );
        })}
      </div>
      {hasControls ? (
        <>
          <div className="wc-hero__progress">
            {slides.map((slide, index) => (
              <button
                key={slide.id}
                aria-current={index === activeIndex ? 'true' : undefined}
                aria-label={`${index + 1}번 슬라이드: ${slide.title}`}
                className={`wc-hero__segment${index === activeIndex ? ' is-active' : ''}`}
                onClick={() => goTo(index)}
                type="button"
              />
            ))}
          </div>
          <button
            aria-label="이전 슬라이드"
            className="wc-hero__arrow wc-hero__arrow--prev"
            onClick={() => goTo(activeIndex - 1)}
            type="button"
          >
            <svg aria-hidden fill="none" height="39" viewBox="0 0 8 13" width="24">
              <path d={CHEVRON_PREV} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
            </svg>
          </button>
          <button
            aria-label="다음 슬라이드"
            className="wc-hero__arrow wc-hero__arrow--next"
            onClick={() => goTo(activeIndex + 1)}
            type="button"
          >
            <svg aria-hidden fill="none" height="39" viewBox="0 0 8 13" width="24">
              <path d={CHEVRON_NEXT} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
            </svg>
          </button>
          {/* 자동으로 움직이는 콘텐츠에는 멈출 수단이 있어야 한다(WCAG 2.2.2). */}
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
          {/* 자동 전환마다 읽어주면 방해가 된다 — 위치는 조회할 때만 닿도록 off 로 둔다. */}
          <p aria-live="off" className="wc-sr-only">{`${activeIndex + 1} / ${slideCount}`}</p>
        </>
      ) : null}
    </section>
  );
}
