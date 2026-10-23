import { Search } from '@/components/screens/Search';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { loadPublicCatalogCategories } from '@/lib/catalog-categories.server';
import { getSearchSnapshot, normalizeSearchQuery } from '@/lib/search';
import { selectSearchGoods } from '@/lib/search-goods';
import { parseShopSearchParams } from '@/lib/shop-catalog';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/* 페이지 번호는 URL에서 오는 임의 문자열이다. 정수만 통과시키고 범위 클램프는
   selectSearchGoods 가 필터 뒤 총 건수를 알고 있는 자리에서 마무리한다. */
function parsePageParam(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

/* 굿즈 결과는 굿즈샵과 같은 URL 필터(카테고리·IP·타입·가격)와 검색 정렬(관련성·가격)을 받는다(SR-01). */
export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const query = normalizeSearchQuery(params.q);
  const [snapshot, catalog, wishlist] = await Promise.all([getSearchSnapshot(query), getAdultGoodsAccess().then(adultGoods => getCatalogSnapshot({ adultGoods, includeReviewSummaries: true })), loadListingWishlist()]);
  const categories = catalog.source === 'supabase' ? await loadPublicCatalogCategories() : [];
  const listQuery = parseShopSearchParams(params, {
    view: 'search',
    validIpIds: new Set(catalog.ips.map((ip) => ip.id)),
    validCategoryIds: new Set(categories.map((category) => category.id)),
  });
  const goods = selectSearchGoods({ ...catalog, categories }, query, listQuery, parsePageParam(params.page));

  return <Search goods={goods} listQuery={listQuery} query={query} snapshot={snapshot} wishlist={wishlist} />;
}
