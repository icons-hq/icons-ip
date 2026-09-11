import { loadPublicCatalogCategories } from '@/lib/catalog-categories.server';
import { Shop } from '@/components/screens/Shop';
import { getCatalogSnapshot } from '@/lib/catalog';
import { parseShopSearchParams, selectShopGoods } from '@/lib/shop-catalog';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const [catalog, params] = await Promise.all([getCatalogSnapshot(), searchParams ?? {}]);
  const categories = catalog.source === 'supabase' ? await loadPublicCatalogCategories() : [];
  const query = parseShopSearchParams(params, {
    view: 'all',
    validIpIds: new Set(catalog.ips.map((ip) => ip.id)),
    validCategoryIds: new Set(categories.map((category) => category.id)),
  });

  return <Shop query={query} result={selectShopGoods({ ...catalog, categories }, query)} view="all" />;
}
