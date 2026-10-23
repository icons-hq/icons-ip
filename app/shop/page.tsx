import { loadPublicCatalogCategories } from '@/lib/catalog-categories.server';
import { Shop } from '@/components/screens/Shop';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { parseShopSearchParams, selectShopGoods } from '@/lib/shop-catalog';
import { notFound } from 'next/navigation';
import { parseCategoryDisplayRequest } from '@/lib/category-display';
import { loadCategoryDisplayNavigation, loadCategoryDisplayPage } from '@/lib/category-display.server';
import { CategoryDisplayShop } from '@/components/shop/CategoryDisplayShop';
import { CategoryDisplayNavigation } from '@/components/shop/CategoryDisplayContents';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const params: Record<string, string | string[] | undefined> = await (searchParams ?? {});
  if (params.displayCategory !== undefined) {
    const input = parseCategoryDisplayRequest(params);
    if (!input) notFound();
    const [page, navigation] = await Promise.all([loadCategoryDisplayPage(input.categoryId, input.query), loadCategoryDisplayNavigation()]);
    if (!page) notFound();
    return <CategoryDisplayShop key={`${page.category.id}:${page.token}`} initial={{ ...page, navigation }} />;
  }
  const [catalog, displayNavigation] = await Promise.all([getAdultGoodsAccess().then(adultGoods => getCatalogSnapshot({ adultGoods })), loadCategoryDisplayNavigation().then(entries => ({ entries, failed: false })).catch(() => ({ entries: [], failed: true }))]);
  const categories = catalog.source === 'supabase' ? await loadPublicCatalogCategories() : [];
  const query = parseShopSearchParams(params, {
    view: 'all',
    validIpIds: new Set(catalog.ips.map((ip) => ip.id)),
    validCategoryIds: new Set(categories.map((category) => category.id)),
  });

  return <><CategoryDisplayNavigation entries={displayNavigation.entries} />
    {displayNavigation.failed ? <p className="wc-container" role="status">카테고리 전시를 불러오지 못했습니다. 전체 굿즈는 계속 확인할 수 있습니다.</p> : null}
    <Shop query={query} result={selectShopGoods({ ...catalog, categories }, query)} view="all" /></>;
}
