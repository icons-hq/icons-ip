'use client';

import { useActionState } from 'react';
import {
  addOrderNoteAction,
  createOrderShipmentAction,
  deliverOrderShipmentAction,
  recordOrderExternalRefAction,
  removeOrderExternalRefAction,
  setOrderNotePinnedAction,
  shipOrderShipmentAction,
  type AdminOrderActionState,
} from '@/app/admin/order-actions';
import { Field, SelectField, TextArea } from '@/components/admin/fields';
import {
  describeStatusEvent,
  FULFILLMENT_STATE_LABELS,
  ORDER_EXTERNAL_REF_KINDS,
  ORDER_EXTERNAL_REF_LABELS,
  ORDER_NOTE_KINDS,
  ORDER_NOTE_MAX_LENGTH,
  ORDER_NOTE_SYSTEM_LABELS,
  SHIPMENT_STATUS_LABELS,
  type AdminOrderRecordPanel as RecordPanelData,
  type AdminOrderShipment,
} from '@/lib/admin/order-records';
import { ADMIN_ORDER_STATUS_LABELS } from '@/lib/admin/orders';
import { formatOrderDateTime } from '@/lib/orders';
import { SeededForm } from '@/components/admin/form-seed';

/*
 * 주문 기록 패널 (D-3).
 *
 * 세 자료를 나란히 둔다 — 사람이 남긴 말(메모) · 시스템이 남긴 사실(상태 이력) ·
 * 다른 시스템이 부르는 이름(외부 참조). 순서가 곧 신뢰도다: 무슨 일이 있었는지는
 * 상태 이력이 답하고, 왜 그랬는지는 메모가 답한다.
 */

const emptyState: AdminOrderActionState = {};

function ActionMessage({ state }: { state: AdminOrderActionState }) {
  if (state.errors?.form) return <p className="admin-form-error" role="alert">{state.errors.form}</p>;
  if (state.message) return <p className="muted" style={{ fontSize: 12, margin: 0 }}>{state.message}</p>;
  return null;
}

function NoteForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(addOrderNoteAction, emptyState);
  return (
    <SeededForm values={state.values} action={action} className="col" style={{ gap: 8 }}>
      <input name="orderId" type="hidden" value={orderId} />
      <TextArea
        error={state.errors?.body}
        label="메모"
        maxLength={ORDER_NOTE_MAX_LENGTH}
        name="body"
        placeholder="고객 요청·통화 내용·처리 근거를 남깁니다. 남긴 메모는 고칠 수 없습니다."
        required
      />
      <div className="admin-form-grid">
        <SelectField error={state.errors?.kind} label="종류" name="kind">
          {ORDER_NOTE_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
        </SelectField>
        <label className="admin-variant-value">
          <input name="pinned" type="checkbox" /> 목록에 고정 (주문당 하나)
        </label>
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <button className="btn btn-sm btn-holo" disabled={pending} type="submit">메모 남기기</button>
        <ActionMessage state={state} />
      </div>
    </SeededForm>
  );
}

function PinToggle({ noteId, orderId, pinned }: { noteId: string; orderId: string; pinned: boolean }) {
  const [state, action, pending] = useActionState(setOrderNotePinnedAction, emptyState);
  return (
    <SeededForm values={state.values} action={action}>
      <input name="noteId" type="hidden" value={noteId} />
      <input name="orderId" type="hidden" value={orderId} />
      {pinned ? null : <input name="pinned" type="hidden" value="on" />}
      <button className="btn btn-xs btn-ghost" disabled={pending} type="submit" title={state.errors?.form}>
        {pinned ? '고정 풀기' : '고정'}
      </button>
    </SeededForm>
  );
}

function ExternalRefForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(recordOrderExternalRefAction, emptyState);
  return (
    <SeededForm values={state.values} action={action} className="col" style={{ gap: 8 }}>
      <input name="orderId" type="hidden" value={orderId} />
      <div className="admin-form-grid">
        <SelectField error={state.errors?.kind} label="번호 종류" name="kind">
          {ORDER_EXTERNAL_REF_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
        </SelectField>
        <Field error={state.errors?.value} label="번호" name="value" placeholder="저쪽 시스템이 부르는 번호" required />
        <Field error={state.errors?.note} label="메모 (선택)" name="note" placeholder="어디서 받은 번호인지" />
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <button className="btn btn-sm btn-ghost" disabled={pending} type="submit">번호 기록</button>
        <ActionMessage state={state} />
      </div>
    </SeededForm>
  );
}

