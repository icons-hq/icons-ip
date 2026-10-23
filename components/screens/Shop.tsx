'use client';

import { usePathname } from 'next/navigation';
import { EmptyState } from '@/components/wc/EmptyState';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import { CollectionBrowser } from '@/components/shop/CollectionBrowser';
import { shopQueryString } from '@/components/shop/collection-filters';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { WcButton } from '@/components/wc/WcButton';
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
 * BEST 는 컬렉션 배너(CL-09, L8b)가 오기 전까지 텍스트 제목을 둔다.
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
}

const VIEW_HEADINGS: Record<ShopView, { title: string; subcopy?: string }> = {
  all: { title: '굿즈샵' },
  new: { title: 'NEW' },
  best: { title: 'BEST', subcopy: '지금 가장 사랑받는 굿즈예요.' },
  search: { title: '검색 결과' },
  ip: { title: '굿즈' },
};

export function Shop({ query, result, view, title, onQueryChange, paging, refreshScheduledContent = true, overlayContainer, wishlist }: ShopProps) {
  const pathname = usePathname();
  const heading = VIEW_HEADINGS[view];
  const headingNode = title
    ? <SectionHeading as="h1" title={title} />
    : view === 'best'
      ? <SectionHeading as="h1" subcopy={heading.subcopy} title={heading.title} />
      : <h1 className="wc-sr-only">{heading.title}</h1>;

  /* 스코프가 통째로 비면 필터·정렬을 그릴 이유가 없다. 가짜 목록 대신 안내만 남긴다. */
  if (result.total === 0) {
    return (
      <div className="wc-root wc-collection">
        <div className="wc-container">
          {headingNode}
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
    <div className="wc-root wc-collection">
      {refreshScheduledContent ? <GoodsSalePeriodRefresh goods={result.goods} /> : null}
      <div className="wc-container">
        {headingNode}
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
          /* 카테고리 전시는 서버(RPC)가 20개씩 잘라 주므로 DB 가 받는 정렬 4종만 연다. */
          sorts={query.displayCategory ? SHOP_SORTS : SHOP_VIEW_SORTS[view]}
          wishlist={wishlist}
        />
      </div>
    </div>
  );
}
