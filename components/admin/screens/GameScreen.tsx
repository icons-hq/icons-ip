'use client';

import { useState } from 'react';
import { GameSection } from '@/components/admin/sections/GameSection';
import type { AdminCatalogRecords, AdminGameRecord } from '@/lib/admin/catalog.server';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = records.find((game) => game.id === selectedId) ?? null;

  return (
    <GameSection
      endOperationId={endOperationId}
      events={events}
      onSelect={(game: AdminGameRecord | null) => setSelectedId(game?.id ?? null)}
      operationId={operationId}
      pools={pools}
      records={records}
      selected={selected}
    />
  );
}