function RemoveRefButton({ orderId, refId }: { orderId: string; refId: string }) {
  const [state, action, pending] = useActionState(removeOrderExternalRefAction, emptyState);
  return (
    <SeededForm values={state.values} action={action}>
      <input name="orderId" type="hidden" value={orderId} />
      <input name="refId" type="hidden" value={refId} />
      <button className="btn btn-xs btn-ghost" disabled={pending} type="submit" title={state.errors?.form}>지우기</button>
    </SeededForm>
  );
}


function ShipmentActions({ orderId, shipment }: { orderId: string; shipment: AdminOrderShipment }) {
  const [shipState, shipAction, shipPending] = useActionState(shipOrderShipmentAction, emptyState);
  const [deliverState, deliverAction, deliverPending] = useActionState(deliverOrderShipmentAction, emptyState);

  if (shipment.status === 'ready') {
    return (
      <SeededForm values={shipState.values} action={shipAction} className="row" style={{ alignItems: 'center', gap: 6 }}>
        <input name="orderId" type="hidden" value={orderId} />
        <input name="shipmentId" type="hidden" value={shipment.id} />
        {shipment.trackingNumber ? null : (
          <>
            <input aria-label="택배사 코드" name="carrier" placeholder="택배사" style={{ width: 90 }} />
            <input aria-label="송장번호" name="tracking" placeholder="송장번호" style={{ width: 140 }} />
          </>
        )}
        <button className="btn btn-xs btn-holo" disabled={shipPending} type="submit" title={shipState.errors?.form}>보냄</button>
        {shipState.errors?.form ? <span className="admin-form-error">{shipState.errors.form}</span> : null}
      </SeededForm>
    );
  }
  if (shipment.status === 'shipped') {
    return (
      <SeededForm values={deliverState.values} action={deliverAction}>
        <input name="orderId" type="hidden" value={orderId} />
        <input name="shipmentId" type="hidden" value={shipment.id} />
        <button className="btn btn-xs btn-ghost" disabled={deliverPending} type="submit" title={deliverState.errors?.form}>도착</button>
      </SeededForm>
    );
  }
  return null;
}

