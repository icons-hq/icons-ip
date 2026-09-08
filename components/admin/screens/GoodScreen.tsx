'use client';

import { useActionState } from 'react';
import { upsertAdminGoodAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { GoodConsole } from '@/components/admin/catalog/GoodConsole';
import { GoodSection } from '@/components/admin/sections/GoodSection';
import {
  ADMIN_CATALOG_NEW_RECORD,
  adminGoodListHref,
  type AdminGoodList,
  type AdminGoodListFilters,
} from '@/lib/admin/catalog-list';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import type { AdminGoodVariantEditorData } from '@/lib/admin/variants';
import type { AdminCategory } from '@/lib/admin/categories';
import type { CatalogSnapshot } from '@/lib/catalog';
import { useSelectedRecord } from './record-selection';
import type { AdminShippingPolicy } from '@/lib/admin/shipping-policies';

const emptyState: AdminCatalogActionState = {};

/*
 * 굿즈 화면 래퍼.
 *
 * 목록(콘솔)과 편집(폼)은 같은 라우트의 두 얼굴이고 `?selected=`가 둘을 가른다 —
 * 없으면 목록, `new`면 빈 등록 폼, id면 그 굿즈의 편집 폼. `new`에 `copyFrom=`이
 * 붙으면 그 굿즈를 원본으로 ID만 비운 새 등록이다. 검색·필터는 URL에 남아 편집을
 * 마치고 목록으로 돌아가도 보던 자리가 그대로다.
 *
 * `adjustmentId`는 실재고 조정의 멱등 키다. 여기서 만들면 리렌더마다 값이 바뀌어
 * 같은 조정이 두 번 먹힐 수 있어서, 서버 컴포넌트인 page가 만들어 내려준다.
 *
 * `records`는 전량이 아니라 이 요청이 읽은 레코드(편집 대상·복사 원본)뿐이다 —
 * 목록은 서버가 한 페이지만 자르고, 편집은 그 레코드 하나만 읽는다.
 */
export function GoodScreen({
  adjustmentId,
  catalogIps,
  filters,
  ipOptions,
  list,
  records,
  variantBatchId = null,
  variantEditor = null,
  categories = [],
  categoryMemberships = [],
  shippingPolicies = [],
  suggestedId = null,
}: {
  adjustmentId: string;
  catalogIps: CatalogSnapshot['ips'];
  filters: AdminGoodListFilters;
  /** IP 선택지 — 팬 많은 순 상위 + 현재 선택된 IP(보관이어도). 나머지는 검색으로 찾는다. */
  ipOptions: AdminCurationTargetRecord[];
  list: AdminGoodList;
  records: AdminCatalogRecords['goods'];
  /** 품목 일괄 저장 배치 키 + 옵션·품목·재고 데이터(편집 화면). */
  variantBatchId?: string | null;
  variantEditor?: AdminGoodVariantEditorData | null;
  /** 분류 선택지와 이 굿즈의 소속(D-9). */
  categories?: readonly AdminCategory[];
  categoryMemberships?: readonly { categoryId: string; isPrimary: boolean }[];
  shippingPolicies?: AdminShippingPolicy[];
  /** 등록 화면의 id 제안(현업 슬라이스 5). 채워 줄 뿐 고쳐 쓸 수 있다. */
  suggestedId?: string | null;
}) {
  const [state, action, pending] = useActionState(upsertAdminGoodAction, emptyState);
  const creating = filters.selected === ADMIN_CATALOG_NEW_RECORD;
  const { selected } = useSelectedRecord(records, creating ? null : filters.selected);
  const template = creating && filters.copyFrom
    ? records.find((record) => record.id === filters.copyFrom) ?? null
    : null;

  if (!creating && !selected) {
    return (
      <GoodConsole
        filters={filters}
        ipOptions={ipOptions}
        list={list}
        missingSelection={filters.selected}
      />
    );
  }

  return (
    <GoodSection
      action={action}
      adjustmentId={adjustmentId}
      catalogIps={catalogIps}
      copyHref={selected
        ? adminGoodListHref(filters, { selected: ADMIN_CATALOG_NEW_RECORD, copyFrom: selected.id })
        : null}
      ipOptions={ipOptions}
      listHref={adminGoodListHref(filters, { selected: null, copyFrom: null })}
      pending={pending}
      selected={selected}
      state={state}
      template={template}
      variantBatchId={variantBatchId}
      variantEditor={variantEditor}
      categories={categories}
      categoryMemberships={categoryMemberships}
      shippingPolicies={shippingPolicies}
      suggestedId={suggestedId}
    />
  );
}
