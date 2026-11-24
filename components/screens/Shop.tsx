'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/wc/EmptyState';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import { CategoryChips } from '@/components/shop/CategoryChips';
import { CollectionBanners, ListingBanner, type ListingBannerContent } from '@/components/shop/CollectionBanners';
import { ListingGrid } from '@/components/shop/ListingGrid';
import { ListingHeader, type ListingHeaderTab } from '@/components/shop/ListingHeader';
import { WcButton } from '@/components/wc/WcButton';
import type { CategoryListingNav } from '@/lib/category-chips';
import type { CollectionBanner, CollectionBannerSlot } from '@/lib/collection-banners';
import { HOME_SALES_PERIOD_LABELS, HOME_SALES_PERIODS, type HomeSalesPeriod } from '@/lib/home-ranking';
import { LISTING_SORT_LABELS, LISTING_SORTS, NEW_SORT_TABS, SALES_RANKING_DEFAULT_PERIOD } from '@/lib/listing-sorts';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import {
  listingQueryString,
  type ShopListQuery,
  type ShopListResult,
  type ShopSort,
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
 * 굿즈샵 전체·NEW·BEST·카테고리 전시 목록 화면 (X SQUARE · 스펙 C §2.1~2.5, Figma New·Best·Category 프레임).
 *
 * 위에서 아래로: 스트립 배너(1272×340) → 카테고리 칩(카테고리 화면만) → 전시 영상·추천 밴드(전시 구성을 켠 경우만) →
 * 제목 줄(제목 + 탭 줄 + 정렬 셀렉트) → 5열 그리드 → VIEW MORE. 왼쪽 필터·수량 줄·필터 시트는 없다(D2) —
 * 검색 결과·IP관은 이 화면이 아니라 `CollectionBrowser` 를 그대로 쓴다.
 *
 * 탭 줄은 화면마다 다른 차원이다: NEW = 정렬 6종(그래서 셀렉트가 없다, D4), BEST = 기간(실시간·일간·주간·월간) + 정렬 셀렉트,
 * 카테고리 = 선택한 1단계의 하위 전시 + 정렬 셀렉트. 어드민 미리보기(`onQueryChange` 사용)는 같은 틀로 그리되 링크 대신 콜백으로 정렬을 바꾼다.
 * 필터 쿼리(`ip`·`type`·`min`·`max`·`category`)는 이 화면에서 읽지 않는다 — 호출부가 `parseListingSearchParams` 로 파싱한다.
 */

export interface ShopProps {
  view: ShopView;
  query: ShopListQuery;
  result: ShopListResult;
  /** 카테고리 칩 모델이 제목을 못 정할 때(어드민 미리보기·트리 밖 전시)의 제목. */
  title?: string;
  onQueryChange?: (query: ShopListQuery) => void;
  refreshScheduledContent?: boolean;
  /** 예전 필터 시트가 쓰던 포털 대상 — 필터 시트가 없어졌으므로 쓰이지 않는다. 어드민 미리보기 호출부 호환용으로만 받는다. */
  overlayContainer?: HTMLElement;
  paging?: { loading: boolean; error?: string; hasMore?: boolean; onLoadMore: () => void; onReload?: () => void };
  /** 목록 하트의 초기 상태(`lib/wishlist-ids.server`). 생략하면 하트를 그리지 않는다(어드민 미리보기). */
  wishlist?: ListingWishlist | null;
  /**
   * 이 컬렉션의 머리 배너(`lib/collection-banners.server`). 로더가 목적지 게이트·종료·페이지 몫을 이미 걸렀다.
   * 비었거나 생략하면 배너 없이 제목 줄로 시작한다.
   */
  banners?: readonly CollectionBanner[];
  /** BEST 의 선택된 기간 탭. 생략하면 실시간이다. */
  period?: HomeSalesPeriod;
  /** BEST 순위를 읽지 못했다 — 빈 기간과 다른 안내를 그린다. */
  rankingFailed?: boolean;
  /** 카테고리 화면의 칩·제목·하위 탭·부제. 생략하면 칩 영역 없이 제목(`title` 또는 화면 기본)만 그린다. */
  categoryNav?: CategoryListingNav | null;
  /** 카테고리 전시 구성의 배너(컬렉션 배너 슬롯이 없는 전시 화면용). */
  displayBanner?: ListingBannerContent | null;
  /** 칩 영역과 제목 줄 사이 — 카테고리 전시 구성의 영상·추천 밴드. */
  children?: ReactNode;
}

/** 배너를 받는 컬렉션 — 굿즈샵 전체·BEST·NEW. 카테고리 전시(`?displayCategory=`)는 같은 화면을 쓰지만 컬렉션 배너가 없다(전시 구성 배너를 쓴다). */
export function collectionBannerSlotFor(view: ShopView, query: Pick<ShopListQuery, 'displayCategory'>): CollectionBannerSlot | null {
  if (query.displayCategory) return null;
  return view === 'all' || view === 'best' || view === 'new' ? view : null;
}

const VIEW_TITLES: Record<ShopView, string> = {
  all: '전체 상품',
  new: 'NEW',
  best: 'BEST',
  search: '검색 결과',
  ip: '상품',
};

function withQuery(pathname: string, queryString: string) {
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function Shop({
  banners = [],
  categoryNav,
  children,
  displayBanner,
  onQueryChange,
  paging,
  period = SALES_RANKING_DEFAULT_PERIOD,
  query,
  rankingFailed = false,
  refreshScheduledContent = true,
  result,
  title,
  view,
  wishlist,
}: ShopProps) {
  const pathname = usePathname();
  const router = useRouter();
  const bannerSlot = collectionBannerSlotFor(view, query);
  const hasGoods = result.total > 0 && result.filteredTotal > 0;
  const headingTitle = categoryNav?.title ?? title ?? VIEW_TITLES[view];

  const navigateSort = (sort: ShopSort) => {
    if (sort === query.sort) return;
    const next = { ...query, sort };
    if (onQueryChange) { onQueryChange(next); return; }
    router.push(withQuery(pathname, listingQueryString(next, period)), { scroll: false });
  };

  /* 탭 줄: NEW 는 정렬, BEST 는 기간, 카테고리는 하위 전시. 빈 NEW 는 정렬을 고를 이유가 없어 탭을 두지 않는다(BEST 는 다른 기간으로 갈 길이라 남긴다). */
  let tabs: ListingHeaderTab[] = [];
  let tabsLabel = '하위 분류';
  if (view === 'new' && hasGoods) {
    tabsLabel = '정렬';
    tabs = NEW_SORT_TABS.map((sort) => ({
      key: sort,
      label: LISTING_SORT_LABELS[sort],
      href: withQuery(pathname, listingQueryString({ ...query, sort }, period)),
      selected: query.sort === sort,
    }));
  } else if (view === 'best') {
    tabsLabel = '기간';
    tabs = HOME_SALES_PERIODS.map((value) => ({
      key: value,
      label: HOME_SALES_PERIOD_LABELS[value],
      href: withQuery(pathname, listingQueryString(query, value)),
      selected: value === period,
    }));
  } else if (categoryNav) {
    tabs = categoryNav.tabs.map((tab) => ({ key: tab.id, label: tab.label, href: tab.href, selected: tab.selected }));
  }

  /* 배너가 없으면 빈 머리 컨테이너도 남기지 않는다 — CollectionBanners 는 비어도 요소이므로 슬롯 몫이 있는지 먼저 본다. */
  const hasSlotBanner = bannerSlot !== null && banners.some((candidate) => candidate.slot === bannerSlot);
  const banner = hasSlotBanner
    ? <CollectionBanners banners={banners} slot={bannerSlot} />
    : !bannerSlot && displayBanner
      ? <div className="wc-strip-banners" data-slot="category"><section aria-label="카테고리 배너" className="wc-strip-banners__single"><ListingBanner banner={displayBanner} /></section></div>
      : null;

  const chips = categoryNav ? <CategoryChips nav={categoryNav} /> : null;

  const body = hasGoods ? (
    <ListingGrid
      listSurface={view === 'best' ? 'best' : 'standard'}
      paging={paging}
      resetKey={`${view}|${listingQueryString(query, period)}`}
      result={result}
      wishlist={wishlist}
    />
  ) : (
    <div className="wc-listing__empty">
      {view === 'best' ? (
        rankingFailed
          ? <EmptyState description="잠시 후 다시 확인해주세요." title="순위를 불러오지 못했어요." />
          : <EmptyState description="다른 기간을 골라 보세요." title="이 기간에 집계된 상품이 없어요" />
      ) : (
        <EmptyState
          action={view === 'all' && !query.displayCategory ? undefined : (
            <WcButton href="/shop" variant="primary">상품 둘러보기</WcButton>
          )}
          title="아직 준비 중이에요"
        />
      )}
    </div>
  );

  return (
    <main className="wc-root wc-listing" data-lead={banner ? 'banner' : undefined}>
      {refreshScheduledContent ? <GoodsSalePeriodRefresh goods={result.goods} /> : null}
      {banner || chips ? (
        <div className="wc-container wc-container--wide">
          {banner}
          {chips}
        </div>
      ) : null}
      {/* 전시 구성의 영상·추천 밴드는 자기 컨테이너를 가진다 — 넓은 컨테이너 안에 넣으면 거터가 두 번 걸린다. */}
      {children}
      <div className="wc-container wc-container--wide">
        <ListingHeader
          sort={hasGoods && view !== 'new' ? { value: query.sort, options: LISTING_SORTS, onChange: navigateSort } : null}
          subtitle={categoryNav?.subtitle}
          tabs={tabs}
          tabsLabel={tabsLabel}
          title={headingTitle}
        />
        {body}
      </div>
    </main>
  );
}
