'use client';

import { useActionState } from 'react';
import {
  cancelUnpaidBankTransferOrderAction,
  confirmBankTransferDepositAction,
  extendBankTransferDeadlineAction,
  type AdminUnpaidActionState,
} from '../../app/admin/unpaid-actions';
import { ADMIN_UNPAID_MEMO_MAX, type AdminUnpaidOrderRow } from '../../lib/admin/unpaid';

const initialState: AdminUnpaidActionState = {};

/**
 * 선택한 미입금 주문의 처리 패널.
 *
 * 세 액션이 모두 근거를 요구한다. 확정은 돈이 들어왔다는 사람의 판단이고,
 * 연장은 재고를 하루 더 묶는 판단이며, 취소는 구매자의 주문을 없애는 판단이다 —
 * 셋 다 나중에 "왜 그랬나"를 물을 수 있어야 한다.
 */
export function UnpaidActionsPanel({ order }: { order: AdminUnpaidOrderRow }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmBankTransferDepositAction,
    initialState,
  );
  const [extendState, extendAction, extendPending] = useActionState(
    extendBankTransferDeadlineAction,
    initialState,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelUnpaidBankTransferOrderAction,
    initialState,
  );

  return (
    <section className="admin-panel admin-unpaid-actions" aria-label="미입금 주문 처리">
      <header>
        <h3>주문 {order.depositCode} 처리</h3>
        <p className="mono">{order.buyerName} · {order.itemSummary || '품목 정보 없음'}</p>
      </header>

      <form action={confirmAction} className="admin-unpaid-action">
        <input name="orderId" type="hidden" value={order.id} />
        <label>
          <span>입금 근거</span>
          <input
            name="memo"
            maxLength={ADMIN_UNPAID_MEMO_MAX}
            placeholder={`예: 국민 ${order.total.toLocaleString('ko-KR')}원 홍길동${order.depositCode} 대조 완료`}
            required
          />
        </label>
        <button className="btn btn-holo" disabled={confirmPending}>
          {confirmPending ? '확정하는 중' : '입금 확인'}
        </button>
        {confirmState.error && <p className="admin-error" role="alert">{confirmState.error}</p>}
        {confirmState.message && <p className="admin-note" role="status">{confirmState.message}</p>}
      </form>

      <form action={extendAction} className="admin-unpaid-action">
        <input name="orderId" type="hidden" value={order.id} />
        <label>
          <span>기한 연장 사유</span>
          <input
            name="reason"
            maxLength={ADMIN_UNPAID_MEMO_MAX}
            placeholder="예: 구매자가 은행 점검으로 밤에 입금 예정이라 연락"
            required
            disabled={Boolean(order.extendedAt)}
          />
        </label>
        <button className="btn btn-ghost" disabled={extendPending || Boolean(order.extendedAt)}>
          {order.extendedAt ? '연장 완료 (1회 소진)' : extendPending ? '연장하는 중' : '기한 24시간 연장'}
        </button>
        {extendState.error && <p className="admin-error" role="alert">{extendState.error}</p>}
        {extendState.message && <p className="admin-note" role="status">{extendState.message}</p>}
      </form>

      <form action={cancelAction} className="admin-unpaid-action">
        <input name="orderId" type="hidden" value={order.id} />
        <label>
          <span>취소 사유</span>
          <input
            name="reason"
            maxLength={ADMIN_UNPAID_MEMO_MAX}
            placeholder="예: 기한 연장 후에도 입금이 없어 취소"
            required
          />
        </label>
        <button className="btn btn-ghost" disabled={cancelPending}>
          {cancelPending ? '취소하는 중' : '즉시 취소'}
        </button>
        {cancelState.error && <p className="admin-error" role="alert">{cancelState.error}</p>}
        {cancelState.message && <p className="admin-note" role="status">{cancelState.message}</p>}
      </form>

      <p className="admin-note">
        미입금 취소는 환불이 없습니다. 기한이 지난 뒤 들어온 입금(미아 입금)은 주문을 되살리지 않고
        반환 절차로 처리합니다.
      </p>
    </section>
  );
}
