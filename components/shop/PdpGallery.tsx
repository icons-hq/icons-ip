'use client';

import { useEffect, useRef, useState } from 'react';

export interface PdpGalleryProps {
  /** 대표 이미지가 0번. 값은 대표 이미지와 같은 CSS background 규약이다. */
  frames: string[];
  goodName: string;
  className?: string;
}

/*
 * 상품 갤러리 (R-04 §2 · DESIGN `pdp-gallery`).
 *
 * 스테이지는 native scroll-snap 이다 — 위치 계산·트랜스폼을 JS 로 옮기면
 * 터치 스와이프의 관성과 prefers-reduced-motion 을 두 곳에서 지켜야 한다.
 * JS 는 "지금 몇 번째가 보이는가"만 읽어 도트·썸네일 표시에 쓴다.
 *
 * 레퍼런스에는 활성 썸네일 마커가 없다(R-04 §10-2 결함). 8장짜리 갤러리에서
 * 지금 위치를 알 수 없으면 썸네일은 탐색 도구가 아니라 장식이 되므로 여기서는
 * 활성 썸네일을 표시한다.
 */

/** 스크롤 위치 → 활성 슬라이드. 아직 측정 전(폭 0)이면 첫 장이다. */
export function activeGalleryIndex(scrollLeft: number, slideWidth: number, count: number) {
  if (!(slideWidth > 0) || count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(scrollLeft / slideWidth)));
}

export function PdpGallery({ className, frames, goodName }: PdpGalleryProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const multiple = frames.length > 1;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !multiple) return;

    const measure = () => {
      const slide = stage.children[0] as HTMLElement | undefined;
      setActive(activeGalleryIndex(stage.scrollLeft, slide?.offsetWidth ?? 0, stage.children.length));
    };
    measure();

    /* 스크롤은 한 제스처에 수십 번 발화한다. rAF 로 프레임당 한 번만 다시 센다. */
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    const observer = new ResizeObserver(onScroll);
    observer.observe(stage);
    stage.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      stage.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [multiple]);

  const goTo = (index: number) => {
    const stage = stageRef.current;
    const slide = stage?.children[0] as HTMLElement | undefined;
    if (!stage || !slide) return;
    stage.scrollTo({
      left: slide.offsetWidth * index,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  return (
    <section
      aria-label={`${goodName} 이미지`}
      aria-roledescription="carousel"
      className={`wc-pdp-gallery${className ? ` ${className}` : ''}`}
    >
      <div ref={stageRef} className="wc-pdp-gallery__stage">
        {frames.map((frame, index) => (
          /* 아트웍에 옮길 텍스트가 없다 — 이름은 섹션 라벨이 갖는다. 배경 이미지라
             alt 를 붙일 자리도 없어 목록 항목의 위치만 보조기기에 남긴다. */
          <div
            key={`${frame}-${index}`}
            aria-label={`${index + 1}번째 이미지`}
            className="wc-pdp-gallery__slide"
            role="group"
            style={{ background: frame }}
          />
        ))}
      </div>
      {multiple ? (
        <>
          <div className="wc-pdp-gallery__dots">
            {frames.map((frame, index) => (
              <button
                key={`dot-${frame}-${index}`}
                aria-current={index === active ? 'true' : undefined}
                aria-label={`${index + 1}번째 이미지`}
                className={`wc-pdp-gallery__dot${index === active ? ' is-active' : ''}`}
                onClick={() => goTo(index)}
                type="button"
              />
            ))}
          </div>
          <div className="wc-pdp-gallery__thumbs">
            {frames.map((frame, index) => (
              <button
                key={`thumb-${frame}-${index}`}
                aria-current={index === active ? 'true' : undefined}
                aria-label={`${index + 1}번째 이미지 보기`}
                className={`wc-pdp-gallery__thumb${index === active ? ' is-active' : ''}`}
                onClick={() => goTo(index)}
                style={{ background: frame }}
                type="button"
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
