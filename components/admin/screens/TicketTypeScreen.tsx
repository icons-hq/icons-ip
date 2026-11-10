'use client';

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { useMemo } from 'react';
import { TicketSection } from '@/components/admin/sections/TicketSection';
import { RecordNewButton, useRecordDetail } from '@/components/admin/sections/RecordMasterList';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';

/*
 * 티켓 회차 화면 래퍼.
 *
 * 회차 저장이 멱등 키를 쓰므로 `draftId`·`operationId`는 page가 만들어 내려준다.
 */
export function TicketTypeScreen({
  draftId,
  events,
  operationId,
  records,
}: {
  draftId: string;
  events: AdminCatalogRecords['events'];
  operationId: string;
  records: AdminCatalogRecords['ticketTypes'];
}) {
  const eventOptions = useMemo(
    () => events.map((event) => ({ id: event.id, title: event.title, archivedAt: event.archivedAt })),
    [events],
  );
  const detail = useRecordDetail(records);

  return (
    <div className="flex min-w-0 flex-col gap-6"><AdminPageHeader title="티켓 회차" description="이벤트별 티켓 가격과 정원을 관리합니다." actions={<RecordNewButton label="티켓 회차 등록" onClick={detail.startNew} open={detail.open} />} />
    <TicketSection
      creating={detail.creating}
      draftId={draftId}
      eventOptions={eventOptions}
      onClose={detail.close}
      onSelect={detail.select}
      operationId={operationId}
      records={records}
      selected={detail.selected}
    /></div>
  );
}
