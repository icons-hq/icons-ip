import { CardScreen } from '@/components/admin/screens/CardScreen';
import {
  ADMIN_CATALOG_NEW_RECORD,
  emptyAdminCardList,
  normalizeAdminCardListFilters,
} from '@/lib/admin/catalog-list';
import { getAdminCardList, getAdminCardRecord, getAdminIpOptions } from '@/lib/admin/catalog-list.server';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

/*
 * 카드 목록·편집 (규모 후속). 굿즈·IP 화면과 같은 규칙 — 목록 조건과 편집 대상(`?selected=`)은
 * 전부 URL 에 있다. 목록은 RPC 가 한 페이지만 자르고, 편집은 그 카드 하나만 읽는다.
 * 전에는 카드·IP 전량을 읽었다(1,000행에서 말없이 잘리는 자리).
 *
 * `?cardId=` 는 카드풀 화면의 「카드 편집」 링크가 쓰던 옛 이름이다 — 그대로 받는다.
 */
export default async function AdminCatalogCardsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  await requireAdminScreenAccess('/admin/catalog/cards');
  const query = (await searchParams) ?? {};
  const legacyCardId = Array.isArray(query.cardId) ? undefined : query.cardId;
  const filters = normalizeAdminCardListFilters(
    legacyCardId && !query.selected ? { ...query, selected: legacyCardId } : query,
  );
  const creating = filters.selected === ADMIN_CATALOG_NEW_RECORD;

  const selected = !creating && filters.selected ? await getAdminCardRecord(filters.selected) : null;
  const editing = creating || selected !== null;

  const [list, ipOptions, records] = await Promise.all([
    editing ? null : getAdminCardList(filters),
    /* IP 선택지는 상위 N + 지금 값 — 그 IP 가 상위 밖이어도 편집 중인 카드의 선택지가 사라지면 저장이 막힌다. */
    editing ? getAdminIpOptions({ selectedId: selected?.ipId ?? null }) : Promise.resolve([]),
    /* 카드풀은 운영 표라 작다 — 편집 화면의 풀 선택지에만 쓴다. */
    editing ? getAdminCatalogRecords({ include: ['cardPools'] }) : Promise.resolve(null),
  ]);

  return (
    <CardScreen
      filters={filters}
      ipOptions={ipOptions}
      key={filters.selected ?? 'list'}
      list={list ?? emptyAdminCardList(filters)}
      pools={records?.cardPools ?? []}
      records={selected ? [selected] : []}
    />
  );
}
