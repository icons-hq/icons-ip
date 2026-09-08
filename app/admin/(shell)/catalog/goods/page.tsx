import { randomUUID } from 'node:crypto';
import { GoodScreen } from '@/components/admin/screens/GoodScreen';
import {
  ADMIN_CATALOG_NEW_RECORD,
  emptyAdminGoodList,
  normalizeAdminGoodListFilters,
} from '@/lib/admin/catalog-list';
import {
  getAdminGoodList,
  getAdminGoodRecord,
  getAdminIpOptions,
  getAdminSuggestedGoodId,
} from '@/lib/admin/catalog-list.server';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminGoodVariantEditorData } from '@/lib/admin/variants.server';
import { getAdminCategories, getAdminGoodCategories } from '@/lib/admin/categories.server';
import { getAdminShippingPolicies } from '@/lib/admin/shipping-policies.server';
import { getStorefrontIpsByIds } from '@/lib/storefront.server';

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

  const [list, ipOptions, variantEditor, categories, categoryMemberships, shippingPolicies, suggestedId] = await Promise.all([
    editing ? null : getAdminGoodList(filters),
    getAdminIpOptions({ selectedId: editing ? (selected?.ipId ?? template?.ipId ?? null) : (filters.ip || null) }),
    /* 옵션·품목·출고지별 재고는 저장된 굿즈에만 있다. */
    selected ? getAdminGoodVariantEditorData(selected.id) : null,
    selected ? getAdminCategories() : [],
    selected ? getAdminGoodCategories(selected.id) : [],
    selected ? getAdminShippingPolicies() : [],
    /* 다음 순번은 등록할 때만 묻는다 — 수정 화면에서 id 는 바꿀 수 없다. */
    creating ? getAdminSuggestedGoodId() : null,
  ]);
  /* 미리보기가 쓰는 IP 는 **선택기에 오른 것**뿐이다(규모 후속) — 전량 스냅샷을 읽던 자리다.
     선택기는 상위 N + 지금 값을 담으므로 고를 수 있는 IP 는 전부 미리보기에도 있다. */
  const catalogIps = editing ? await getStorefrontIpsByIds(ipOptions.map((option) => option.id)) : [];

  return (
    <GoodScreen
      adjustmentId={randomUUID()}
      catalogIps={catalogIps}
      filters={filters}
      ipOptions={ipOptions}
      key={filters.selected ?? 'list'}
      list={list ?? emptyAdminGoodList(filters)}
      records={[selected, template].filter((record): record is AdminGoodRecord => record !== null)}
      variantBatchId={randomUUID()}
      variantEditor={variantEditor}
      categories={categories}
      categoryMemberships={categoryMemberships}
      shippingPolicies={shippingPolicies}
      suggestedId={suggestedId}
    />
  );
}
