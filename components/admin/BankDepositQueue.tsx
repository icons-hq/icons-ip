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

const initialState: AdminUnpaidActionState = {};

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
    <li className="admin-deposit-card">
      <div className="admin-deposit-head">
        <strong className="mono">{deposit.amount.toLocaleString('ko-KR')}원</strong>
        <span>{deposit.depositorName}</span>
        <span className="mono">{deposit.source} · {deposit.externalId}</span>
      </div>
      {deposit.rawReference && <p className="admin-note">{deposit.rawReference}</p>}

      {suggested ? (
        <form action={confirmAction} className="admin-deposit-action">
          <input name="depositId" type="hidden" value={deposit.id} />
          <input name="orderId" type="hidden" value={suggested} />
          <p className="admin-note">
            제안: 주문 <strong className="mono">{deposit.suggestedOrderCode}</strong>
            {' · '}
            {bankDepositConfidenceLabel(deposit.suggestedConfidence)}
            {bankDepositNeedsSecondLook(deposit.suggestedConfidence)
              && ' — 금액이 다릅니다. 부분 입금인지 먼저 확인해주세요.'}
          </p>
          <label>
            <span>입금 근거</span>
            <input
              name="memo"
              maxLength={200}
              placeholder="예: 입금자명 주문코드 일치, 금액 동일"
              required
            />
          </label>
          <button className="btn btn-holo" disabled={confirmPending}>
            {confirmPending ? '확정하는 중' : '이 주문으로 확정'}
          </button>
          {confirmState.error && <p className="admin-error" role="alert">{confirmState.error}</p>}
          {confirmState.message && <p className="admin-note" role="status">{confirmState.message}</p>}
        </form>
      ) : (
        <p className="admin-note">
          대조되는 미입금 주문을 찾지 못했습니다. 위 목록에서 주문을 직접 확인해 확정하거나,
          미아 입금이면 사유를 남기고 내려주세요.
        </p>
      )}

      <form action={ignoreAction} className="admin-deposit-action">
        <input name="depositId" type="hidden" value={deposit.id} />
        <label>
          <span>보류 사유</span>
          <input
            name="reason"
            maxLength={200}
            placeholder="예: 주문과 대조되지 않아 반환 안내 예정"
            required
          />
        </label>
        <button className="btn btn-ghost" disabled={ignorePending}>
          {ignorePending ? '내리는 중' : '큐에서 내리기'}
        </button>
        {ignoreState.error && <p className="admin-error" role="alert">{ignoreState.error}</p>}
        {ignoreState.message && <p className="admin-note" role="status">{ignoreState.message}</p>}
      </form>
    </li>
  );
}

export function BankDepositQueue({ deposits }: { deposits: AdminBankDepositRow[] }) {
  return (
    <section className="admin-panel admin-deposit-queue" aria-label="미매칭 입금 내역">
      <header>
        <h3>입금 내역</h3>
        <p className="admin-note">
          계좌수집 서비스가 가져온 미매칭 입금입니다. 매칭은 제안이며 확정은 직접 눌러야 합니다.
        </p>
      </header>
      {deposits.length === 0 ? (
        <p className="admin-note">
          미매칭 입금이 없습니다. 계좌수집 연동 전이라면 이 목록은 항상 비어 있고, 입금 확인은
          위 목록에서 수동으로 처리합니다.
        </p>
      ) : (
        <ul className="admin-deposit-list">
          {deposits.map((deposit) => (
            <DepositCard deposit={deposit} key={deposit.id} />
          ))}
        </ul>
      )}
    </section>
  );
}
