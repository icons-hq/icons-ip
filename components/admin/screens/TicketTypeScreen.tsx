'use client';

import { useMemo, useState } from 'react';
import { TicketSection } from '@/components/admin/sections/TicketSection';
import type { AdminCatalogRecords, AdminTicketTypeRecord } from '@/lib/admin/catalog.server';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const eventOptions = useMemo(
    () => events.map((event) => ({ id: event.id, title: event.title, archivedAt: event.archivedAt })),
    [events],
  );
  const selected = records.find((ticketType) => ticketType.id === selectedId) ?? null;

  return (
    <TicketSection
      draftId={draftId}
      eventOptions={eventOptions}
      onSelect={(ticketType: AdminTicketTypeRecord | null) => setSelectedId(ticketType?.id ?? null)}
      operationId={operationId}
      records={records}
      selected={selected}
    />
  );
}
