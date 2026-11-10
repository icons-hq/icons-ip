'use client';

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { GameSection } from '@/components/admin/sections/GameSection';
import { RecordNewButton, useRecordDetail } from '@/components/admin/sections/RecordMasterList';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';

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
  const detail = useRecordDetail(records);

  return (
    <div className="flex min-w-0 flex-col gap-6"><AdminPageHeader title="게임" description="공개 상태와 무상 리워드 구성을 관리합니다." actions={<RecordNewButton label="게임 등록" onClick={detail.startNew} open={detail.open} />} />
    <GameSection
      creating={detail.creating}
      endOperationId={endOperationId}
      events={events}
      onClose={detail.close}
      onSelect={detail.select}
      operationId={operationId}
      pools={pools}
      records={records}
      selected={detail.selected}
    /></div>
  );
}
