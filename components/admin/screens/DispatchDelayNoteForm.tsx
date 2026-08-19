'use client';

import { useActionState } from 'react';
import {
  saveAdminOrderDispatchDelayAction,
  type AdminOrderActionState,
} from '@/app/admin/order-actions';
import {
  ADMIN_DISPATCH_DELAY_REASON_MAX,
  type AdminDispatchDelayNote,
} from '@/lib/admin/dispatch';

const EMPTY_ACTION_STATE: AdminOrderActionState = {};

/**
 * 발송지연 메모 (#251).
 *
 * v1의 지연은 상태가 아니라 메모다. 자사몰이라 지연에 붙는 페널티가 없고,
 * 사다리에 칸을 만들면 발송처리 때 되돌려야 하는 전이가 생긴다.
 *
 * 사유를 비워 저장하면 메모가 지워진다. 해제 수단이 없으면 운영자는 사유를
 * '해결'로 덮어쓰고, 그러면 지연 목록이 영원히 줄지 않는다.
 *
 * 이 메모는 **운영 기록**이며 구매자에게 보이지 않는다. 지연 고지는 문구·기한·
 * 법적 함의가 따로 있는 별개 결정이다.
 */
export function DispatchDelayNoteForm({
  note,
  orderId,
  reference,
}: {
  note: AdminDispatchDelayNote | null;
  orderId: string;
  reference: string;
}) {
  const [state, action, pending] = useActionState(
    saveAdminOrderDispatchDelayAction,
    EMPTY_ACTION_STATE,
  );
  const fieldError = state.errors?.reason ?? state.errors?.expectedShipDate ?? state.errors?.form;

  return (
    <form action={action} className="admin-console-row-form">
      <input name="orderId" type="hidden" value={orderId} />
      <input
        aria-label={`주문 ${reference} 지연 사유`}
        defaultValue={note?.reason ?? ''}
        disabled={pending}
        maxLength={ADMIN_DISPATCH_DELAY_REASON_MAX}
        name="reason"
        placeholder="지연 사유 (비우면 해제)"
        type="text"
      />
      <input
        aria-label={`주문 ${reference} 발송 예정일`}
        defaultValue={note?.expectedShipDate ?? ''}
        disabled={pending}
        name="expectedShipDate"
        type="date"
      />
      <button className="btn btn-sm btn-ghost" disabled={pending} type="submit">
        {pending ? '저장 중' : '메모 저장'}
      </button>
      <div aria-live="polite" className="admin-order-action-feedback">
        {fieldError ? <span role="alert">{fieldError}</span> : null}
        {state.message ? <span role="status">{state.message}</span> : null}
      </div>
    </form>
  );
}
