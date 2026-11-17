import type { Metadata } from 'next';
import { Shop } from '@/components/screens/Shop';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { loadListingSortOrders, loadSalesRanking } from '@/lib/goods-listing-orders.server';
import { isServerOrderedSort, parseListingSearchParams, selectShopGoods } from '@/lib/shop-catalog';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';
import { getCollectionBanners } from '@/lib/collection-banners.server';

export const metadata: Metadata = {
  title: 'BEST — ICONS',
  description: '지금 가장 사랑받는 굿즈예요.',
};

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/* BEST 의 순위는 기간별 판매 랭킹이다(실시간·일간·주간·월간, 홈 판매 BEST 와 같은 집계 정의 — `get_goods_sales_ranking`).
   홈 전시관리의 큐레이션(best_tab)은 홈 밴드로만 남고 이 화면은 읽지 않는다. 랭킹 id 와 이 사람이 볼 수 있는 카탈로그 굿즈의 교집합이 스코프다
   (성인·비공개 굿즈는 DB 와 카탈로그 양쪽에서 빠진다). 셀렉트의 다른 정렬은 이 순위 목록 안에서 다시 줄 세운다.
   랭킹을 읽지 못하면 가짜 순위 대신 실패 안내를 그린다(빈 기간 안내와 문구가 다르다). */
export default async function Page({ searchParams }: PageProps) {
  const params = await (searchParams ?? {});
  const { period, query } = parseListingSearchParams(params, 'best');
  const [catalog, ranking, wishlist, banners, sortOrders] = await Promise.all([
    getAdultGoodsAccess().then(adultGoods => getCatalogSnapshot({ adultGoods, includeReviewSummaries: true })),
    loadSalesRanking(period),
    loadListingWishlist(),
    getCollectionBanners('best'),
    isServerOrderedSort(query.sort) ? loadListingSortOrders() : Promise.resolve(null),
  ]);

  return (
    <Shop
      banners={banners}
      period={period}
      query={query}
      rankingFailed={ranking === null}
      result={selectShopGoods(catalog, query, ranking ?? [], sortOrders)}
      view="best"
      wishlist={wishlist}
    />
  );
}
