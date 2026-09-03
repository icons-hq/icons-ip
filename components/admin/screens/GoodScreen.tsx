'use client';

import { useActionState, useMemo } from 'react';
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
import type { CatalogSnapshot } from '@/lib/catalog';
import { toRecordOptions, useSelectedRecord } from './record-selection';

const emptyState: AdminCatalogActionState = {};

/*
 * 굿즈 화면 래퍼.
 *
 * 목록(콘솔)과 편집(폼)은 같은 라우트의 두 얼굴이고 `?selected=`가 둘을 가른다 —
 * 없으면 목록, `new`면 빈 등록 폼, id면 그 굿즈의 편집 폼. 검색·필터는 URL에 남아
 * 편집을 마치고 목록으로 돌아가도 보던 자리가 그대로다.
 *
 * `adjustmentId`는 실재고 조정의 멱등 키다. 여기서 만들면 리렌더마다 값이 바뀌어
 * 같은 조정이 두 번 먹힐 수 있어서, 서버 컴포넌트인 page가 만들어 내려준다.
 */
export function GoodScreen({
  adjustmentId,
  catalogIps,
  filters,
  ips,
  list,
  records,
}: {
  adjustmentId: string;
  catalogIps: CatalogSnapshot['ips'];
  filters: AdminGoodListFilters;
  ips: AdminCatalogRecords['ips'];
  list: AdminGoodList;
  records: AdminCatalogRecords['goods'];
}) {
  const [state, action, pending] = useActionState(upsertAdminGoodAction, emptyState);
  const ipOptions = useMemo(() => toRecordOptions(ips), [ips]);
  const creating = filters.selected === ADMIN_CATALOG_NEW_RECORD;
  const { selected } = useSelectedRecord(records, creating ? null : filters.selected);

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
      ipOptions={ipOptions}
      listHref={adminGoodListHref(filters, { selected: null })}
      pending={pending}
      selected={selected}
      state={state}
    />
  );
}
