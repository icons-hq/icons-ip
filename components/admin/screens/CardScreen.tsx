'use client';

import Link from 'next/link';
import { useActionState, useMemo } from 'react';
import { upsertAdminCardAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { CardConsole } from '@/components/admin/catalog/CardConsole';
import { CardSection } from '@/components/admin/sections/CardSection';
import {
  ADMIN_CATALOG_NEW_RECORD,
  adminCardListHref,
  type AdminCardList,
  type AdminCardListFilters,
} from '@/lib/admin/catalog-list';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import { useSelectedRecord } from './record-selection';

const emptyState: AdminCatalogActionState = {};

/*
 * 카드 화면 래퍼 (규모 후속). 굿즈·IP 화면과 같은 규칙 — `?selected=` 가 없으면 목록, `new` 면
 * 빈 등록 폼, id 면 편집 폼. 서버 라우트가 데이터와 목록을 만들고, 폼 액션 상태만 여기가 갖는다.
 */
export function CardScreen({
  filters,
  ipOptions,
  list,
  pools,
  records,
}: {
  filters: AdminCardListFilters;
  /** IP 선택지 — 상위 N + 편집 중인 카드의 IP. 나머지는 목록 화면의 IP 링크로 찾는다. */
  ipOptions: AdminCurationTargetRecord[];
  list: AdminCardList;
  pools: AdminCatalogRecords['cardPools'];
  records: AdminCatalogRecords['cards'];
}) {
  const [state, action, pending] = useActionState(upsertAdminCardAction, emptyState);
  const creating = filters.selected === ADMIN_CATALOG_NEW_RECORD;
  const { selected, select } = useSelectedRecord(records, creating ? null : filters.selected);
  const poolOptions = useMemo(
    () => pools.map((pool) => ({ id: pool.id, ipId: pool.ipId, name: pool.name })),
    [pools],
  );

  if (!creating && !selected) {
    return <CardConsole filters={filters} list={list} missingSelection={filters.selected} />;
  }

  return (
    <div className="col" style={{ gap: 12, minWidth: 0 }}>
      <Link className="btn btn-sm btn-ghost" href={adminCardListHref(filters, { selected: null })} style={{ alignSelf: 'flex-start' }}>
        ← 카드 목록
      </Link>
      <CardSection
        action={action}
        ipOptions={ipOptions}
        onSelect={select}
        pending={pending}
        poolOptions={poolOptions}
        records={records}
        selected={selected}
        state={state}
      />
    </div>
  );
}
