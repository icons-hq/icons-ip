'use client';

import { useMemo, useState } from 'react';
import { CardPoolSection } from '@/components/admin/sections/CardPoolSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';

/*
 * 카드풀 화면 래퍼.
 *
 * 카드풀 저장·확률 저장은 멱등 키를 쓴다. 그래서 `draftId`·`operationId`·`oddsOperationId`는
 * 서버 컴포넌트인 page가 요청당 한 번 만들어 내려준다.
 */
export function CardPoolScreen({
  cards,
  draftActiveFrom,
  draftId,
  ips,
  oddsOperationId,
  operationId,
  records,
}: {
  cards: AdminCatalogRecords['cards'];
  draftActiveFrom: string;
  draftId: string;
  ips: AdminCatalogRecords['ips'];
  oddsOperationId: string;
  operationId: string;
  records: AdminCatalogRecords['cardPools'];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ipOptions = useMemo(
    () => ips.map((ip) => ({ id: ip.id, title: ip.title, archivedAt: ip.archivedAt })),
    [ips],
  );
  const selected = records.find((pool) => pool.id === selectedId) ?? null;

  return (
    <CardPoolSection
      cards={cards}
      draftActiveFrom={draftActiveFrom}
      draftId={draftId}
      ipOptions={ipOptions}
      oddsOperationId={oddsOperationId}
      onSelect={(pool) => setSelectedId(pool?.id ?? null)}
      operationId={operationId}
      records={records}
      selected={selected}
    />
  );
}
