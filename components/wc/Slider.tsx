'use client';

import { Children, useEffect, useRef, useState, type ReactNode } from 'react';

export interface SliderProps {
  label: string;
  children: ReactNode;
  showControls?: boolean;
  className?: string;
}

const CHEVRON_PREV = 'M6.5 1 1.5 6.5 6.5 12';
const CHEVRON_NEXT = 'M1.5 1 6.5 6.5 1.5 12';

/* 한 칸 이동 거리는 슬라이드 폭이 아니라 gap 을 포함한 offsetLeft 차이다.
   슬라이드가 하나뿐이면 0이 나와 나눗셈이 깨지므로 1로 떨어뜨린다. */
function strideOf(track: HTMLElement) {
  const first = track.children[0] as HTMLElement | undefined;
  const second = track.children[1] as HTMLElement | undefined;
  if (!first || !second) return 1;
  return second.offsetLeft - first.offsetLeft || 1;
}

/* 분수의 분모는 자식 수가 아니라 도달 가능한 스크롤 위치 수다. 한 화면에 여러 장이 보이면
   (예: 14장 중 3장 노출) 마지막 위치는 총 12번째라, 자식 수로 세면 분수가 끝까지 차지 않고
   다음 버튼도 영원히 활성으로 남는다. 최대 스크롤 거리를 한 칸 거리로 나눠 센다. */
function positionsOf(track: HTMLElement) {
  const maxScroll = track.scrollWidth - track.clientWidth;
  if (maxScroll <= 0) return 1;
  return Math.round(maxScroll / strideOf(track)) + 1;
}

export function Slider({ children, className, label, showControls = true }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const childCount = Children.count(children);
  /* SSR 에서는 DOM 을 잴 수 없어 자식 수를 근사값으로 쓰고, 마운트 뒤 실측으로 바꾼다. */
  const [total, setTotal] = useState(childCount);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const positions = positionsOf(track);
      setTotal(positions);
      setCurrent(Math.min(positions - 1, Math.round(track.scrollLeft / strideOf(track))));
    };
    measure();

    /* 스크롤은 한 제스처에 수십 번 발화한다. rAF 로 프레임당 한 번만 위치를 다시 센다. */
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    /* 뷰포트가 변하면 보이는 장수가 달라져 위치 수 자체가 바뀐다. */
    const observer = new ResizeObserver(onScroll);
    observer.observe(track);
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      track.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [childCount]);

  const goTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const target = Math.max(0, Math.min(total - 1, index));
    track.scrollTo({
      left: strideOf(track) * target,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  return (
    <section
      aria-label={label}
      aria-roledescription="carousel"
      className={`wc-slider${className ? ` ${className}` : ''}`}
    >
      <div className="wc-slider__track" ref={trackRef}>{children}</div>
      {showControls && total > 1 ? (
        <div className="wc-slider__controls">
          <button
            aria-label="이전"
            className="wc-slider__arrow"
            disabled={current <= 0}
            onClick={() => goTo(current - 1)}
            type="button"
          >
            <svg aria-hidden fill="none" height="13" viewBox="0 0 8 13" width="8">
              <path d={CHEVRON_PREV} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
            </svg>
          </button>
          <span className="wc-slider__fraction">{`${current + 1} / ${total}`}</span>
          <button
            aria-label="다음"
            className="wc-slider__arrow"
            disabled={current >= total - 1}
            onClick={() => goTo(current + 1)}
            type="button"
          >
            <svg aria-hidden fill="none" height="13" viewBox="0 0 8 13" width="8">
              <path d={CHEVRON_NEXT} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
      ) : null}
    </section>
  );
}
