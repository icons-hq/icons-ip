'use client';

import { useActionState } from 'react';
import { upsertAdminIpAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { IpConsole } from '@/components/admin/catalog/IpConsole';
import { IpSection } from '@/components/admin/sections/IpSection';
import {
  ADMIN_CATALOG_NEW_RECORD,
  adminIpListHref,
  type AdminIpList,
  type AdminIpListFilters,
} from '@/lib/admin/catalog-list';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { CatalogSnapshot } from '@/lib/catalog';
import { useSelectedRecord } from './record-selection';

const emptyState: AdminCatalogActionState = {};

/*
 * IP 화면 래퍼. 굿즈 화면과 같은 규칙 — `?selected=`가 없으면 목록, `new`면 빈 등록 폼,
 * id면 편집 폼. 서버 컴포넌트 라우트가 데이터와 목록을 만들고, 폼 액션 상태만 여기가 갖는다.
 */
export function IpScreen({
  filters,
  list,
  records,
  verticals,
}: {
  filters: AdminIpListFilters;
  list: AdminIpList;
  records: AdminCatalogRecords['ips'];
  verticals: CatalogSnapshot['verticals'];
}) {
  const [state, action, pending] = useActionState(upsertAdminIpAction, emptyState);
  const creating = filters.selected === ADMIN_CATALOG_NEW_RECORD;
  const { selected } = useSelectedRecord(records, creating ? null : filters.selected);

  if (!creating && !selected) {
    return (
      <IpConsole
        filters={filters}
        list={list}
        missingSelection={filters.selected}
        verticals={verticals}
      />
    );
  }

  return (
    <IpSection
      action={action}
      listHref={adminIpListHref(filters, { selected: null })}
      pending={pending}
      selected={selected}
      state={state}
      verticals={verticals}
    />
  );
}
