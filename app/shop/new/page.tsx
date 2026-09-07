import type { Metadata } from 'next';
import { Shop } from '@/components/screens/Shop';
import { loadMoreShopGoodsAction } from '@/app/shop/actions';
import { parseShopSearchParams } from '@/lib/shop-catalog';
import { getStorefrontShopResult } from '@/lib/storefront.server';

export const metadata: Metadata = {
  title: 'NEW — ICONS',
  description: '새로 나온 굿즈를 모아 봤어요.',
};

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/* NEW 는 별도 큐레이션이 아니라 굿즈의 NEW 배지가 정의한다 — 컬렉션 스코프만 다르고
   필터·정렬·VIEW MORE 는 굿즈샵과 같은 화면이다. */
export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const query = parseShopSearchParams(params, { view: 'new' });

  return (
    <Shop
      loadMore={loadMoreShopGoodsAction.bind(null, query)}
      query={query}
      result={await getStorefrontShopResult(query)}
      view="new"
    />
  );
}
