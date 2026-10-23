import { loadPublicCatalogCategories } from '@/lib/catalog-categories.server';
import { Shop } from '@/components/screens/Shop';
import { getCatalogSnapshot } from '@/lib/catalog';
import { parseShopSearchParams, selectShopGoods } from '@/lib/shop-catalog';
import { notFound } from 'next/navigation';
import { parseCategoryDisplayRequest } from '@/lib/category-display';
import { loadCategoryDisplayNavigation, loadCategoryDisplayPage } from '@/lib/category-display.server';
import { CategoryDisplayShop } from '@/components/shop/CategoryDisplayShop';
import { CategoryDisplayNavigation } from '@/components/shop/CategoryDisplayContents';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const params: Record<string, string | string[] | undefined> = await (searchParams ?? {});
  if (params.displayCategory !== undefined) {
    const input = parseCategoryDisplayRequest(params);
    if (!input) notFound();
    const [page, navigation, wishlist] = await Promise.all([loadCategoryDisplayPage(input.categoryId, input.query), loadCategoryDisplayNavigation(), loadListingWishlist()]);
    if (!page) notFound();
    return <CategoryDisplayShop key={`${page.category.id}:${page.token}`} initial={{ ...page, navigation }} wishlist={wishlist} />;
  }
  const [catalog, displayNavigation, wishlist] = await Promise.all([getCatalogSnapshot(), loadCategoryDisplayNavigation().then(entries => ({ entries, failed: false })).catch(() => ({ entries: [], failed: true })), loadListingWishlist()]);
  const categories = catalog.source === 'supabase' ? await loadPublicCatalogCategories() : [];
  const query = parseShopSearchParams(params, {
    view: 'all',
    validIpIds: new Set(catalog.ips.map((ip) => ip.id)),
    validCategoryIds: new Set(categories.map((category) => category.id)),
  });

  /* 카테고리 전시 내비와 실패 안내는 Shop 의 .wc-root 밖 형제다. 자기 .wc-root 가 없으면 --wc-container-max·--wc-gutter·
     --wc-hairline·--wc-focus 가 비어 컨테이너 폭·거터·칩 선·포커스 링을 잃고 x0 에서 맨 글자로 선다(l4-qa-2). */
  const hasDisplayLead = displayNavigation.entries.length > 0 || displayNavigation.failed;
  return <>
    {hasDisplayLead ? <div className="wc-root">
      <CategoryDisplayNavigation entries={displayNavigation.entries} />
      {displayNavigation.failed ? <p className="wc-container" role="status">카테고리 전시를 불러오지 못했습니다. 전체 굿즈는 계속 확인할 수 있습니다.</p> : null}
    </div> : null}
    <Shop query={query} result={selectShopGoods({ ...catalog, categories }, query)} view="all" wishlist={wishlist} />
  </>;
}
