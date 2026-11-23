'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { StripBanner } from '@/components/wc/StripBanner';
import {
  collectionBannerDisplayLimit, wrapCollectionBannerIndex, type CollectionBanner, type CollectionBannerSlot,
} from '@/lib/collection-banners';

/*
 * 목록 머리 스트립 배너 (X SQUARE · 스펙 C §2.1, Figma New·Best·Category 프레임 — 콘텐츠 폭 1272×340, r12).
 * 컬렉션 배너 슬롯 셋(굿즈샵 전체 `all`·`best`·`new`)과 카테고리 전시 배너가 같은 모양이다:
 * - 한 장(`best`·`new`·전시 배너): 공용 `StripBanner size="page"` 위에 문구 레이어를 얹는다. BEST·NEW 는 운영 순서 첫 장 하나만이다.
 * - 여러 장(`all`, 최대 10장): 같은 크기의 수동 슬라이더 — 처음과 끝이 이어지고(loop) 자동 넘김이 없다(레퍼런스 swiper autoplay 꺼짐).
 *   데스크톱은 배너 안 오른쪽 아래 32px 이전·다음 버튼, 모바일은 스와이프 + 'n / N' 알약이다. 진행 막대는 두지 않는다.
 * 문구(title·subtitle)는 이미지 위 텍스트 레이어다 — 이미지가 늦거나 실패해도 읽힌다. 장식 레이어라 스크린리더에는 숨기고(aria-hidden),
 * 링크·그림의 접근 이름은 대체텍스트(없으면 제목)가 맡아 같은 문구가 두 번 읽히지 않는다.
 * 카드 리워드·커뮤니티 목적지 게이트는 서버 로더(lib/collection-banners.server)가 이미 걸었다 — 여기서 다시 걸지 않는다(l8b-ui-2).
 * 어드민 미리보기는 호출부가 건다.
 *
 * 슬라이더 트랙은 scroll-snap 이다 — 모바일 스와이프는 브라우저가 맡고, 스크립트는 현재 장을 스크롤 위치에서 읽고 버튼 때만 scrollTo 한다.
 * 스타일은 공용 `.wc-strip-banner`(wc-storefront-x.css)와 목록 전용 `.wc-listing-banner*`·`.wc-strip-banner-slider*`(wc-listing.css)다.
 */

const SLOT_LABELS: Record<CollectionBannerSlot, string> = {
  all: '굿즈샵 배너',
  best: 'BEST 배너',
  new: 'NEW 배너',
};

/** 컬렉션 배너 모바일 규격(375×175 — 어드민 업로드 안내와 같다). 모바일 이미지가 있을 때 로딩 전에도 자리를 잡는 비율이다. */
const MOBILE_IMAGE_SIZE = { width: 375, height: 175 };

/** 배너 한 장을 그리는 데 필요한 값 — 컬렉션 배너와 카테고리 전시 배너(`HomeHeroSlide`)가 같은 모양으로 맞춘다. */
export type ListingBannerContent = Pick<CollectionBanner, 'id' | 'title' | 'subtitle' | 'imageUrl' | 'mobileImageUrl' | 'href' | 'imageAlt' | 'imageDim' | 'textColor'>;

/**
 * 문구(title)와 부제가 모두 빈 배너는 문구가 그림 안에 든 배너라 글자 레이어를 그리지 않는다 — 같은 문구가 두 번 겹쳐 보이지 않는다.
 * 컬렉션 배너는 문구 없이 부제를 둘 수 없지만, 카테고리 전시 배너는 제목 없이 내용(부제)만 둘 수 있어 그때는 부제만 그린다.
 */
function BannerCopy({ banner }: { banner: ListingBannerContent }) {
  return (
    <>
      {banner.imageDim !== 'none' ? <span aria-hidden className="wc-listing-banner__dim" data-tone={banner.imageDim} /> : null}
      {banner.title || banner.subtitle ? (
        <span aria-hidden className="wc-listing-banner__copy">
          {banner.title ? <strong className="wc-listing-banner__title">{banner.title}</strong> : null}
          {banner.subtitle ? <span className="wc-listing-banner__subtitle">{banner.subtitle}</span> : null}
        </span>
      ) : null}
    </>
  );
}

/** 이미지 주소가 빈 배너는 어드민 미리보기의 업로드 전 초안뿐이다(공개 로더는 이미지 없는 행을 버린다) — 같은 크기의 회색 면만 남긴다. */
function BlankStrip() {
  return <div className="wc-strip-banner" data-size="page"><span className="wc-listing-banner__blank" /></div>;
}

