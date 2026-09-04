import { randomUUID } from 'node:crypto';
import { GoodScreen } from '@/components/admin/screens/GoodScreen';
import {
  ADMIN_CATALOG_NEW_RECORD,
  emptyAdminGoodList,
  normalizeAdminGoodListFilters,
} from '@/lib/admin/catalog-list';
import { getAdminGoodList, getAdminGoodRecord, getAdminIpOptions } from '@/lib/admin/catalog-list.server';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getCatalogSnapshot } from '@/lib/catalog';

/*
 * 목록 조건(탭·검색·필터·정렬·페이지)과 편집 대상(`?selected=`)은 전부 URL에 있다.
 * 목록은 서버(RPC)가 한 페이지만 잘라 내려주고, 편집은 그 레코드 하나만 읽는다 —
 * 전량 로더는 1,000행에서 조용히 잘리므로 이 화면에서는 쓰지 않는다.
 */
export default async function AdminCatalogGoodsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/catalog/goods');
  const filters = normalizeAdminGoodListFilters(await searchParams);
  const creating = filters.selected === ADMIN_CATALOG_NEW_RECORD;

  const [selected, template] = await Promise.all([
    !creating && filters.selected ? getAdminGoodRecord(filters.selected) : null,
    creating && filters.copyFrom ? getAdminGoodRecord(filters.copyFrom) : null,
  ]);
  /* 편집 대상이 없으면(낡은 링크) 목록을 그리되 화면 래퍼가 그 id 를 알린다. */
  const editing = creating || selected !== null;

  const [list, ipOptions, catalog] = await Promise.all([
    editing ? null : getAdminGoodList(filters),
    getAdminIpOptions({ selectedId: editing ? (selected?.ipId ?? template?.ipId ?? null) : (filters.ip || null) }),
    /* 미리보기용 공개 스냅샷은 편집 화면만 쓴다. */
    editing ? getCatalogSnapshot({ previewDefaultSource: 'supabase' }) : null,
  ]);

  return (
    <GoodScreen
      adjustmentId={randomUUID()}
      catalogIps={catalog?.ips ?? []}
      filters={filters}
      ipOptions={ipOptions}
      key={filters.selected ?? 'list'}
      list={list ?? emptyAdminGoodList(filters)}
      records={[selected, template].filter((record): record is AdminGoodRecord => record !== null)}
    />
  );
}
