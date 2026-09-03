import { randomUUID } from 'node:crypto';
import { GoodScreen } from '@/components/admin/screens/GoodScreen';
import { buildAdminGoodList, normalizeAdminGoodListFilters } from '@/lib/admin/catalog-list';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getCatalogSnapshot } from '@/lib/catalog';

/*
 * 목록 조건(탭·검색·필터·정렬·페이지)과 편집 대상(`?selected=`)은 전부 URL에 있다.
 * 서버가 조건을 좁혀 목록을 잘라 내려주고, 화면은 그 결과만 그린다.
 */
export default async function AdminCatalogGoodsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/catalog/goods');
  const filters = normalizeAdminGoodListFilters(await searchParams);

  const [records, catalog] = await Promise.all([
    getAdminCatalogRecords({ include: ['goods', 'ips'] }),
    getCatalogSnapshot({ previewDefaultSource: 'supabase' }),
  ]);
  const list = buildAdminGoodList(records.goods, records.ips, filters);

  return (
    <GoodScreen
      adjustmentId={randomUUID()}
      catalogIps={catalog.ips}
      filters={filters}
      ips={records.ips}
      key={filters.selected ?? 'list'}
      list={list}
      records={records.goods}
    />
  );
}
