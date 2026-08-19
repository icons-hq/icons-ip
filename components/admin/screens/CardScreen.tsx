'use client';

import { useActionState, useMemo } from 'react';
import { upsertAdminCardAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { CardSection } from '@/components/admin/sections/CardSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import { toRecordOptions, useSelectedRecord } from './record-selection';

const emptyState: AdminCatalogActionState = {};

/*
 * 카드 화면 래퍼.
 *
 * `initialSelectedId`는 카드풀 화면의 "카드 편집" 링크(`?cardId=`)가 넘겨준 값이다.
 * 섹션 전환 콜백이 하던 일을 라우트가 대신하므로, 딥링크로 들어와도 해당 카드가
 * 처음부터 선택돼 있어야 한다. 이후 선택은 화면 로컬 상태로만 움직인다.
 */
export function CardScreen({
  initialSelectedId = null,
  ips,
  pools,
  records,
}: {
  initialSelectedId?: string | null;
  ips: AdminCatalogRecords['ips'];
  pools: AdminCatalogRecords['cardPools'];
  records: AdminCatalogRecords['cards'];
}) {
  const [state, action, pending] = useActionState(upsertAdminCardAction, emptyState);
  const ipOptions = useMemo(() => toRecordOptions(ips), [ips]);
  const poolOptions = useMemo(
    () => pools.map((pool) => ({ id: pool.id, ipId: pool.ipId, name: pool.name })),
    [pools],
  );
  const { selected, select } = useSelectedRecord(records, initialSelectedId);

  return (
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
  );
}
