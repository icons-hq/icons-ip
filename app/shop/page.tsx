import { Shop } from '@/components/screens/Shop';
import { getCatalogSnapshot } from '@/lib/catalog';
import { parseShopSearchParams, selectShopGoods } from '@/lib/shop-catalog';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const [catalog, params] = await Promise.all([getCatalogSnapshot(), searchParams ?? {}]);
  const query = parseShopSearchParams(params, {
    view: 'all',
    validIpIds: new Set(catalog.ips.map((ip) => ip.id)),
  });

  return <Shop query={query} result={selectShopGoods(catalog, query)} view="all" />;
}
