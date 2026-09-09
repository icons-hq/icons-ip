'use client';

import { useActionState, useState } from 'react';
import { addOrderNoteAction, type AdminOrderNoteState } from '@/app/admin/order-note-actions';
import { MAX_ORDER_NOTE_LENGTH } from '@/lib/admin/order-detail';
import { AdminField } from '@/components/admin/console/AdminKit';

const EMPTY_STATE: AdminOrderNoteState = {};
export function OrderNoteForm({ orderId, initialOperationId }: { orderId: string; initialOperationId: string }) {
  const [state, action, pending] = useActionState(addOrderNoteAction, EMPTY_STATE);
  const [body, setBody] = useState('');
  const [operationId, setOperationId] = useState(initialOperationId);
  const [clearedKey, setClearedKey] = useState<string | null>(null);
  if (state.resultKey && state.resultKey !== clearedKey) {
    setClearedKey(state.resultKey);
    setBody('');
    setOperationId(state.resultKey);
  }
  return <form action={action} className="admin-order-detail__note">
    <input name="orderId" type="hidden" value={orderId} />
    <input name="operationId" type="hidden" value={operationId} />
    <AdminField label="메모 내용" inputId="order-note-body" hint="운영팀만 볼 수 있습니다. 고객에게 전달되지 않습니다." error={state.error}>
      <textarea id="order-note-body" name="body" rows={4} maxLength={MAX_ORDER_NOTE_LENGTH} required
        value={body} disabled={pending} aria-invalid={Boolean(state.error)}
        aria-describedby={`order-note-body-hint${state.error ? ' order-note-body-error' : ''}`}
        onChange={(event) => { setBody(event.target.value); setOperationId(crypto.randomUUID()); }} />
    </AdminField>
    {state.message ? <p role="status">{state.message}</p> : null}
    <button className="admin-order-detail__button" disabled={pending} type="submit">{pending ? '저장 중' : '운영자 메모 저장'}</button>
  </form>;
}
