'use client';

import { useState } from 'react';
import { useStorePresentation } from '@/components/shell/StorePresentationProvider';
import { ListingWishHeart } from '@/components/shop/ListingWishHeart';
import { ProductCard } from '@/components/wc/ProductCard';
import { ProductGrid } from '@/components/wc/ProductGrid';
import { ViewMore } from '@/components/wc/ViewMore';
import { goodDetailHref } from '@/lib/goods-display';
import { listingWishSet, type ListingWishlist } from '@/lib/listing-wishlist';
import { productCardChips } from '@/lib/product-card-chips';
import { SHOP_PAGE_SIZE, type ShopListResult } from '@/lib/shop-catalog';

export interface ListingGridProps {
  result: Pick<ShopListResult, 'goods' | 'filteredTotal' | 'ipFacets' | 'reviewSummaries'>;
  /** 이 값이 바뀌면(질의·기간·정렬이 바뀌면) 펼친 개수가 처음 20개로 돌아간다. 효과로 되돌리면 한 프레임 동안 옛 상태가 그려지므로 렌더 중에 판별한다. */
  resetKey: string;
  /** 목록 하트의 초기 상태. null·생략이면(어드민 미리보기·mock) 하트를 그리지 않는다. */
  wishlist?: ListingWishlist | null;
  listSurface?: 'standard' | 'best';
  /** 서버가 20개씩 이어 주는 목록(카테고리 전시). 없으면 받은 목록을 20개씩 펼친다. */
  paging?: { loading: boolean; error?: string; hasMore?: boolean; onLoadMore: () => void; onReload?: () => void };
  /** 접근 이름이 필요한 자리(여러 목록이 한 화면에 있을 때)에서만 준다. */
  label?: string;
}

/*
 * 목록 그리드 — 5열 상품 카드 + VIEW MORE (X SQUARE · 스펙 C §2.1, Figma). 열·간격은 `ProductGrid density="listing"`이 쥔다.
 * 카드 props 는 지금 `CollectionBrowser`(검색·IP관)의 카드와 같다 — 하트·별점·품절·판매 기간·19금 가림은 그대로이고,
 * 배지 대신 칩(`productCardChips`)을 가격 아래에 그린다. 스토어 표시 설정의 태그 끄기(showTags)는 칩 계산에 반영한다.
 */
export function ListingGrid({ label, listSurface = 'standard', paging, result, resetKey, wishlist }: ListingGridProps) {
  const { listing } = useStorePresentation();
  const [shown, setShown] = useState({ key: resetKey, count: SHOP_PAGE_SIZE });
  const visibleCount = shown.key === resetKey ? shown.count : SHOP_PAGE_SIZE;
  const wished = listingWishSet(wishlist);
  /* 카드 브랜드 줄은 IP 제목이다. IP facet 은 스코프의 모든 IP 를 담으므로 그 라벨을 쓴다. */
  const brandByIpId = new Map(result.ipFacets.map((facet) => [facet.value, facet.label]));
  const visibleGoods = paging ? result.goods : result.goods.slice(0, visibleCount);
  const hasMore = paging ? paging.hasMore ?? result.goods.length < result.filteredTotal : visibleCount < result.filteredTotal;

  return (
    <>
      <ProductGrid density="listing" label={label}>
        {visibleGoods.map((good) => (
          <li key={good.id}>
            <ProductCard
              action={wishlist && !good.masked ? (
                <ListingWishHeart goodId={good.id} initialWished={wished.has(good.id)} label={good.name} viewerId={wishlist.viewerId} />
              ) : undefined}
              brand={brandByIpId.get(good.ip)}
              cartGood={good}
              chips={productCardChips(good, { showTags: listing.showTags })}
              compareAtPrice={good.compareAtPrice}
              href={goodDetailHref(good.id)}
              imageBackground={good.img}
              listSurface={listSurface}
              listingAppearance={good.listingAppearance}
              masked={good.masked}
              name={good.name}
              price={good.price}
              priceMax={good.priceMax}
              reviewSummary={result.reviewSummaries?.[good.id]}
              salePeriod={good.salePeriod}
              showDiscountRate={good.showDiscountRate}
              soldOut={good.stock === 'soldout' || good.stockQty <= 0}
            />
          </li>
        ))}
      </ProductGrid>
      {paging?.error ? (
        <p className="wc-listing-grid__error" role="alert">
          {paging.error}
          {paging.onReload ? <button type="button" onClick={paging.onReload}>목록 새로 불러오기</button> : null}
        </p>
      ) : null}
      {hasMore ? (
        <ViewMore
          className="wc-listing-more"
          label="VIEW MORE"
          loading={paging?.loading}
          onClick={paging?.onLoadMore ?? (() => setShown({ key: resetKey, count: visibleCount + SHOP_PAGE_SIZE }))}
        />
      ) : null}
    </>
  );
}
