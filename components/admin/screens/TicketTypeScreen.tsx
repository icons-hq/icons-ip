'use client';

import { useMemo } from 'react';
import { TicketSection } from '@/components/admin/sections/TicketSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import { useSelectedRecord } from './record-selection';

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
  const { selected, select } = useSelectedRecord(records);

  return (
    <TicketSection
      draftId={draftId}
      eventOptions={eventOptions}
      onSelect={select}
      operationId={operationId}
      records={records}
      selected={selected}
    />
  );
}
