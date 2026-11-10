'use client';

import { usePathname } from 'next/navigation';
import { EmptyState } from '@/components/wc/EmptyState';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import { CollectionBanners } from '@/components/shop/CollectionBanners';
import { CollectionBrowser } from '@/components/shop/CollectionBrowser';
import { shopQueryString } from '@/components/shop/collection-filters';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { WcButton } from '@/components/wc/WcButton';
import type { CollectionBanner, CollectionBannerSlot } from '@/lib/collection-banners';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import {
  SHOP_SORTS,
  SHOP_VIEW_SORTS,
  type ShopListQuery,
  type ShopListResult,
  type ShopView,
} from '@/lib/shop-catalog';

export {
  EMPTY_SHOP_FILTER_DRAFT,
  setDraftPriceRange,
  shopFilterDraftFromQuery,
  shopQueryString,
  toggleDraftValue,
  type ShopFilterDraft,
} from '@/components/shop/collection-filters';

/*
 * 굿즈샵·NEW·BEST·카테고리 전시 컬렉션 화면 (#326, R-03 §1, LFS 패리티 2차 L4).
 *
 * 본문(사이드바·수량·정렬 줄·그리드·VIEW MORE·모바일 시트)은 검색·IP관과 같은 CollectionBrowser 다.
 * 이 화면은 컬렉션 머리말과 스코프가 빈 경우의 안내, 그리고 URL 조립 규칙만 정한다.
 *
 * 머리말: 굿즈샵과 NEW 는 제목 없이 목록으로 바로 시작한다(R-03 §1.2 · CL-08 — h1 은 시각 숨김).
 * 컬렉션 배너(CL-09, L8b)는 굿즈샵 전체·BEST·NEW 머리에 선다(카테고리 전시·검색·IP관에는 없다). BEST 는 배너가 없을 때만
 * 텍스트 제목을 보인다 — 배너가 있으면 배너 문구가 머리말이고 h1 은 시각 숨김이다. 배너가 없으면 화면은 지금 그대로다.
 */

export interface ShopProps {
  view: ShopView;
  query: ShopListQuery;
  result: ShopListResult;
  title?: string;
  onQueryChange?: (query: ShopListQuery) => void;
  refreshScheduledContent?: boolean;
  /** A same-origin embedded preview owns its overlay document. */
  overlayContainer?: HTMLElement;
  paging?: { loading: boolean; error?: string; hasMore?: boolean; onLoadMore: () => void; onReload?: () => void };
  /** 목록 하트의 초기 상태(`lib/wishlist-ids.server`). 생략하면 하트를 그리지 않는다(어드민 미리보기). */
  wishlist?: ListingWishlist | null;
  /**
   * 이 컬렉션의 머리 배너(`lib/collection-banners.server`). 로더가 목적지 게이트·종료·페이지 몫을 이미 걸렀다 —
   * 그래서 배너 유무로 정하는 머리말(BEST 텍스트 제목)·상단 여백이 실제로 그려지는 배너와 같은 판정을 쓴다.
   * 비었거나 생략하면 배너 없이 그린다.
   */
  banners?: readonly CollectionBanner[];
}

/** 배너를 받는 컬렉션 — 굿즈샵 전체·BEST·NEW. 카테고리 전시(`?displayCategory=`)는 같은 화면을 쓰지만 배너가 없다. */
export function collectionBannerSlotFor(view: ShopView, query: Pick<ShopListQuery, 'displayCategory'>): CollectionBannerSlot | null {
  if (query.displayCategory) return null;
  return view === 'all' || view === 'best' || view === 'new' ? view : null;
}

const VIEW_HEADINGS: Record<ShopView, { title: string; subcopy?: string }> = {
  all: { title: '굿즈샵' },
  new: { title: 'NEW' },
  best: { title: 'BEST', subcopy: '지금 가장 사랑받는 굿즈예요.' },
  search: { title: '검색 결과' },
  ip: { title: '굿즈' },
};

export function Shop({ query, result, view, title, onQueryChange, paging, refreshScheduledContent = true, overlayContainer, wishlist, banners = [] }: ShopProps) {
  const pathname = usePathname();
  const heading = VIEW_HEADINGS[view];
  const bannerSlot = collectionBannerSlotFor(view, query);
  const slotBanners = bannerSlot ? banners.filter((banner) => banner.slot === bannerSlot) : [];
  const hasBanner = slotBanners.length > 0;
  const headingNode = title
    ? <SectionHeading as="h1" title={title} />
    : view === 'best' && !hasBanner
      ? <SectionHeading as="h1" subcopy={heading.subcopy} title={heading.title} />
      : <h1 className="wc-sr-only">{heading.title}</h1>;
  /* 굿즈샵 전체 배너는 전폭이라 컨테이너 밖, BEST·NEW 배너는 콘텐츠 폭이라 컨테이너 안 머리말 자리에 선다. */
  const wideBanner = bannerSlot === 'all' && hasBanner ? <CollectionBanners banners={slotBanners} slot="all" /> : null;
  const containedBanner = bannerSlot && bannerSlot !== 'all' && hasBanner ? <CollectionBanners banners={slotBanners} slot={bannerSlot} /> : null;
  /* 페이지 제목(h1)은 머리 배너보다 먼저 읽힌다 — 전폭 배너가 컨테이너 밖 맨 앞에 서도 시각 숨김 h1 을 그 앞에 둔다
     (BEST·NEW 와 같은 순서, l8b-qa-5). 보이는 제목(title)은 컨테이너 안 제자리에 둔다. */
  const headingBeforeWideBanner = Boolean(wideBanner) && !title;
  const leadHeading = headingBeforeWideBanner ? headingNode : null;
  const containerHeading = headingBeforeWideBanner ? null : headingNode;
  const rootClass = `wc-root wc-collection${hasBanner ? ' wc-collection--banner' : ''}`;

  /* 스코프가 통째로 비면 필터·정렬을 그릴 이유가 없다. 가짜 목록 대신 안내만 남긴다. */
  if (result.total === 0) {
    return (
      <div className={rootClass}>
        {leadHeading}
        {wideBanner}
        <div className="wc-container">
          {containerHeading}
          {containedBanner}
          <div className="wc-collection__empty">
            <EmptyState
              action={view === 'all' && !query.displayCategory ? undefined : (
                <WcButton href="/shop" variant="primary">굿즈샵 둘러보기</WcButton>
              )}
              title="아직 준비 중이에요"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      {refreshScheduledContent ? <GoodsSalePeriodRefresh goods={result.goods} /> : null}
      {leadHeading}
      {wideBanner}
      <div className="wc-container">
        {containerHeading}
        {containedBanner}
        <CollectionBrowser
          countNoun="굿즈"
          hrefFor={(next) => {
            const qs = shopQueryString(next);
            return qs ? `${pathname}?${qs}` : pathname;
          }}
          listSurface={view === 'best' ? 'best' : 'standard'}
          onQueryChange={onQueryChange}
          overlayContainer={overlayContainer}
          paging={paging}
          query={query}
          result={result}
          /* 카테고리 전시는 서버(RPC)가 20개씩 잘라 주므로 DB 화이트리스트(SHOP_SORTS — 컬렉션과 같은 7종)를 연다. */
          sorts={query.displayCategory ? SHOP_SORTS : SHOP_VIEW_SORTS[view]}
          wishlist={wishlist}
        />
      </div>
    </div>
  );
}
