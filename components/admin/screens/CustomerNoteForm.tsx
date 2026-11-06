'use client';
import { useActionState, useState } from 'react';
import { addCustomerNoteAction, type CustomerNoteState } from '@/app/admin/customer-actions';
import { AdminField } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { MAX_CUSTOMER_NOTE_LENGTH } from '@/lib/admin/customer-detail';

const EMPTY: CustomerNoteState = {};
export function CustomerNoteForm({ userId, initialOperationId }: { userId: string; initialOperationId: string }) {
  const [state, action, pending] = useActionState(addCustomerNoteAction, EMPTY);
  const [body, setBody] = useState('');
  const [operationId, setOperationId] = useState(initialOperationId);
  const [completed, setCompleted] = useState<string | undefined>();
  if (state.resultKey && completed !== state.resultKey) {
    setCompleted(state.resultKey); setBody(''); setOperationId(state.resultKey);
  }
  return <form action={action} className="flex flex-col gap-4 border-b pb-5">
    <input type="hidden" name="userId" value={userId} /><input type="hidden" name="operationId" value={operationId} />
    <AdminField label="내부 메모 내용" inputId="customer-note-body" hint="운영팀만 볼 수 있습니다. 고객에게 전달되지 않습니다." error={state.error}>
      <Textarea className="min-h-28" id="customer-note-body" name="body" rows={4} maxLength={MAX_CUSTOMER_NOTE_LENGTH} required disabled={pending}
        aria-invalid={Boolean(state.error)} aria-describedby={`customer-note-body-hint${state.error ? ' customer-note-body-error' : ''}`}
        value={body} onChange={(event) => { setBody(event.target.value); setOperationId(crypto.randomUUID()); }} />
    </AdminField>
    {state.message ? <p className="text-sm text-[var(--wc-success)]" role="status">{state.message}</p> : null}
    <Button className="self-start" disabled={pending} type="submit">{pending ? '저장 중' : '내부 메모 저장'}</Button>
  </form>;
}
