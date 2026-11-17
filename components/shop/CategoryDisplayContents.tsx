import { HeroCarousel } from '@/components/wc/HeroCarousel';
import { ProductCollection } from '@/components/home/ProductCollection';
import { GoodsVideoPlayer } from './GoodsVideoPlayer';
import type { ListingBannerContent } from './CollectionBanners';
import { imageBg } from '@/lib/media';
import type { CategoryDisplayPage } from '@/lib/category-display';

/** 전시 구성의 배너(`HomeHeroSlide`)를 목록 머리 스트립 배너가 그리는 값으로 맞춘다. 굿즈가 없는 전시는 배너도 그리지 않는다(빈 안내만 선다). */
export function categoryDisplayBanner(page: CategoryDisplayPage): ListingBannerContent | null {
  const banner = page.banner;
  if (!banner || page.result.total === 0) return null;
  return {
    id: banner.id,
    title: banner.title,
    subtitle: banner.subtitle,
    imageUrl: banner.imageUrl,
    mobileImageUrl: banner.mobileImageUrl,
    href: banner.href,
    imageAlt: banner.imageAlt ?? '',
    imageDim: banner.imageDim ?? 'none',
    textColor: banner.textColor ?? 'black',
  };
}

/** 전시 구성의 영상·추천 밴드 — 카테고리 화면에서 칩 영역과 제목 줄 사이에 선다(Figma에 없는 운영 선택 기능이라 켠 경우만 보인다). 배너는 목록 머리가 그린다. */
export function CategoryDisplayMedia({ page }: { page: CategoryDisplayPage }) {
  if (page.result.total === 0 || (!page.video && !page.recommendations)) return null;
  return <div className="wc-category-display">
    {page.video ? <section className="wc-category-display__video wc-container" aria-label="카테고리 동영상"><GoodsVideoPlayer asset={page.video.asset}
      fallbackBackground={page.video.poster ? imageBg(page.video.poster) : undefined} /><p>{page.video.asset.title}</p></section> : null}
    {page.recommendations ? <ProductCollection band={page.recommendations} /> : null}
  </div>;
}

/** 배너·영상·추천을 옛 모양(전폭 히어로 + 영상 + 추천) 그대로 그린다 — 어드민 카테고리 전시 미리보기가 쓴다(고객 화면은 `CategoryDisplayMedia` + 목록 머리 배너). */
export function CategoryDisplayContents({ page }: { page: CategoryDisplayPage }) {
  if (page.result.total === 0) return null;
  return <div className="wc-root wc-category-display">
    {page.banner ? <HeroCarousel slides={[page.banner]} className="wc-category-display__banner" /> : null}
    {page.video ? <section className="wc-category-display__video wc-container" aria-label="카테고리 동영상"><GoodsVideoPlayer asset={page.video.asset}
      fallbackBackground={page.video.poster ? imageBg(page.video.poster) : undefined} /><p>{page.video.asset.title}</p></section> : null}
    {page.recommendations ? <ProductCollection band={page.recommendations} /> : null}
  </div>;
}
