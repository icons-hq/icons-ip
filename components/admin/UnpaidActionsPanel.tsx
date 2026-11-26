'use client';

import Link from 'next/link';
import { useActionState, type FormEvent, type ReactNode } from 'react';
import {
  cancelUnpaidBankTransferOrderAction,
  confirmBankTransferDepositAction,
  extendBankTransferDeadlineAction,
  type AdminUnpaidActionState,
} from '../../app/admin/unpaid-actions';
import {
  ADMIN_UNPAID_MEMO_MAX,
  ADMIN_UNPAID_MEMO_MIN,
  adminUnpaidAttemptStateLabel,
  type AdminUnpaidOrderRow,
} from '../../lib/admin/unpaid';
import {
  UNPAID_EXTEND_BUTTON_LABEL,
  unpaidCancelRequest,
  unpaidConfirmDepositRequest,
  unpaidExtendDeadlineRequest,
  unpaidOrderLabel,
  unpaidProcessedNotice,
} from '../../lib/admin/unpaid-copy';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { krw } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/orders';
import {
  bankTransferDeadlineImminent,
  bankTransferDeadlineLabel,
  bankTransferDeadlinePassed,
  bankTransferDepositNameWithCode,
} from '@/lib/payments/bank-transfer';
import { ignoreUnconfirmedUnpaidSubmit, reportUnpaidProcessed, submitUnpaidAfterConfirm } from './unpaid-submit';

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

