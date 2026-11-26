'use client';

import { useActionState, useState } from 'react';
import { addOrderNoteAction, type AdminOrderNoteState } from '@/app/admin/order-note-actions';
import { MAX_ORDER_NOTE_LENGTH } from '@/lib/admin/order-detail';
import { AdminField } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';

const EMPTY_STATE: AdminOrderNoteState = {};
export function OrderNoteForm({ orderId, initialOperationId }: { orderId: string; initialOperationId: string }) {
  const [state, action, pending] = useActionState(addOrderNoteAction, EMPTY_STATE);
  useClaimPreviewBusy(pending); /* 목록 위 주문 상세 팝업(S36-075)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
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
      <AdminField label="메모 내용" inputId="order-note-body" hint="저장하면 주문 타임라인에 남습니다. 운영팀만 보고, 고객에게는 보이지 않습니다." error={state.error}>
        <Textarea id="order-note-body" name="body" rows={4} maxLength={MAX_ORDER_NOTE_LENGTH} required
          className="min-h-30 resize-y" placeholder="예: 11/26 고객이 전화로 배송 일정을 문의해 물류팀에 확인을 요청함"
          value={body} disabled={pending} aria-invalid={Boolean(state.error)}
          aria-describedby={`order-note-body-hint${state.error ? ' order-note-body-error' : ''}`}
          onChange={(event) => { setBody(event.target.value); setOperationId(crypto.randomUUID()); }} />
      </AdminField>
    </div>
    {state.message ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
    <Button disabled={pending} type="submit">{pending ? '저장 중' : '운영자 메모 저장'}</Button>
  </form>;
}
