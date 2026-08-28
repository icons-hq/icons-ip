import type { Metadata } from 'next';
import { Shop } from '@/components/screens/Shop';
import { getHomeSnapshot } from '@/lib/catalog';
import { parseShopSearchParams, selectShopGoods } from '@/lib/shop-catalog';

export const metadata: Metadata = {
  title: 'BEST — ICONS',
  description: '지금 가장 사랑받는 굿즈예요.',
};

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/* BEST 의 순위는 판매 지표가 아니라 홈과 같은 어드민 큐레이션(best_tab)이 정한다.
   홈의 카테고리 BEST → 인기템 순서로 이어 붙이고 중복은 selectShopGoods 가 접는다.
   큐레이션이 비면 여기서 나오는 스코프도 비고, 화면은 가짜 순위 대신 안내를 그린다.
   getHomeSnapshot 은 카탈로그까지 함께 주므로 카탈로그를 두 번 읽지 않는다. */
export default async function Page({ searchParams }: PageProps) {
  const [home, params] = await Promise.all([getHomeSnapshot(), searchParams ?? {}]);
  const bestGoodIds = [...home.curation.categoryBestTabs, ...home.curation.popularTabs]
    .flatMap((tab) => tab.goods.map((good) => good.id));
  const query = parseShopSearchParams(params, {
    view: 'best',
    validIpIds: new Set(home.catalog.ips.map((ip) => ip.id)),
  });

  return (
    <Shop query={query} result={selectShopGoods(home.catalog, query, bestGoodIds)} view="best" />
  );
}
