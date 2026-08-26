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

export function Slider({ children, className, label, showControls = true }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const childCount = Children.count(children);
  /* SSR 에서는 DOM 을 잴 수 없어 자식 수로 시작하고, 마운트 뒤 실제 track 자식으로 맞춘다. */
  const [total, setTotal] = useState(childCount);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    setTotal(track.children.length);

    /* 스크롤은 한 제스처에 수십 번 발화한다. rAF 로 프레임당 한 번만 위치를 다시 센다. */
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setCurrent(Math.round(track.scrollLeft / strideOf(track)));
      });
    };

    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
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
