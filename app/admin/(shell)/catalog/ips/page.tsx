import { IpScreen } from '@/components/admin/screens/IpScreen';
import {
  ADMIN_CATALOG_NEW_RECORD,
  emptyAdminIpList,
  normalizeAdminIpListFilters,
} from '@/lib/admin/catalog-list';
import { getAdminIpList, getAdminIpRecord, getAdminVerticals } from '@/lib/admin/catalog-list.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

/*
 * IP 목록은 "이 IP에 굿즈가 몇 개 살아 있는지"를 함께 보여준다 — 그 수는 RPC 가 센다.
 * 목록 조건과 편집 대상(`?selected=`)은 굿즈 화면과 같은 규칙으로 URL에 있다.
 */
export default async function AdminCatalogIpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/catalog/ips');
  const filters = normalizeAdminIpListFilters(await searchParams);
  const creating = filters.selected === ADMIN_CATALOG_NEW_RECORD;

  const selected = !creating && filters.selected ? await getAdminIpRecord(filters.selected) : null;
  const editing = creating || selected !== null;

  const [list, verticals] = await Promise.all([
    editing ? null : getAdminIpList(filters),
    getAdminVerticals(),
  ]);

  return (
    <IpScreen
      filters={filters}
      key={filters.selected ?? 'list'}
      list={list ?? emptyAdminIpList(filters)}
      records={selected ? [selected] : []}
      verticals={verticals}
    />
  );
}
