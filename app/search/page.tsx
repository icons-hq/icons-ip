import { Search } from '@/components/screens/Search';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getSearchSnapshot, normalizeSearchQuery } from '@/lib/search';
import { searchGoods } from '@/lib/search-goods';

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/* 페이지 번호는 URL에서 오는 임의 문자열이다. 정수만 통과시키고 범위 클램프는
   searchGoods 가 총 건수를 알고 있는 자리에서 마무리한다. */
function parsePageParam(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const query = normalizeSearchQuery(params.q);
  const [snapshot, catalog] = await Promise.all([getSearchSnapshot(query), getCatalogSnapshot()]);
  const goodsResult = searchGoods(catalog, query, parsePageParam(params.page));

  return <Search goodsResult={goodsResult} ips={catalog.ips} query={query} snapshot={snapshot} />;
}
