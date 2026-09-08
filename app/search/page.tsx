import { Search } from '@/components/screens/Search';
import { getSearchSnapshot, normalizeSearchQuery } from '@/lib/search';
import {
  SEARCH_GOODS_PAGE_SIZE,
  goodsSearchOffset,
  goodsSearchPage,
  requestedGoodsSearchPage,
} from '@/lib/search-goods';
import { searchStorefrontGoods } from '@/lib/storefront.server';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/* 페이지 번호는 URL에서 오는 임의 문자열이다. 정수만 통과시키고 범위 클램프는
   총 건수를 알게 된 뒤 goodsSearchPage 가 마무리한다. */
function parsePageParam(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const query = normalizeSearchQuery(params.q);
  const page = requestedGoodsSearchPage(parsePageParam(params.page));
  /* 순위와 자르기는 서버가 한다(규모 후속) — 카탈로그 전량을 메모리에서 훑지 않는다. */
  const [snapshot, found] = await Promise.all([
    getSearchSnapshot(query),
    searchStorefrontGoods(query, { limit: SEARCH_GOODS_PAGE_SIZE, offset: goodsSearchOffset(page) }),
  ]);
  let goodsResult = goodsSearchPage({ items: found.goods, total: found.total, page });
  let ips = found.ips;
  /* 범위 밖 페이지를 열었으면 마지막 페이지를 다시 묻는다 — 빈 목록에 「3/2 페이지」를 그리지 않는다. */
  if (goodsResult.page !== page && goodsResult.total > 0) {
    const last = await searchStorefrontGoods(query, {
      limit: SEARCH_GOODS_PAGE_SIZE,
      offset: goodsSearchOffset(goodsResult.page),
    });
    goodsResult = goodsSearchPage({ items: last.goods, total: last.total, page: goodsResult.page });
    ips = last.ips;
  }

  return <Search goodsResult={goodsResult} ips={ips} query={query} snapshot={snapshot} />;
}
