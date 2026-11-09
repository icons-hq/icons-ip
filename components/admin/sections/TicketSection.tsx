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
import { Field, FormShell, SelectField } from '../fields';
import { statusTone } from '@/lib/admin/status-tone';
import { MasterDetail, ReadOnlyField, RecordDetailPane, RecordFormHeading, SECTION_CARD } from './SectionLayout';
import { RecordMasterList } from './RecordMasterList';
import { RecordStatusLabel } from './RecordStatusLabel';

const emptyTicketState: AdminCatalogActionState = {};

const ALLOCATION_LABELS = { empty: '정원 0', full: '정원 마감', open: '잔여 있음' } as const;

function allocationState(record: AdminTicketTypeRecord): keyof typeof ALLOCATION_LABELS {
  if (record.capacity === 0) return 'empty';
  return record.sold >= record.capacity ? 'full' : 'open';
}

export function TicketSection({
  creating = false,
  draftId,
  eventOptions,
  onClose,
  onSelect,
  operationId,
  records,
  selected,
}: {
  /** 새 회차 입력 칸을 연 상태. 고른 회차도 없고 이 값도 꺼져 있으면 오른쪽은 안내만 보인다. */
  creating?: boolean;
  draftId: string;
  eventOptions: { id: string; title: string; archivedAt: string | null }[];
  onClose?: () => void;
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
      {/* 처음 열면 왼쪽 목록과 안내만 보이고 주 행동은 화면 머리의 등록 버튼 하나다(카드·이벤트와 같은 배치). */}
      <MasterDetail
        list={(
          <RecordMasterList
            activeId={selected?.id ?? null}
            ariaLabel="티켓 회차 목록"
            emptyMessage="등록된 티켓 회차가 없습니다."
            items={records}
            labelFor={(record) => <RecordStatusLabel detail={record.eventTitle} name={record.name} status={allocationState(record) === 'open' ? `잔여 ${(record.capacity - record.sold).toLocaleString('ko-KR')}` : ALLOCATION_LABELS[allocationState(record)]} tone={statusTone('ticketAllocation', allocationState(record))} title={`${record.eventTitle} · ${record.name} · ${record.sold}/${record.capacity}`} />}
            onSelect={onSelect}
          />
        )}
      >
        <RecordDetailPane hint="새 티켓 회차는 오른쪽 위 티켓 회차 등록 버튼으로 만듭니다." open={Boolean(selected) || creating} prompt="목록에서 티켓 회차를 고르면 여기에서 수정합니다.">
          <TicketForm
            draftId={draftId}
            eventOptions={eventOptions}
            key={`${id}-${operationId}-${selected?.updatedAt ?? 'new'}`}
            onClose={onClose}
            operationId={operationId}
            selected={selected}
          />
        </RecordDetailPane>
      </MasterDetail>
    </div>
  );
}

function TicketForm({
  draftId,
  eventOptions,
  onClose,
  operationId,
  selected,
}: {
  draftId: string;
  eventOptions: { id: string; title: string; archivedAt: string | null }[];
  onClose?: () => void;
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
      <RecordFormHeading editing={selected?.name ?? null} noun="티켓 회차" onClose={onClose} />

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
      {/* 새 회차의 연결 이벤트는 목록 첫 이벤트가 미리 골라져 있다(기본값은 그대로). 예매가 시작되면 이벤트를 못 바꾸므로 저장 직전에 확인시킨다. */}
      {!selected && !noEvents && <AdminNotice tone="warning">연결 이벤트가 목록의 첫 이벤트로 미리 선택되어 있습니다. 예매가 시작되면 바꿀 수 없으니 저장 전에 맞는 이벤트인지 확인해주세요.</AdminNotice>}
      <FormShell disabled={noEvents && !selected} pending={pending} state={state} />
    </form>
  );
}
