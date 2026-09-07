import { Shop } from '@/components/screens/Shop';
import { loadMoreShopGoodsAction } from '@/app/shop/actions';
import { parseShopSearchParams } from '@/lib/shop-catalog';
import { getStorefrontShopResult } from '@/lib/storefront.server';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/* 목록·집계는 DB 가 만든다 — 카탈로그 전량을 읽어 메모리에서 거르면 1,000번째 상품에서
   조용히 잘린다(규모 ⑤). 첫 페이지만 받고 나머지는 「더 보기」가 이어 받는다. */
export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const query = parseShopSearchParams(params, { view: 'all' });

  return (
    <Shop
      loadMore={loadMoreShopGoodsAction.bind(null, query)}
      query={query}
      result={await getStorefrontShopResult(query)}
      view="all"
    />
  );
}
