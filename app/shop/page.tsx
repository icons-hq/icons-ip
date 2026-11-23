import { Shop } from '@/components/screens/Shop';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { isServerOrderedSort, parseListingSearchParams, selectShopGoods } from '@/lib/shop-catalog';
import { notFound } from 'next/navigation';
import { listingCategoryDisplayQuery, parseCategoryDisplayRequest } from '@/lib/category-display';
import { loadCategoryDisplayPage } from '@/lib/category-display.server';
import { buildCategoryListingNav } from '@/lib/category-chips';
import { CategoryDisplayShop } from '@/components/shop/CategoryDisplayShop';
import { loadListingSortOrders } from '@/lib/goods-listing-orders.server';
import { EMPTY_STOREFRONT_MEGA_MENUS } from '@/lib/storefront-mega-menu';
import { getStorefrontMegaMenus } from '@/lib/storefront-mega-menu.server';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';
import { getCollectionBanners } from '@/lib/collection-banners.server';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/* 공개 전시 트리(메가메뉴와 같은 원천)는 칩·제목·하위 탭의 데이터다. 읽기가 실패해도 목록은 막지 않는다 — 칩 영역 없이 목록만 그린다. */
const loadCategoryTree = () => getStorefrontMegaMenus().then(menus => menus.categories).catch(() => EMPTY_STOREFRONT_MEGA_MENUS.categories);

export default async function Page({ searchParams }: PageProps) {
  const params: Record<string, string | string[] | undefined> = await (searchParams ?? {});
  if (params.displayCategory !== undefined) {
    const input = parseCategoryDisplayRequest(params);
    if (!input) notFound();
    /* 이 화면에는 필터가 없다 — 전시 id·정렬 검증은 위에서 끝났고, 여기서 필터를 버리고 화면에서 뺀 정렬을 기본값으로 돌린다. */
    const query = listingCategoryDisplayQuery(input.query);
    const [page, tree, wishlist] = await Promise.all([loadCategoryDisplayPage(input.categoryId, query), loadCategoryTree(), loadListingWishlist()]);
    if (!page) notFound();
    return <CategoryDisplayShop key={`${page.category.id}:${page.token}`} initial={page} nav={buildCategoryListingNav(tree, page.category.id)} wishlist={wishlist} />;
  }
  /* 전체 굿즈 — 칩(전체 선택) + "전체 굿즈" + 정렬 셀렉트. 컬렉션 배너(all 슬롯 슬라이더)는 여기서만 읽는다. 필터 쿼리는 읽지 않는다. */
  const { query } = parseListingSearchParams(params, 'all');
  const [catalog, tree, wishlist, banners, sortOrders] = await Promise.all([
    getAdultGoodsAccess().then(adultGoods => getCatalogSnapshot({ adultGoods, includeReviewSummaries: true, storefrontReadCache: true })),
    loadCategoryTree(),
    loadListingWishlist(),
    getCollectionBanners('all'),
    isServerOrderedSort(query.sort) ? loadListingSortOrders() : Promise.resolve(null),
  ]);
  return <Shop banners={banners} categoryNav={buildCategoryListingNav(tree, null)} query={query} result={selectShopGoods(catalog, query, [], sortOrders)} view="all" wishlist={wishlist} />;
}
