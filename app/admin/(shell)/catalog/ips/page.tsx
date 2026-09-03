import { IpScreen } from '@/components/admin/screens/IpScreen';
import { buildAdminIpList, normalizeAdminIpListFilters } from '@/lib/admin/catalog-list';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getCatalogSnapshot } from '@/lib/catalog';

/*
 * IP 목록은 "이 IP에 굿즈가 몇 개 살아 있는지"를 함께 보여주므로 굿즈도 include 한다.
 * 목록 조건과 편집 대상(`?selected=`)은 굿즈 화면과 같은 규칙으로 URL에 있다.
 */
export default async function AdminCatalogIpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/catalog/ips');
  const filters = normalizeAdminIpListFilters(await searchParams);

  const [records, catalog] = await Promise.all([
    getAdminCatalogRecords({ include: ['ips', 'goods'] }),
    getCatalogSnapshot({ previewDefaultSource: 'supabase' }),
  ]);
  const list = buildAdminIpList(records.ips, records.goods, catalog.verticals, filters);

  return (
    <IpScreen
      filters={filters}
      key={filters.selected ?? 'list'}
      list={list}
      records={records.ips}
      verticals={catalog.verticals}
    />
  );
}
