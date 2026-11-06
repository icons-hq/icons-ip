'use client';

import { useActionState } from 'react';
import {
  confirmBankDepositAction,
  ignoreBankDepositAction,
  type AdminUnpaidActionState,
} from '../../app/admin/unpaid-actions';
import type { AdminBankDepositRow } from '../../lib/admin/unpaid';
import {
  bankDepositConfidenceLabel,
  bankDepositNeedsSecondLook,
} from '../../lib/payments/bank-deposit-feed';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';

const initialState: AdminUnpaidActionState = {};

/* 입금 내역 카드(템플릿 룩, ADR-0028). */
const FORM_CLASS = 'flex flex-col items-start gap-2';
const LABEL_CLASS = 'flex w-full min-w-0 flex-col gap-1.5 [&>span]:text-sm [&>span]:font-medium';

function ActionResult({ state }: { state: AdminUnpaidActionState }) {
  return <>
    {state.error && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
    {state.message && <p className="text-sm text-[var(--wc-success)]" role="status">{state.message}</p>}
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
 */
function DepositCard({ deposit }: { deposit: AdminBankDepositRow }) {
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
        <strong className="text-base font-semibold tabular-nums">{deposit.amount.toLocaleString('ko-KR')}원</strong>
        <span>{deposit.depositorName}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{deposit.source} · {deposit.externalId}</span>
      </div>
      {deposit.rawReference && <p className="text-muted-foreground">{deposit.rawReference}</p>}

      {suggested ? (
        <form action={confirmAction} className={FORM_CLASS}>
          <input name="depositId" type="hidden" value={deposit.id} />
          <input name="orderId" type="hidden" value={suggested} />
          <p className={bankDepositNeedsSecondLook(deposit.suggestedConfidence) ? 'text-[var(--wc-warning)]' : 'text-muted-foreground'}>
            제안: 주문 <strong className="font-medium text-foreground tabular-nums">{deposit.suggestedOrderCode}</strong>
            {' · '}
            {bankDepositConfidenceLabel(deposit.suggestedConfidence)}
            {bankDepositNeedsSecondLook(deposit.suggestedConfidence)
              && ' — 금액이 다릅니다. 부분 입금인지 먼저 확인해주세요.'}
          </p>
          <label className={LABEL_CLASS}>
            <span>입금 근거</span>
            <Input
              name="memo"
              maxLength={200}
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
          대조되는 미입금 주문을 찾지 못했습니다. 위 목록에서 주문을 직접 확인해 확정하거나,
          미아 입금이면 사유를 남기고 내려주세요.
        </p>
      )}

      <form action={ignoreAction} className={`${FORM_CLASS} border-t pt-3`}>
        <input name="depositId" type="hidden" value={deposit.id} />
        <label className={LABEL_CLASS}>
          <span>보류 사유</span>
          <Input
            name="reason"
            maxLength={200}
            placeholder="예: 주문과 대조되지 않아 반환 안내 예정"
            required
          />
        </label>
        <Button disabled={ignorePending} type="submit" variant="outline">
          {ignorePending ? '내리는 중' : '큐에서 내리기'}
        </Button>
        <ActionResult state={ignoreState} />
      </form>
    </li>
  );
}

export function BankDepositQueue({ deposits }: { deposits: AdminBankDepositRow[] }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground sm:p-5" aria-label="미매칭 입금 내역">
      <header className="flex flex-col gap-1">
        <h3 className="text-base font-medium text-foreground">입금 내역</h3>
        <p className="text-muted-foreground">
          계좌수집 서비스가 가져온 미매칭 입금입니다. 매칭은 제안이며 확정은 직접 눌러야 합니다.
        </p>
      </header>
      {deposits.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">
          미매칭 입금이 없습니다. 계좌수집 연동 전이라면 이 목록은 항상 비어 있고, 입금 확인은
          위 목록에서 수동으로 처리합니다.
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