/* 처리할 주문의 사실 한 칸. 통장 내역과 맞춰 볼 값이라 이름 아래에 값을 둔다. */
function Fact({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={wide ? 'flex min-w-0 flex-col gap-0.5 sm:col-span-2 lg:col-span-3' : 'flex min-w-0 flex-col gap-0.5'}>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 break-words">{children}</dd>
  </div>;
}

/** 입금 기한(KST)과 남은 시간. 끝났거나 임박한 기한만 강조한다 — 목록과 같은 기준이다. 기준 시각(`now`)이 없으면 남은 시간은 말하지 않는다. */
function DeadlineFact({ order, now }: { order: AdminUnpaidOrderRow; now?: number }) {
  const deadline = order.expiresAt ? formatOrderDateTime(order.expiresAt) : '';
  if (!deadline) return <span className="text-muted-foreground">기한 정보 없음</span>;
  const remaining = now === undefined ? null : bankTransferDeadlineLabel(order.expiresAt, now);
  const tone = now === undefined ? null
    : bankTransferDeadlinePassed(order.expiresAt, now) ? 'danger' as const
      : bankTransferDeadlineImminent(order.expiresAt, now) ? 'warning' as const : null;
  return <>
    <span className="tabular-nums">{deadline}</span>
    {remaining ? tone ? <AdminStatusBadge tone={tone}>{remaining}</AdminStatusBadge> : <span className="text-muted-foreground">{remaining}</span> : null}
    {order.extendedAt ? <span className="text-muted-foreground">· 연장됨</span> : null}
  </>;
}

/**
 * 선택한 미입금 주문의 처리 패널.
 *
 * 세 액션이 모두 근거를 요구한다. 확정은 돈이 들어왔다는 사람의 판단이고,
 * 연장은 재고를 지금부터 하루 동안 더 묶는 판단이며, 취소는 구매자의 주문을 없애는 판단이다 —
 * 셋 다 나중에 "왜 그랬나"를 물을 수 있어야 한다.
 *
 * 패널은 표·페이지 아래에 있어 고른 줄과 떨어져 있다. 그래서 머리에 어느 주문인지(주문번호·구매자·입금자명·금액·기한)를
 * 통장과 맞춰 볼 값 그대로 보이고, 세 버튼은 누르면 같은 값과 결과를 확인창에서 한 번 더 말한다(`lib/admin/unpaid-copy.ts`).
 * 확인 뒤 제출은 `unpaid-submit.ts` 참고.
 */
export function UnpaidActionsPanel({ order, now, detailHref, onProcessed }: {
  order: AdminUnpaidOrderRow;
  /** 남은 시간을 셀 기준 시각(ms). 목록과 같은 값을 서버 화면이 준다. */
  now?: number;
  /** 이 주문의 주문 상세 링크. 입금 확인을 못 누르는 상태에서 결제 내역을 보러 가는 길이다. */
  detailHref?: string;
  /**
   * 입금 확인·즉시 취소가 끝났을 때 결과 한 줄을 받는 곳. 처리된 주문은 목록에서 빠지며 이 패널이 사라지므로,
   * 패널을 감싼 쪽(`UnpaidSelectedOrder`)이 그 자리에 결과를 남긴다. 기한 연장은 주문이 목록에 남아 패널이 결과를 보이므로 알리지 않는다.
   */
  onProcessed?: (notice: string) => void;
}) {
  const processed = onProcessed ? (message: string) => onProcessed(unpaidProcessedNotice(order, message)) : null;
  const [confirmState, confirmAction, confirmPending] = useActionState(
    processed ? reportUnpaidProcessed(confirmBankTransferDepositAction, processed) : confirmBankTransferDepositAction,
    initialState,
  );
  const [extendState, extendAction, extendPending] = useActionState(
    extendBankTransferDeadlineAction,
    initialState,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    processed ? reportUnpaidProcessed(cancelUnpaidBankTransferOrderAction, processed) : cancelUnpaidBankTransferOrderAction,
    initialState,
  );
  /* 입금 확인은 결제 시도가 '입금 대기'일 때만 된다 — 그 밖의 상태는 DB가 거절한다. 못 누르는 이유를 그 자리에서 말한다. */
  const confirmable = order.attemptState === 'prepared';
  const extended = Boolean(order.extendedAt);
  /* 확인창 문구는 누른 순간에 만든다(기한 연장은 그때의 시각으로 새 기한을 미리 보인다). */
  function submitConfirm(event: FormEvent<HTMLFormElement>) {
    void submitUnpaidAfterConfirm(event, unpaidConfirmDepositRequest(order), confirmAction);
  }
  function submitExtend(event: FormEvent<HTMLFormElement>) {
    void submitUnpaidAfterConfirm(event, unpaidExtendDeadlineRequest(order, Date.now()), extendAction);
  }
  function submitCancel(event: FormEvent<HTMLFormElement>) {
    void submitUnpaidAfterConfirm(event, unpaidCancelRequest(order), cancelAction);
  }

  return (
    <section className="flex min-w-0 scroll-mt-16 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground sm:p-5" aria-label="미입금 주문 처리" id="unpaid-actions">
      <header className="flex flex-col gap-3">
        <h3 className="text-base font-medium text-foreground">{unpaidOrderLabel(order)} 처리</h3>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3" data-unpaid-order-facts="">
          <Fact label="구매자">{order.buyerName}</Fact>
          <Fact label="안내된 입금자명"><span className="tabular-nums">{bankTransferDepositNameWithCode(order.recipientName, order.depositCode)}</span></Fact>
          <Fact label="입금액"><strong className="font-semibold tabular-nums">{krw(order.total)}</strong></Fact>
          <Fact label="입금 기한 (KST)"><DeadlineFact now={now} order={order} /></Fact>
          <Fact label="입금확인코드"><span className="tabular-nums">{order.depositCode}</span></Fact>
          <Fact label="품목" wide>{order.itemSummary || '품목 정보 없음'}</Fact>
        </dl>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        <form action={ignoreUnconfirmedUnpaidSubmit} className={FORM_CLASS} onSubmit={submitConfirm}>
          <input name="orderId" type="hidden" value={order.id} />
          <label className={LABEL_CLASS}>
            <span>입금 근거 (필수)</span>
            <Input
              name="memo"
              minLength={ADMIN_UNPAID_MEMO_MIN}
              maxLength={ADMIN_UNPAID_MEMO_MAX}
              placeholder="예: 통장 내역에서 입금자명·금액 일치 확인"
              required
              disabled={!confirmable}
            />
          </label>
          <Button disabled={confirmPending || !confirmable} type="submit">
            {confirmPending ? '확정하는 중' : '입금 확인'}
          </Button>
          {confirmable ? null : (
            <p className="text-muted-foreground">
              입금 확인은 ‘{adminUnpaidAttemptStateLabel('prepared')}’일 때만 누를 수 있습니다. 지금은 ‘{adminUnpaidAttemptStateLabel(order.attemptState)}’입니다.
              {detailHref ? <> <Link className="font-medium text-foreground underline underline-offset-4" href={detailHref}>주문 상세</Link>에서 결제 내역을 확인해주세요.</> : ' 주문 상세에서 결제 내역을 확인해주세요.'}
            </p>
          )}
          <ActionResult state={confirmState} />
        </form>

        <form action={ignoreUnconfirmedUnpaidSubmit} className={FORM_CLASS} onSubmit={submitExtend}>
          <input name="orderId" type="hidden" value={order.id} />
          <label className={LABEL_CLASS}>
            <span>기한 연장 사유 (필수)</span>
            <Input
              name="reason"
              minLength={ADMIN_UNPAID_MEMO_MIN}
              maxLength={ADMIN_UNPAID_MEMO_MAX}
              placeholder="예: 구매자가 은행 점검으로 밤에 입금 예정이라 연락"
              required
              disabled={extended}
            />
          </label>
          <Button disabled={extendPending || extended} type="submit" variant="outline">
            {extended ? '이미 한 번 연장함' : extendPending ? '연장하는 중' : UNPAID_EXTEND_BUTTON_LABEL}
          </Button>
          <ActionResult state={extendState} />
        </form>

        <form action={ignoreUnconfirmedUnpaidSubmit} className={FORM_CLASS} onSubmit={submitCancel}>
          <input name="orderId" type="hidden" value={order.id} />
          <label className={LABEL_CLASS}>
            <span>취소 사유 (필수)</span>
            <Input
              name="reason"
              minLength={ADMIN_UNPAID_MEMO_MIN}
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

      <p className="text-muted-foreground">근거·사유는 {ADMIN_UNPAID_MEMO_MIN}자 이상 적어야 하고 감사 기록에 남습니다.</p>
    </section>
  );
}
