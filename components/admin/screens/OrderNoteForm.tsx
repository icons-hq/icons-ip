'use client';

import { useActionState, useState } from 'react';
import { addOrderNoteAction, type AdminOrderNoteState } from '@/app/admin/order-note-actions';
import { MAX_ORDER_NOTE_LENGTH } from '@/lib/admin/order-detail';
import { AdminField } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Textarea } from '@/components/admin/kit/ui/textarea';

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
  return <form action={action} className="flex flex-col items-start gap-4">
    <input name="orderId" type="hidden" value={orderId} />
    <input name="operationId" type="hidden" value={operationId} />
    <div className="w-full">
      <AdminField label="메모 내용" inputId="order-note-body" hint="운영팀만 볼 수 있습니다. 고객에게 전달되지 않습니다." error={state.error}>
        <Textarea id="order-note-body" name="body" rows={4} maxLength={MAX_ORDER_NOTE_LENGTH} required
          className="min-h-30 resize-y"
          value={body} disabled={pending} aria-invalid={Boolean(state.error)}
          aria-describedby={`order-note-body-hint${state.error ? ' order-note-body-error' : ''}`}
          onChange={(event) => { setBody(event.target.value); setOperationId(crypto.randomUUID()); }} />
      </AdminField>
    </div>
    {state.message ? <p className="text-sm text-[var(--wc-success)]" role="status">{state.message}</p> : null}
    <Button disabled={pending} type="submit">{pending ? '저장 중' : '운영자 메모 저장'}</Button>
  </form>;
}
