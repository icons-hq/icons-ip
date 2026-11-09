'use client';

import { AdminFormGrid, AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import Link from 'next/link';
import { useActionState } from 'react';
import { ScanLine } from 'lucide-react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import {
  upsertAdminTicketTypeAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import type { AdminTicketTypeRecord } from '@/lib/admin/catalog.server';
import { Field, FormShell, RecordList, SelectField } from '../fields';
import { statusTone } from '@/lib/admin/status-tone';
import { MasterDetail, ReadOnlyField, RecordFormHeading, SECTION_CARD } from './SectionLayout';
import { RecordStatusLabel } from './RecordStatusLabel';

const emptyTicketState: AdminCatalogActionState = {};

const ALLOCATION_LABELS = { empty: '정원 0', full: '정원 마감', open: '잔여 있음' } as const;

function allocationState(record: AdminTicketTypeRecord): keyof typeof ALLOCATION_LABELS {
  if (record.capacity === 0) return 'empty';
  return record.sold >= record.capacity ? 'full' : 'open';
}

export function TicketSection({
  draftId,
  eventOptions,
  onSelect,
  operationId,
  records,
  selected,
}: {
  draftId: string;
  eventOptions: { id: string; title: string; archivedAt: string | null }[];
  onSelect: (record: AdminTicketTypeRecord | null) => void;
  operationId: string;
  records: AdminTicketTypeRecord[];
  selected: AdminTicketTypeRecord | null;
}) {
  const id = selected?.id ?? draftId;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm text-card-foreground sm:px-5">
        <p className="min-w-0"><strong className="font-semibold">현장 티켓 검표</strong> <span className="text-muted-foreground">· 모바일 카메라나 현장 스캐너로 입장 티켓을 확인합니다.</span></p>
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin/check-in">
          <ScanLine aria-hidden="true" />현장 검표 화면 열기
        </Link>
      </div>
      <MasterDetail
        list={(
          <RecordList
            activeId={selected?.id ?? null}
            ariaLabel="티켓 회차 목록"
            emptyMessage="등록된 티켓 회차가 없습니다."
            items={records}
            labelFor={(record) => <RecordStatusLabel detail={record.eventTitle} name={record.name} status={allocationState(record) === 'open' ? `잔여 ${(record.capacity - record.sold).toLocaleString('ko-KR')}` : ALLOCATION_LABELS[allocationState(record)]} tone={statusTone('ticketAllocation', allocationState(record))} title={`${record.eventTitle} · ${record.name} · ${record.sold}/${record.capacity}`} />}
            onNew={() => onSelect(null)}
            onSelect={onSelect}
          />
        )}
      >
        <TicketForm
          draftId={draftId}
          eventOptions={eventOptions}
          key={`${id}-${operationId}-${selected?.updatedAt ?? 'new'}`}
          operationId={operationId}
          selected={selected}
        />
      </MasterDetail>
    </div>
  );
}

function TicketForm({
  draftId,
  eventOptions,
  operationId,
  selected,
}: {
  draftId: string;
  eventOptions: { id: string; title: string; archivedAt: string | null }[];
  operationId: string;
  selected: AdminTicketTypeRecord | null;
}) {
  const [state, action, pending] = useActionState(upsertAdminTicketTypeAction, emptyTicketState);
  const id = selected?.id ?? draftId;
  const sold = selected?.sold ?? 0;
  const metadataLocked = selected?.hasTicketHistory ?? false;
  const noEvents = !eventOptions.some((event) => !event.archivedAt || event.id === selected?.eventId);
  const initialEventId = selected?.eventId ?? eventOptions.find((event) => !event.archivedAt)?.id ?? '';
  const eventLabelId = `ticket-event-${id}`;

  return (
    <form
      action={action}
      className={SECTION_CARD}
    >
      <input name="operationId" type="hidden" value={operationId} />
      <input name="id" type="hidden" value={id} />
      <RecordFormHeading editing={selected?.name ?? null} noun="티켓 회차" />

      {selected && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
          <AdminStatusBadge tone={statusTone('ticketAllocation', allocationState(selected))}>{ALLOCATION_LABELS[allocationState(selected)]}</AdminStatusBadge>
          <span className="tabular-nums">할당 {selected.sold} / {selected.capacity}</span>
          <span className="tabular-nums">잔여 {Math.max(0, selected.capacity - selected.sold)}</span>
          <span className="text-xs text-muted-foreground">결제 대기 포함</span>
        </div>
      )}

      {noEvents && !selected && <AdminNotice role="status" tone="warning">먼저 이벤트를 등록해주세요.</AdminNotice>}

      <AdminFormGrid>
        {metadataLocked && selected ? (
          <ReadOnlyField label="연결 이벤트" labelId={eventLabelId} name="eventId" value={selected.eventId}>
            {selected.eventTitle}
          </ReadOnlyField>
        ) : (
          <SelectField
            defaultValue={initialEventId}
            error={state.errors?.eventId}
            label="연결 이벤트"
            name="eventId"
            required
          >
            <option value="">선택</option>
            {eventOptions.map((event) => (
              <option
                disabled={Boolean(event.archivedAt && event.id !== selected?.eventId)}
                key={event.id}
                value={event.id}
              >
                {event.archivedAt ? `[보관] ${event.title}` : event.title}
              </option>
            ))}
          </SelectField>
        )}
        <Field
          defaultValue={selected?.name}
          error={state.errors?.name}
          label="회차명"
          name="name"
          readOnly={metadataLocked}
          required
        />
        <Field
          defaultValue={selected?.price ?? 0}
          error={state.errors?.price}
          label="가격 (KRW)"
          min={0}
          name="price"
          readOnly={metadataLocked}
          required
          step={1}
          type="number"
        />
        <Field
          defaultValue={selected?.capacity ?? 0}
          error={state.errors?.capacity}
          label="정원"
          min={sold}
          name="capacity"
          required
          step={1}
          type="number"
        />
      </AdminFormGrid>

      {metadataLocked && <AdminNotice tone="info">예매 이력이 있어 이벤트·회차명·가격은 잠겼습니다. 정원만 현재 할당 수량 이상으로 조정할 수 있습니다.</AdminNotice>}
      <FormShell disabled={noEvents && !selected} pending={pending} state={state} />
    </form>
  );
}
