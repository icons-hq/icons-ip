'use client';

import { AdminFormGrid } from '@/components/admin/console/AdminKit';
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
import { MasterDetail, ReadOnlyField, SECTION_CARD, SECTION_NOTE, SectionHeading } from './SectionLayout';

const emptyTicketState: AdminCatalogActionState = {};

function allocationStatus(record: AdminTicketTypeRecord) {
  if (record.capacity === 0) return '정원 0';
  if (record.sold >= record.capacity) return '정원 마감';
  return '잔여 있음';
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
      <div className={SECTION_CARD}>
        <SectionHeading
          action={(
            <Link className={buttonVariants()} data-slot="button" href="/admin/check-in">
              <ScanLine aria-hidden="true" />현장 검표 화면 열기
            </Link>
          )}
          description="모바일 카메라나 현장 스캐너로 입장 티켓을 확인합니다."
          title="현장 티켓 검표"
        />
      </div>
      <MasterDetail
        list={(
          <RecordList
            activeId={selected?.id ?? null}
            ariaLabel="티켓 회차 목록"
            emptyMessage="등록된 티켓 회차가 없습니다."
            items={records}
            labelFor={(record) => `${record.eventTitle} · ${record.name} · ${record.sold}/${record.capacity}`}
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

      {selected && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
          <strong className="font-semibold text-foreground">{allocationStatus(selected)}</strong>
          <span className="tabular-nums">할당 {selected.sold} / {selected.capacity}</span>
          <span className="tabular-nums">잔여 {Math.max(0, selected.capacity - selected.sold)}</span>
          <span className="text-xs text-muted-foreground">결제 대기 포함</span>
        </div>
      )}

      {noEvents && !selected && (
        <div className={SECTION_NOTE} role="status">
          먼저 이벤트를 등록해주세요.
        </div>
      )}

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

      {metadataLocked && (
        <p className="text-sm text-muted-foreground">
          예매 이력이 있어 이벤트·회차명·가격은 잠겼습니다. 정원만 현재 할당 수량 이상으로 조정할 수 있습니다.
        </p>
      )}
      <FormShell disabled={noEvents && !selected} pending={pending} state={state} />
    </form>
  );
}