/** 한 장짜리 스트립 배너. BEST·NEW·카테고리 전시가 쓴다. */
export function ListingBanner({ banner }: { banner: ListingBannerContent }) {
  return (
    <div className="wc-listing-banner" data-text-color={banner.textColor}>
      {banner.imageUrl ? (
        <StripBanner
          alt={banner.imageAlt || banner.title}
          href={banner.href}
          imageUrl={banner.imageUrl}
          mobileImageSize={banner.mobileImageUrl ? MOBILE_IMAGE_SIZE : null}
          mobileImageUrl={banner.mobileImageUrl}
          size="page"
        />
      ) : <BlankStrip />}
      <BannerCopy banner={banner} />
    </div>
  );
}

/** 슬라이드 한 장 — 첫 장 이미지는 LCP 후보라 eager + fetchpriority=high, 나머지 장은 lazy 다(공용 StripBanner 는 로딩 속성이 없어 슬라이더는 직접 그린다). */
function BannerSlide({ banner, first }: { banner: ListingBannerContent; first: boolean }) {
  const picture = banner.imageUrl ? (
    <picture>
      {banner.mobileImageUrl ? <source height={MOBILE_IMAGE_SIZE.height} media="(max-width: 749px)" srcSet={banner.mobileImageUrl} width={MOBILE_IMAGE_SIZE.width} /> : null}
      <img
        alt={banner.imageAlt || banner.title}
        className="wc-strip-banner__img"
        decoding="async"
        fetchPriority={first ? 'high' : undefined}
        loading={first ? 'eager' : 'lazy'}
        sizes="100vw"
        src={banner.imageUrl}
      />
    </picture>
  ) : null;
  return (
    <div className="wc-listing-banner" data-text-color={banner.textColor}>
      {picture ? (
        <div
          className="wc-strip-banner"
          data-mobile={banner.mobileImageUrl ? 'true' : undefined}
          data-size="page"
          style={banner.mobileImageUrl ? { '--wc-strip-mobile-ratio': `${MOBILE_IMAGE_SIZE.width} / ${MOBILE_IMAGE_SIZE.height}` } as CSSProperties : undefined}
        >
          {banner.href ? <Link className="wc-strip-banner__link" href={banner.href}>{picture}</Link> : picture}
        </div>
      ) : <BlankStrip />}
      <BannerCopy banner={banner} />
    </div>
  );
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
    <section aria-label={label} aria-roledescription="carousel" className="wc-strip-banner-slider">
      <div className="wc-strip-banner-slider__track" ref={trackRef}>
        {banners.map((banner, index) => (
          <div
            aria-label={`${index + 1} / ${count}`}
            aria-roledescription="slide"
            className="wc-strip-banner-slider__slide"
            key={banner.id}
            role="group"
          >
            <BannerSlide banner={banner} first={index === 0} />
          </div>
        ))}
      </div>
      <div className="wc-strip-banner-slider__controls">
        <button aria-label="이전 배너" className="wc-strip-banner-slider__arrow" onClick={() => goTo(activeIndex - 1)} type="button">
          <svg aria-hidden fill="none" height="32" viewBox="0 0 32 32" width="32">
            <path d="M19.5 10L12.5 16L19.5 22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
        </button>
        <button aria-label="다음 배너" className="wc-strip-banner-slider__arrow" onClick={() => goTo(activeIndex + 1)} type="button">
          <svg aria-hidden fill="none" height="32" viewBox="0 0 32 32" width="32">
            <path d="M12 22L19 16L12 10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
        </button>
      </div>
      {/* 넘길 때마다 읽어 주면 방해가 된다 — 위치는 조회할 때만 닿도록 off 로 둔다. */}
      <p aria-live="off" className="wc-strip-banner-slider__fraction">
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
 * 배너가 없으면 아무것도 그리지 않는다 — 컬렉션은 배너 없이 제목 줄로 시작한다(빈 띠·가짜 자리 없음).
 * 받은 목록은 이미 게이트를 거친 그릴 배너다. 슬롯 몫(BEST·NEW 한 장)만은 여기서도 지켜 칸 배너가 슬라이더가 되지 않게 한다.
 * 바깥 상자(`.wc-strip-banners`)는 콘텐츠 폭(1320 − 거터)을 스스로 잡는다 — 호출부가 넓은 컨테이너 안에 놓으면 그 폭을 그대로 따른다.
 */
export function CollectionBanners({ banners, slot }: CollectionBannersProps) {
  const visible = banners.filter((banner) => banner.slot === slot).slice(0, collectionBannerDisplayLimit(slot));
  if (!visible.length) return null;
  return (
    <div className="wc-strip-banners" data-slot={slot}>
      {visible.length > 1
        ? <BannerSlider banners={visible} label={SLOT_LABELS[slot]} />
        : <section aria-label={SLOT_LABELS[slot]} className="wc-strip-banners__single"><ListingBanner banner={visible[0]} /></section>}
    </div>
  );
}
