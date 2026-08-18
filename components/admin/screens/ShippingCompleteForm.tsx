'use client';

import { useActionState } from 'react';
import {
  updateAdminOrderStatusAction,
  type AdminOrderActionState,
} from '@/app/admin/order-actions';

const EMPTY_ACTION_STATE: AdminOrderActionState = {};

const DELIVERED_CONFIRMATION = '배송완료로 변경할까요? 이 시점부터 청약철회 기한이 시작되고 8일 뒤 자동으로 거래확정됩니다.';

/**
 * 수동 배송완료 처리 (#251).
 *
 * 택배사 추적 API 자동화는 물류 사양 확인(#177) 뒤의 일이다. 그때까지는 운영자가
 * 조회 링크로 확인하고 누른다.
 *
 * 확인 문구가 기한을 함께 말하는 이유: `delivered_at`은 전자상거래법 제17조의
 * 청약철회 기산점이다(#189). 실제 도착 전에 눌러 두면 고객의 철회 기간이 그만큼
 * 앞당겨진다 — 되돌리는 전이가 없으므로 누르기 전에 알아야 한다.
 */
export function ShippingCompleteForm({
  orderId,
  reference,
}: {
  orderId: string;
  reference: string;
}) {
  const [state, action, pending] = useActionState(updateAdminOrderStatusAction, EMPTY_ACTION_STATE);

  return (
    <form
      action={action}
      className="admin-console-row-form"
      data-confirm={DELIVERED_CONFIRMATION}
      onSubmit={(event) => {
        if (!window.confirm(DELIVERED_CONFIRMATION)) event.preventDefault();
      }}
    >
      <input name="orderId" type="hidden" value={orderId} />
      <input name="status" type="hidden" value="delivered" />
      <button
        aria-label={`주문 ${reference} 배송완료`}
        className="btn btn-sm"
        disabled={pending}
        type="submit"
      >
        {pending ? '처리 중' : '배송완료'}
      </button>
      <div aria-live="polite" className="admin-order-action-feedback">
        {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
        {state.message ? <span role="status">{state.message}</span> : null}
      </div>
    </form>
  );
}
