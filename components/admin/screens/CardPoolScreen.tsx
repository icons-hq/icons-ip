'use client';

import { CardPoolSection } from '@/components/admin/sections/CardPoolSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import { useSelectedRecord } from './record-selection';

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
  ipOptions,
  oddsOperationId,
  operationId,
  records,
}: {
  cards: AdminCatalogRecords['cards'];
  draftActiveFrom: string;
  draftId: string;
  /** IP 선택지 — 상위 N + 화면의 풀이 참조하는 IP(규모 후속). 전량이 아니다. */
  ipOptions: AdminCurationTargetRecord[];
  oddsOperationId: string;
  operationId: string;
  records: AdminCatalogRecords['cardPools'];
}) {
  const { selected, select } = useSelectedRecord(records);

  return (
    <CardPoolSection
      cards={cards}
      draftActiveFrom={draftActiveFrom}
      draftId={draftId}
      ipOptions={ipOptions}
      oddsOperationId={oddsOperationId}
      onSelect={select}
      operationId={operationId}
      records={records}
      selected={selected}
    />
  );
}
