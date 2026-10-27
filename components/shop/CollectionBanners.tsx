'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  collectionBannerDisplayLimit, wrapCollectionBannerIndex, type CollectionBanner, type CollectionBannerSlot,
} from '@/lib/collection-banners';

/*
 * 컬렉션 머리 배너(11 CL-09 · LFS 패리티 2차 L8b). 수치는 LFS 2026-10-27 실측:
 * - 굿즈샵 전체(`all`): 1440×580 전폭(모바일 375×302), 아래 44(모바일 24). 여러 장이면 수동 슬라이더 —
 *   레퍼런스는 자동 넘김이 꺼져 있고(swiper autoplay.enabled=false) 처음과 끝이 이어진다(loop). 그래서 정지 버튼이 없다.
 *   데스크톱은 콘텐츠 왼쪽 선에 붙은 44×45 이전·다음 버튼(배너 아래 끝), 모바일은 스와이프 + 오른쪽 아래 'n / N'.
 * - BEST·NEW(`best`·`new`): 콘텐츠 폭 1180×260, 위아래 40(모바일은 전폭 375×175, 여백 없음). 운영 순서 첫 장 하나만 —
 *   슬라이더가 되지 않는다(레퍼런스 BEST도 한 장). 문구가 길면 배너가 문구만큼 길어진다(잘리지 않는다).
 * 문구는 이미지 위 텍스트 레이어다(이미지가 늦거나 실패해도 읽힌다). 이미지는 대체텍스트가 있을 때만 그림으로 읽히고,
 * 없으면 장식(alt="")이다. 첫 장 이미지는 LCP 후보라 eager + fetchpriority=high, 나머지 장은 lazy 다.
 * 카드 리워드·커뮤니티 목적지 게이트는 서버 로더(lib/collection-banners.server)가 이미 걸었다 — 여기서 다시 걸면
 * 첫 HTML(컨텍스트 초기값 꺼짐)에서 배너만 빠지고 머리말은 '배너 있음'으로 숨는다. 어드민 미리보기는 호출부가 건다.
 *
 * 트랙은 scroll-snap 이다 — 모바일 스와이프는 브라우저가 맡고, 스크립트는 현재 장을 스크롤 위치에서 읽고 버튼 때만 scrollTo 한다.
 */

const SLOT_LABELS: Record<CollectionBannerSlot, string> = {
  all: '굿즈샵 배너',
  best: 'BEST 배너',
  new: 'NEW 배너',
};

const CHEVRON_PREV = 'M6.5 1 1.5 6.5 6.5 12';
const CHEVRON_NEXT = 'M1.5 1 6.5 6.5 1.5 12';

function BannerSlide({ banner, first }: { banner: CollectionBanner; first: boolean }) {
  const content = <>
    <picture className="wc-collection-banner__media">
      {banner.mobileImageUrl ? <source media="(max-width: 749px)" srcSet={banner.mobileImageUrl} /> : null}
      <img
        alt={banner.imageAlt}
        decoding="async"
        fetchPriority={first ? 'high' : undefined}
        loading={first ? 'eager' : 'lazy'}
        sizes="100vw"
        src={banner.imageUrl}
      />
    </picture>
    {banner.imageDim !== 'none' ? <span aria-hidden className="wc-collection-banner__dim" data-tone={banner.imageDim} /> : null}
    <span className="wc-collection-banner__copy">
      <strong className="wc-collection-banner__title">{banner.title}</strong>
      {banner.subtitle ? <span className="wc-collection-banner__subtitle">{banner.subtitle}</span> : null}
    </span>
  </>;
  return banner.href
    ? <Link className="wc-collection-banner" data-text-color={banner.textColor} href={banner.href}>{content}</Link>
    : <div className="wc-collection-banner" data-text-color={banner.textColor}>{content}</div>;
}

/* 한 칸 이동 거리는 슬라이드 폭이 아니라 offsetLeft 차이다. 한 장이면 0이 나와 나눗셈이 깨지므로 1로 떨어뜨린다. */
function strideOf(track: HTMLElement) {
  const first = track.children[0] as HTMLElement | undefined;
  const second = track.children[1] as HTMLElement | undefined;
  if (!first || !second) return 1;
  return second.offsetLeft - first.offsetLeft || 1;
}

function BannerSlider({ banners, label }: { banners: CollectionBanner[]; label: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const count = banners.length;

  /* 현재 장은 스크롤 위치에서 읽는다 — 스와이프와 버튼이 같은 원천을 지난다. 스크롤은 한 제스처에 수십 번 오므로 rAF 로 묶는다. */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const measure = () => setCurrent(Math.max(0, Math.min(count - 1, Math.round(track.scrollLeft / strideOf(track)))));
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(track);
    track.addEventListener('scroll', schedule, { passive: true });
    return () => {
      observer.disconnect();
      track.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [count]);

  const activeIndex = current < count ? current : 0;
  const goTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({ left: strideOf(track) * wrapCollectionBannerIndex(index, count), behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <section aria-label={label} aria-roledescription="carousel" className="wc-collection-banners__carousel">
      <div className="wc-collection-banners__track" ref={trackRef}>
        {banners.map((banner, index) => (
          <div
            aria-label={`${index + 1} / ${count}`}
            aria-roledescription="slide"
            className="wc-collection-banners__slide"
            key={banner.id}
            role="group"
          >
            <BannerSlide banner={banner} first={index === 0} />
          </div>
        ))}
      </div>
      <div className="wc-collection-banners__controls">
        <button aria-label="이전 배너" className="wc-collection-banners__arrow" onClick={() => goTo(activeIndex - 1)} type="button">
          <svg aria-hidden fill="none" height="13" viewBox="0 0 8 13" width="8">
            <path d={CHEVRON_PREV} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
          </svg>
        </button>
        <button aria-label="다음 배너" className="wc-collection-banners__arrow" onClick={() => goTo(activeIndex + 1)} type="button">
          <svg aria-hidden fill="none" height="13" viewBox="0 0 8 13" width="8">
            <path d={CHEVRON_NEXT} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
          </svg>
        </button>
      </div>
      {/* 넘길 때마다 읽어 주면 방해가 된다 — 위치는 조회할 때만 닿도록 off 로 둔다. */}
      <p aria-live="off" className="wc-collection-banners__fraction">
        <span>{activeIndex + 1}</span> / <span>{count}</span>
      </p>
    </section>
  );
}

export interface CollectionBannersProps {
  banners: readonly CollectionBanner[];
  slot: CollectionBannerSlot;
}

/**
 * 배너가 없으면 아무것도 그리지 않는다 — 컬렉션은 지금처럼 텍스트 머리말로 시작한다(빈 띠 없음).
 * 받은 목록은 이미 게이트를 거친 그릴 배너다. 슬롯 몫(BEST·NEW 한 장)만은 여기서도 지켜 칸 배너가 슬라이더가 되지 않게 한다.
 */
export function CollectionBanners({ banners, slot }: CollectionBannersProps) {
  const visible = banners.filter((banner) => banner.slot === slot).slice(0, collectionBannerDisplayLimit(slot));
  if (!visible.length) return null;
  const variant = slot === 'all' ? 'wide' : 'contained';
  return (
    <div className={`wc-collection-banners wc-collection-banners--${variant}`} data-slot={slot}>
      {visible.length > 1
        ? <BannerSlider banners={visible} label={SLOT_LABELS[slot]} />
        : <section aria-label={SLOT_LABELS[slot]} className="wc-collection-banners__single"><BannerSlide banner={visible[0]} first /></section>}
    </div>
  );
}
