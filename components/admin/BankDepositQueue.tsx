'use client';

import { useActionState } from 'react';
import {
  confirmBankDepositAction,
  ignoreBankDepositAction,
  type AdminUnpaidActionState,
} from '../../app/admin/unpaid-actions';
import { ADMIN_UNPAID_MEMO_MAX, ADMIN_UNPAID_MEMO_MIN, type AdminBankDepositRow } from '../../lib/admin/unpaid';
import { bankDepositConfirmRequest, bankDepositIgnoreRequest } from '../../lib/admin/unpaid-copy';
import {
  bankDepositConfidenceLabel,
  bankDepositNeedsSecondLook,
} from '../../lib/payments/bank-deposit-feed';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { krw } from '@/lib/format';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { ignoreUnconfirmedUnpaidSubmit, submitUnpaidAfterConfirm } from './unpaid-submit';

const initialState: AdminUnpaidActionState = {};

/* 입금 내역 카드(템플릿 룩, ADR-0028). */
const FORM_CLASS = 'flex flex-col items-start gap-2';
const LABEL_CLASS = 'flex w-full min-w-0 flex-col gap-1.5 [&>span]:text-sm [&>span]:font-medium';

function ActionResult({ state }: { state: AdminUnpaidActionState }) {
  return <>
    {state.error && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
    {state.message && <p className="text-sm text-success" role="status">{state.message}</p>}
  </>;
}

/**
 * 미매칭 입금 큐 (#257).
 *
 * 제안은 채워 주되 확정 버튼은 사람이 누른다. 자동 확정으로 넘어가는 판단은
 * 운영이 안정된 뒤 따로 하기로 했다(ADR-0007) — 그 전에는 잘못된 자동 확정
 * 하나가 남의 주문을 결제완료로 만든다.
 *
 * 제안이 없는 입금(미아 입금)도 큐에 남는다. 반환 절차의 근거가 이 행이므로
 * 지우지 않고 사유와 함께 내린다.
 *
 * 확정은 주문을 결제완료로 바꾸고 고객 메일이 나가며, 내리기는 목록에서 다시 올릴 길이 없다. 둘 다 확인창을 거친다 —
 * 제출 방식은 `unpaid-submit.ts` 참고.
 */
export function DepositCard({ deposit }: { deposit: AdminBankDepositRow }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmBankDepositAction,
    initialState,
  );
  const [ignoreState, ignoreAction, ignorePending] = useActionState(
    ignoreBankDepositAction,
    initialState,
  );
  const suggested = deposit.suggestedOrderId;

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <strong className="text-base font-semibold tabular-nums">{krw(deposit.amount)}</strong>
        <span>{deposit.depositorName}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{deposit.source} · {deposit.externalId}</span>
      </div>
      {deposit.rawReference && <p className="text-muted-foreground">{deposit.rawReference}</p>}

      {suggested ? (
        <form
          action={ignoreUnconfirmedUnpaidSubmit}
          className={FORM_CLASS}
          onSubmit={(event) => { void submitUnpaidAfterConfirm(event, bankDepositConfirmRequest(deposit), confirmAction); }}
        >
          <input name="depositId" type="hidden" value={deposit.id} />
          <input name="orderId" type="hidden" value={suggested} />
          <p className={`flex flex-wrap items-center gap-1.5 ${bankDepositNeedsSecondLook(deposit.suggestedConfidence) ? 'text-warning' : 'text-muted-foreground'}`}>
            제안: 주문 <strong className="font-medium text-foreground tabular-nums">{deposit.suggestedOrderCode}</strong>
            <AdminStatusBadge tone={bankDepositNeedsSecondLook(deposit.suggestedConfidence) ? 'warning' : 'info'}>{bankDepositConfidenceLabel(deposit.suggestedConfidence)}</AdminStatusBadge>
            {bankDepositNeedsSecondLook(deposit.suggestedConfidence)
              && <span>금액이 다릅니다. 부분 입금인지 먼저 확인해주세요.</span>}
          </p>
          <label className={LABEL_CLASS}>
            <span>입금 근거 (필수)</span>
            <Input
              name="memo"
              minLength={ADMIN_UNPAID_MEMO_MIN}
              maxLength={ADMIN_UNPAID_MEMO_MAX}
              placeholder="예: 입금자명 주문코드 일치, 금액 동일"
              required
            />
          </label>
          <Button disabled={confirmPending} type="submit">
            {confirmPending ? '확정하는 중' : '이 주문으로 확정'}
          </Button>
          <ActionResult state={confirmState} />
        </form>
      ) : (
        <p className="text-muted-foreground">
          제안할 미입금 주문을 찾지 못했습니다. 위 목록에서 맞는 주문을 직접 찾아 입금 확인하거나,
          맞는 주문이 없는 입금(미아 입금)이면 보류 사유를 적고 [목록에서 내리기]를 눌러주세요.
        </p>
      )}

      <form
        action={ignoreUnconfirmedUnpaidSubmit}
        className={`${FORM_CLASS} border-t pt-3`}
        onSubmit={(event) => { void submitUnpaidAfterConfirm(event, bankDepositIgnoreRequest(deposit), ignoreAction); }}
      >
        <input name="depositId" type="hidden" value={deposit.id} />
        <label className={LABEL_CLASS}>
          <span>보류 사유 (필수)</span>
          <Input
            name="reason"
            minLength={ADMIN_UNPAID_MEMO_MIN}
            maxLength={ADMIN_UNPAID_MEMO_MAX}
            placeholder="예: 주문과 대조되지 않아 반환 안내 예정"
            required
          />
        </label>
        <Button disabled={ignorePending} type="submit" variant="outline">
          {ignorePending ? '내리는 중' : '목록에서 내리기'}
        </Button>
        <ActionResult state={ignoreState} />
      </form>
    </li>
  );
}

export function BankDepositQueue({ deposits }: { deposits: AdminBankDepositRow[] }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground sm:p-5" aria-label="주문과 연결하지 않은 입금 내역">
      <header className="flex flex-col gap-1">
        <h3 className="text-base font-medium text-foreground">입금 내역</h3>
        <p className="text-muted-foreground">
          계좌수집 서비스가 가져온 입금 중 주문과 연결하지 않은 건입니다. 주문을 제안하지만 확정은 직접 눌러야 합니다.
        </p>
      </header>
      {deposits.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">
          주문과 연결할 입금이 없습니다. 계좌수집 서비스를 연결하기 전에는 늘 비어 있으니,
          위 목록에서 직접 입금 확인합니다.
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {deposits.map((deposit) => (
            <DepositCard deposit={deposit} key={deposit.id} />
          ))}
        </ul>
      )}
    </section>
  );
}