function NewShipmentForm({
  orderId,
  pending,
}: {
  orderId: string;
  /** 아직 안 나갔고 취소되지 않은 수량. 여기 없는 품목은 담을 것이 없다는 뜻이다. */
  pending: { orderItemId: string; itemNo: string; name: string; remaining: number }[];
}) {
  const [state, action, formPending] = useActionState(createOrderShipmentAction, emptyState);
  if (pending.length === 0) {
    return <p className="muted" style={{ fontSize: 12, margin: 0 }}>남은 수량이 없습니다.</p>;
  }
  return (
    <SeededForm values={state.values} action={action} className="col" style={{ gap: 8 }}>
      <input name="orderId" type="hidden" value={orderId} />
      {pending.map((line) => (
        <label className="row" key={line.orderItemId} style={{ alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span className="mono faint" style={{ minWidth: 130 }}>{line.itemNo}</span>
          <span style={{ flex: 1, minWidth: 0 }}>{line.name}</span>
          <input
            aria-label={`${line.name} 보낼 수량`}
            defaultValue={line.remaining}
            max={line.remaining}
            min={0}
            name={`qty:${line.orderItemId}`}
            style={{ width: 70 }}
            type="number"
          />
          <span className="faint">/ {line.remaining}</span>
        </label>
      ))}
      <div className="admin-form-grid">
        <Field label="택배사 코드" name="carrier" placeholder="hanjin" />
        <Field label="송장번호" name="tracking" placeholder="영문 대문자·숫자 8~30자" />
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <button className="btn btn-sm btn-ghost" disabled={formPending} type="submit">출고 만들기</button>
        <ActionMessage state={state} />
      </div>
    </SeededForm>
  );
}

export function OrderRecordPanel({
  fulfillmentState,
  itemNos,
  pendingLines,
  record,
}: {
  /** `order_fulfillment_view` 가 파생한 이행 상태. 헤더 enum 은 7값 그대로다. */
  fulfillmentState: string | null;
  itemNos: string[];
  pendingLines: { orderItemId: string; itemNo: string; name: string; remaining: number }[];
  record: RecordPanelData;
}) {
  return (
    <>
      <section className="admin-order-detail-section" aria-labelledby="admin-order-shipments-title">
        <h3 id="admin-order-shipments-title">
          출고{fulfillmentState ? ` · ${FULFILLMENT_STATE_LABELS[fulfillmentState] ?? fulfillmentState}` : ''}
        </h3>
        {record.shipments.length > 0 ? (
          <ul className="admin-order-refs">
            {record.shipments.map((shipment) => (
              <li className="row" key={shipment.id} style={{ alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <span>
                  <strong className="mono">{shipment.shipmentNo}</strong>{' '}
                  <span>{SHIPMENT_STATUS_LABELS[shipment.status] ?? shipment.status}</span>
                  {shipment.trackingNumber ? (
                    <span className="faint"> · {shipment.carrierLabel ?? shipment.carrier} {shipment.trackingNumber}</span>
                  ) : null}
                  <span className="faint">
                    {' · '}
                    {shipment.items.map((item) => `${item.name} ${item.qty}개`).join(' · ')}
                  </span>
                </span>
                <ShipmentActions orderId={record.orderId} shipment={shipment} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>아직 만든 출고가 없습니다.</p>
        )}
        <NewShipmentForm orderId={record.orderId} pending={pendingLines} />
      </section>

      <section className="admin-order-detail-section" aria-labelledby="admin-order-refs-title">
        <h3 id="admin-order-refs-title">번호</h3>
        {itemNos.length > 0 ? (
          <p className="faint mono" style={{ fontSize: 12, margin: '0 0 8px' }}>
            품목 {itemNos.join(' · ')}
          </p>
        ) : null}
        {record.externalRefs.length > 0 ? (
          <ul className="admin-order-refs">
            {record.externalRefs.map((ref) => (
              <li className="row" key={ref.id} style={{ alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <span>
                  <strong>{ORDER_EXTERNAL_REF_LABELS[ref.kind] ?? ref.kind}</strong>{' '}
                  <span className="mono">{ref.value}</span>
                  {ref.note ? <span className="faint"> · {ref.note}</span> : null}
                  <span className="faint"> · {ref.recordedByName} · {formatOrderDateTime(ref.recordedAt)}</span>
                </span>
                <RemoveRefButton orderId={record.orderId} refId={ref.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>ERP·사방넷이 돌려준 번호가 아직 없습니다.</p>
        )}
        <ExternalRefForm orderId={record.orderId} />
      </section>

      <section className="admin-order-detail-section" aria-labelledby="admin-order-notes-title">
        <h3 id="admin-order-notes-title">관리자 메모</h3>
        {record.notes.length > 0 ? (
          <ul className="admin-order-notes">
            {record.notes.map((note) => (
              <li className="col" key={note.id} style={{ gap: 4 }}>
                <div className="row" style={{ alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                  <span className="faint" style={{ fontSize: 11 }}>
                    {note.pinned ? '고정 · ' : ''}
                    {ORDER_NOTE_SYSTEM_LABELS[note.kind] ?? note.kind} · {note.authorName} · {formatOrderDateTime(note.createdAt)}
                  </span>
                  <PinToggle noteId={note.id} orderId={record.orderId} pinned={note.pinned} />
                </div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{note.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>남긴 메모가 없습니다.</p>
        )}
        <NoteForm orderId={record.orderId} />
      </section>

      <section className="admin-order-detail-section" aria-labelledby="admin-order-timeline-title">
        <h3 id="admin-order-timeline-title">상태 이력</h3>
        {record.statusEvents.length > 0 ? (
          <ol className="admin-order-timeline">
            {record.statusEvents.map((event) => (
              <li key={event.id}>
                <span>{describeStatusEvent(event, ADMIN_ORDER_STATUS_LABELS)}</span>
                <span className="faint"> · {event.actorName} · {formatOrderDateTime(event.occurredAt)}</span>
                {event.note ? <span className="faint"> · {event.note}</span> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>기록된 상태 변경이 없습니다.</p>
        )}
      </section>
    </>
  );
}
