import type { Metadata } from 'next';
import { Shop } from '@/components/screens/Shop';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { loadListingSortOrders } from '@/lib/goods-listing-orders.server';
import { isServerOrderedSort, parseListingSearchParams, selectShopGoods } from '@/lib/shop-catalog';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';
import { getCollectionBanners } from '@/lib/collection-banners.server';

export const metadata: Metadata = {
  title: 'NEW — ICONS',
  description: '새로 나온 굿즈를 모아 봤어요.',
};

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/* NEW 는 별도 큐레이션이 아니라 굿즈의 NEW 배지가 정의한다 — 컬렉션 스코프만 다르다. 탭 줄이 곧 정렬(인기도·최신 등록·판매량·가격 2·리뷰)이고
   기본은 최신 등록순이다. 필터 쿼리는 읽지 않는다(Figma 에 필터가 없다). 인기도·판매량·리뷰 많은순일 때만 DB 정렬 순서를 읽는다. */
export default async function Page({ searchParams }: PageProps) {
  const params = await (searchParams ?? {});
  const { query } = parseListingSearchParams(params, 'new');
  const [catalog, wishlist, banners, sortOrders] = await Promise.all([
    getAdultGoodsAccess().then(adultGoods => getCatalogSnapshot({ adultGoods, includeReviewSummaries: true, storefrontReadCache: true })),
    loadListingWishlist(),
    getCollectionBanners('new'),
    isServerOrderedSort(query.sort) ? loadListingSortOrders() : Promise.resolve(null),
  ]);

  return <Shop banners={banners} query={query} result={selectShopGoods(catalog, query, [], sortOrders)} view="new" wishlist={wishlist} />;
}
