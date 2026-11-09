'use client';

import { useActionState } from 'react';
import {
  cancelUnpaidBankTransferOrderAction,
  confirmBankTransferDepositAction,
  extendBankTransferDeadlineAction,
  type AdminUnpaidActionState,
} from '../../app/admin/unpaid-actions';
import { ADMIN_UNPAID_MEMO_MAX, type AdminUnpaidOrderRow } from '../../lib/admin/unpaid';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';

const initialState: AdminUnpaidActionState = {};

/* 처리 패널(템플릿 룩, ADR-0028). 세 양식은 근거 입력 아래에 버튼과 결과를 둔다. */
const FORM_CLASS = 'flex flex-col items-start gap-2 rounded-lg border p-3';
const LABEL_CLASS = 'flex w-full min-w-0 flex-col gap-1.5 [&>span]:text-sm [&>span]:font-medium';

function ActionResult({ state }: { state: AdminUnpaidActionState }) {
  return <>
    {state.error && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
    {state.message && <p className="text-sm text-success" role="status">{state.message}</p>}
  </>;
}

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
    <section className="flex min-w-0 scroll-mt-16 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground sm:p-5" aria-label="미입금 주문 처리" id="unpaid-actions">
      <header className="flex flex-col gap-1">
        <h3 className="text-base font-medium text-foreground">주문 {order.depositCode} 처리</h3>
        <p className="text-muted-foreground tabular-nums">{order.buyerName} · {order.itemSummary || '품목 정보 없음'}</p>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        <form action={confirmAction} className={FORM_CLASS}>
          <input name="orderId" type="hidden" value={order.id} />
          <label className={LABEL_CLASS}>
            <span>입금 근거</span>
            <Input
              name="memo"
              maxLength={ADMIN_UNPAID_MEMO_MAX}
              placeholder={`예: 국민 ${order.total.toLocaleString('ko-KR')}원 홍길동${order.depositCode} 대조 완료`}
              required
            />
          </label>
          <Button disabled={confirmPending} type="submit">
            {confirmPending ? '확정하는 중' : '입금 확인'}
          </Button>
          <ActionResult state={confirmState} />
        </form>

        <form action={extendAction} className={FORM_CLASS}>
          <input name="orderId" type="hidden" value={order.id} />
          <label className={LABEL_CLASS}>
            <span>기한 연장 사유</span>
            <Input
              name="reason"
              maxLength={ADMIN_UNPAID_MEMO_MAX}
              placeholder="예: 구매자가 은행 점검으로 밤에 입금 예정이라 연락"
              required
              disabled={Boolean(order.extendedAt)}
            />
          </label>
          <Button disabled={extendPending || Boolean(order.extendedAt)} type="submit" variant="outline">
            {order.extendedAt ? '연장 완료 (1회 소진)' : extendPending ? '연장하는 중' : '기한 24시간 연장'}
          </Button>
          <ActionResult state={extendState} />
        </form>

        <form action={cancelAction} className={FORM_CLASS}>
          <input name="orderId" type="hidden" value={order.id} />
          <label className={LABEL_CLASS}>
            <span>취소 사유</span>
            <Input
              name="reason"
              maxLength={ADMIN_UNPAID_MEMO_MAX}
              placeholder="예: 기한 연장 후에도 입금이 없어 취소"
              required
            />
          </label>
          <Button disabled={cancelPending} type="submit" variant="destructive">
            {cancelPending ? '취소하는 중' : '즉시 취소'}
          </Button>
          <ActionResult state={cancelState} />
        </form>
      </div>

      <p className="text-muted-foreground">
        미입금 취소는 환불이 없습니다. 기한이 지난 뒤 들어온 입금(미아 입금)은 주문을 되살리지 않고
        반환 절차로 처리합니다.
      </p>
    </section>
  );
}
