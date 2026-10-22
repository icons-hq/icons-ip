'use client';

import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';

/* 이벤트 허브 상단 배너 슬라이더 (R-06 §1.2 · 11 §6 B21 · DESIGN §5·§10).
 *
 * 레퍼런스 동작: 5초마다 다음 장으로 넘어가고, 마지막 장에서 멈춘다(loop 없음).
 * 이 표면이 더하는 것은 정지 규율이다 — 홈 히어로(components/wc/HeroCarousel)와 같은
 * 조건으로 자동 넘김을 막는다: 포인터가 올라와 있거나, 안쪽에 포커스가 있거나,
 * 사용자가 직접 넘겼거나(스와이프·화살표), 문서가 가려졌거나, 모션 축소 설정이면 돌지 않는다.
 * 움직이는 콘텐츠에는 멈출 수단과 현재 위치가 있어야 한다(WCAG 2.2.2 · DESIGN §10).
 *
 * 트랙은 파운데이션의 scroll-snap 트랙(.wc-slider__track)이다 — 모바일 스와이프는 브라우저가
 * 맡고, 스크립트는 "몇 번째 장인지"를 스크롤 위치에서 읽어 오고 자동 넘김 때만 scrollTo 한다. */

/** 자동 넘김 간격 — 11 §6 B21(LFS 배너 autoplay 5000). */
export const CAMPAIGN_BANNER_AUTOPLAY_MS = 5000;

export interface CampaignBannerPlayback {
  current: number;
  focusWithin: boolean;
  hidden: boolean;
  hovered: boolean;
  paused: boolean;
  reducedMotion: boolean;
  slideCount: number;
}

/** 다음 장. 마지막 장 다음은 없다 — 레퍼런스 배너는 처음으로 되감지 않는다. */
export function nextCampaignBannerIndex(current: number, slideCount: number): number | null {
  return current + 1 < slideCount ? current + 1 : null;
}

/*
 * 자동 넘김을 막을 이유는 전부 서로 독립이다. 조건을 effect 안에 흩어 두면 하나를 고칠 때
 * 나머지가 조용히 빠지므로 "막을 이유가 하나도 없을 때만 돈다"를 이 함수 한 곳에 모은다.
 * 사용자 조작에 의한 정지는 paused 로 표현한다 — 정지 버튼의 라벨·aria-pressed 가 실제 재생
 * 상태와 어긋나지 않고, 같은 버튼으로 다시 재생할 수 있다(히어로와 같은 규율).
 */
export function isCampaignBannerPlaying(state: CampaignBannerPlayback): boolean {
  return (
    state.slideCount > 1
    && nextCampaignBannerIndex(state.current, state.slideCount) !== null
    && !state.paused
    && !state.hovered
    && !state.focusWithin
    && !state.hidden
    && !state.reducedMotion
  );
}

/*
 * 정지 버튼은 자동 넘김이 아직 남아 있을 때만 의미가 있다. 모션 축소 설정이면 처음부터
 * 움직이지 않고, 마지막 장에 닿았으면 더 넘어갈 곳이 없다 — 누를 일이 없는 버튼을 남기지 않는다.
 */
export function hasCampaignBannerAutoplayControl(
  state: Pick<CampaignBannerPlayback, 'current' | 'reducedMotion' | 'slideCount'>,
): boolean {
  return (
    state.slideCount > 1
    && !state.reducedMotion
    && nextCampaignBannerIndex(state.current, state.slideCount) !== null
  );
}

/* 한 칸 이동 거리는 슬라이드 폭이 아니라 offsetLeft 차이다(gap 포함).
   슬라이드가 하나뿐이면 0이 나와 나눗셈이 깨지므로 1로 떨어뜨린다. */
function strideOf(track: HTMLElement) {
  const first = track.children[0] as HTMLElement | undefined;
  const second = track.children[1] as HTMLElement | undefined;
  if (!first || !second) return 1;
  return second.offsetLeft - first.offsetLeft || 1;
}

