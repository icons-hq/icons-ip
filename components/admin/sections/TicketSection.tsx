'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  upsertAdminTicketTypeAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import type { AdminTicketTypeRecord } from '@/lib/admin/catalog.server';
import { Field, FormShell, RecordList, SelectField } from '../fields';

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
  eventOptions: { id: string; title: string }[];
  onSelect: (record: AdminTicketTypeRecord | null) => void;
  operationId: string;
  records: AdminTicketTypeRecord[];
  selected: AdminTicketTypeRecord | null;
}) {
  const id = selected?.id ?? draftId;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between', padding: 16 }}>
        <div>
          <strong>현장 티켓 검표</strong>
          <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 4 }}>
            모바일 카메라나 현장 스캐너로 입장 티켓을 확인합니다.
          </div>
        </div>
        <Link className="btn btn-holo" href="/admin/check-in">현장 검표 화면 열기</Link>
      </div>
      <div className="admin-master-detail">
        <RecordList
          activeId={selected?.id ?? null}
          ariaLabel="티켓 회차 목록"
          emptyMessage="등록된 티켓 회차가 없습니다."
          items={records}
          labelFor={(record) => `${record.eventTitle} · ${record.name} · ${record.sold}/${record.capacity}`}
          onNew={() => onSelect(null)}
          onSelect={onSelect}
        />
        <TicketForm
          draftId={draftId}
          eventOptions={eventOptions}
          key={`${id}-${operationId}-${selected?.updatedAt ?? 'new'}`}
          operationId={operationId}
          selected={selected}
        />
      </div>
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
  eventOptions: { id: string; title: string }[];
  operationId: string;
  selected: AdminTicketTypeRecord | null;
}) {
  const [state, action, pending] = useActionState(upsertAdminTicketTypeAction, emptyTicketState);
  const id = selected?.id ?? draftId;
  const sold = selected?.sold ?? 0;
  const metadataLocked = selected?.hasTicketHistory ?? false;
  const noEvents = eventOptions.length === 0;
  const eventLabelId = `ticket-event-${id}`;

  return (
    <form
      action={action}
      className="card col"
      style={{ borderRadius: 10, gap: 14, padding: 18 }}
    >
      <input name="operationId" type="hidden" value={operationId} />
      <input name="id" type="hidden" value={id} />

      {selected && (
        <div className="card row" style={{ flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', padding: 14 }}>
          <strong>{allocationStatus(selected)}</strong>
          <span>할당 {selected.sold} / {selected.capacity}</span>
          <span>잔여 {Math.max(0, selected.capacity - selected.sold)}</span>
          <span style={{ color: 'var(--dim)', fontSize: 12 }}>결제 대기 포함</span>
        </div>
      )}

      {noEvents && !selected && (
        <div className="card" role="status" style={{ padding: 12 }}>
          먼저 이벤트를 등록해주세요.
        </div>
      )}

      <div className="admin-form-grid">
        {metadataLocked && selected ? (
          <div className="col" style={{ gap: 7 }}>
            <span className="mono" id={eventLabelId} style={{ color: 'var(--dim)', fontSize: 11 }}>연결 이벤트</span>
            <input name="eventId" type="hidden" value={selected.eventId} />
            <div
              aria-labelledby={eventLabelId}
              aria-readonly="true"
              className="admin-field-control"
              role="textbox"
              style={{ alignItems: 'center', display: 'flex', minHeight: 42, padding: '0 12px' }}
            >
              {selected.eventTitle}
            </div>
          </div>
        ) : (
          <SelectField
            defaultValue={selected?.eventId ?? eventOptions[0]?.id ?? ''}
            error={state.errors?.eventId}
            label="연결 이벤트"
            name="eventId"
            required
          >
            {eventOptions.map((event) => (
              <option key={event.id} value={event.id}>{event.title}</option>
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
      </div>

      {metadataLocked && (
        <p style={{ color: 'var(--dim)', fontSize: 12, margin: 0 }}>
          예매 이력이 있어 이벤트·회차명·가격은 잠겼습니다. 정원만 현재 할당 수량 이상으로 조정할 수 있습니다.
        </p>
      )}
      <FormShell disabled={noEvents && !selected} pending={pending} state={state} />
    </form>
  );
}
