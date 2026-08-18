'use client';

import { GameSection } from '@/components/admin/sections/GameSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import { useSelectedRecord } from './record-selection';

/*
 * 게임 화면 래퍼.
 *
 * 게임 저장과 운영 종료는 서로 다른 멱등 키를 쓴다 — page가 둘을 따로 만들어 내려준다.
 */
export function GameScreen({
  endOperationId,
  events,
  operationId,
  pools,
  records,
}: {
  endOperationId: string;
  events: AdminCatalogRecords['events'];
  operationId: string;
  pools: AdminCatalogRecords['cardPools'];
  records: AdminCatalogRecords['games'];
}) {
  const { selected, select } = useSelectedRecord(records);

  return (
    <GameSection
      endOperationId={endOperationId}
      events={events}
      onSelect={select}
      operationId={operationId}
      pools={pools}
      records={records}
      selected={selected}
    />
  );
}