function indexOf(track: HTMLElement, slideCount: number) {
  return Math.max(0, Math.min(slideCount - 1, Math.round(track.scrollLeft / strideOf(track))));
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* 스크립트가 일으킨 스크롤(자동 넘김·화살표)이 끝나기를 기다리는 최대 시간.
   부드러운 스크롤 한 칸은 이보다 짧다 — 그 사이 스와이프가 끼어들어 목표에 닿지 못해도
   이 시간이 지나면 다음 스크롤은 사용자 조작으로 읽는다. */
const PROGRAMMATIC_SCROLL_WINDOW_MS = 1500;

interface ProgrammaticScroll {
  left: number;
  until: number;
}

const CHEVRON_PREV = 'M6.5 1 1.5 6.5 6.5 12';
const CHEVRON_NEXT = 'M1.5 1 6.5 6.5 1.5 12';

export interface CampaignBannerSliderProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function CampaignBannerSlider({ children, className, label }: CampaignBannerSliderProps) {
  const rootRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const slides = Children.toArray(children);
  const slideCount = slides.length;
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  /* 서버에는 document·matchMedia 가 없다. 첫 렌더는 둘 다 '재생 가능'으로 두고
     마운트 직후 effect 가 실제 값으로 덮어써 하이드레이션 불일치를 피한다. */
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  /* 스크립트가 지금 굴리고 있는 스크롤. 이것이 없을 때 생긴 트랙 스크롤은 사용자의
     스와이프·가로 휠이다 — 그때 자동 넘김을 멈춘다. 세로로 페이지를 내리다 배너를 스친
     터치는 트랙을 가로로 움직이지 않으므로 조작으로 세지 않는다. */
  const programmatic = useRef<ProgrammaticScroll | null>(null);

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

  /* 현재 장은 스크롤 위치에서 읽는다 — 스와이프·화살표·자동 넘김이 모두 같은 원천을 지난다. */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => setCurrent(indexOf(track, slideCount));
    measure();

    /* 스크롤은 한 제스처에 수십 번 발화한다. rAF 로 프레임당 한 번만 다시 센다. */
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    const onScroll = () => {
      const pending = programmatic.current;
      if (pending && performance.now() <= pending.until) {
        if (Math.abs(track.scrollLeft - pending.left) < 2) programmatic.current = null;
      } else {
        programmatic.current = null;
        setPaused(true);
      }
      schedule();
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(track);
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      track.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [slideCount]);

  /* 스크립트가 트랙을 움직인다는 사실을 먼저 적어 두고 굴린다 — onScroll 이 이것을 보고
     사용자 조작과 구분한다. 이미 그 자리면 스크롤 이벤트가 오지 않으므로 적지 않는다. */
  const scrollTrackTo = (track: HTMLElement, index: number, behavior: ScrollBehavior) => {
    const left = strideOf(track) * index;
    if (Math.abs(track.scrollLeft - left) < 2) return;
    programmatic.current = { left, until: performance.now() + PROGRAMMATIC_SCROLL_WINDOW_MS };
    track.scrollTo({ left, behavior });
  };

  const playing = isCampaignBannerPlaying({
    current,
    focusWithin,
    hidden,
    hovered,
    paused,
    reducedMotion,
    slideCount,
  });

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      const track = trackRef.current;
      const next = nextCampaignBannerIndex(current, slideCount);
      if (!track || next === null) return;
      const left = strideOf(track) * next;
      programmatic.current = { left, until: performance.now() + PROGRAMMATIC_SCROLL_WINDOW_MS };
      track.scrollTo({ left, behavior: 'smooth' });
    }, CAMPAIGN_BANNER_AUTOPLAY_MS);
    return () => clearTimeout(timer);
  }, [current, playing, slideCount]);

  /* 장면을 직접 고르면 자동 넘김을 멈춘다 — 정지 버튼 상태로 멈추므로 라벨이 "재생"으로
     바뀌고, 원하면 같은 버튼으로 다시 돌릴 수 있다. */
  const goTo = (index: number) => {
    const track = trackRef.current;
    setPaused(true);
    if (!track) return;
    const target = Math.max(0, Math.min(slideCount - 1, index));
    scrollTrackTo(track, target, prefersReducedMotion() ? 'auto' : 'smooth');
  };

  const onBlurCapture = (event: FocusEvent<HTMLElement>) => {
    // 포커스가 배너 안에서 옮겨 다니는 동안에는 다시 돌리지 않는다.
    if (rootRef.current?.contains(event.relatedTarget)) return;
    setFocusWithin(false);
  };

  const hasControls = slideCount > 1;
  const activeIndex = current < slideCount ? current : 0;
  const showAutoplayControl = hasCampaignBannerAutoplayControl({ current: activeIndex, reducedMotion, slideCount });

  return (
    <section
      aria-label={label}
      aria-roledescription="carousel"
      className={`wc-campaign-banners${className ? ` ${className}` : ''}`}
      onBlurCapture={onBlurCapture}
      onFocusCapture={() => setFocusWithin(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      ref={rootRef}
    >
      <div className="wc-slider__track wc-campaign-banners__track" ref={trackRef}>
        {slides.map((slide, index) => (
          <div
            aria-label={`${index + 1} / ${slideCount}`}
            aria-roledescription="slide"
            className="wc-campaign-banners__slide"
            key={isValidElement(slide) && slide.key != null ? slide.key : index}
            role="group"
          >
            {slide}
          </div>
        ))}
      </div>
      {hasControls ? (
        <>
          <button
            aria-label="이전 배너"
            className="wc-campaign-banners__arrow wc-campaign-banners__arrow--prev"
            disabled={activeIndex <= 0}
            onClick={() => goTo(activeIndex - 1)}
            type="button"
          >
            <svg aria-hidden fill="none" height="13" viewBox="0 0 8 13" width="8">
              <path d={CHEVRON_PREV} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
            </svg>
          </button>
          <button
            aria-label="다음 배너"
            className="wc-campaign-banners__arrow wc-campaign-banners__arrow--next"
            disabled={activeIndex >= slideCount - 1}
            onClick={() => goTo(activeIndex + 1)}
            type="button"
          >
            <svg aria-hidden fill="none" height="13" viewBox="0 0 8 13" width="8">
              <path d={CHEVRON_NEXT} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
            </svg>
          </button>
          <div className="wc-campaign-banners__status">
            {/* 자동 넘김마다 읽어 주면 방해가 된다 — 위치는 조회할 때만 닿도록 off 로 둔다. */}
            <span aria-live="off" className="wc-campaign-banners__fraction">
              {`${activeIndex + 1} / ${slideCount}`}
            </span>
            {/* 라벨이 지금 누르면 일어날 일을 말한다(WAI-ARIA APG 캐러셀 회전 컨트롤) —
                라벨이 바뀌는 버튼에 aria-pressed 를 겹치면 "재생, 눌림"처럼 상태를 두 번 거꾸로 읽는다. */}
            {showAutoplayControl ? (
              <button
                aria-label={paused ? '자동 넘김 재생' : '자동 넘김 일시정지'}
                className="wc-campaign-banners__pause"
                onClick={() => setPaused((value) => !value)}
                type="button"
              >
                {paused ? (
                  <svg aria-hidden fill="currentColor" height="12" viewBox="0 0 14 14" width="12">
                    <path d="M3.5 1.5 12 7 3.5 12.5Z" />
                  </svg>
                ) : (
                  <svg aria-hidden fill="currentColor" height="12" viewBox="0 0 14 14" width="12">
                    <path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" />
                  </svg>
                )}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
