'use client';

import { useActionState, useEffect, useRef } from 'react';
import {
  requestAccountDeletionAction,
  type AccountDeletionActionState,
} from '@/app/settings/actions';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  type AccountDeletionPresentation,
  type AccountDeletionStatus,
} from '@/lib/account-deletion';

interface AccountDeletionPanelProps {
  presentation: AccountDeletionPresentation;
  requestKey: string;
}

const emptyState: AccountDeletionActionState = {};
const confirmationHintId = 'account-deletion-confirmation-hint';
const confirmationErrorId = 'account-deletion-confirmation-error';

export function focusAccountDeletionConfirmation(
  input: Pick<HTMLInputElement, 'focus'> | null,
) {
  input?.focus();
}

function statusMessage(status: AccountDeletionStatus): string | null {
  if (status.status === 'processing') {
    return '탈퇴 신청이 접수됐습니다. 필수 통지와 후속 삭제 단계는 아직 진행되지 않았습니다.';
  }
  if (status.status === 'blocked') {
    return '탈퇴 신청은 접수됐지만 진행 중인 의무가 있어 삭제가 보류됐습니다.';
  }
  return null;
}

const blockerLabels: Record<AccountDeletionStatus['blockers'][number]['code'], string> = {
  active_order: '진행 중인 굿즈 주문',
  active_cancellation: '굿즈 취소·환급 처리',
  active_order_payment: '굿즈 결제 확인',
  active_ticket_payment: '티켓 결제 확인',
  active_payment_attempt: '결제 정합화',
  active_order_refund: '굿즈 환급 처리',
  active_ticket_refund: '티켓 환급 처리',
  active_refund: '환급 정합화',
  active_ticket: '진행 중인 티켓',
  active_ticket_cancellation: '티켓 취소·환급 처리',
  staff_handover: '운영 권한 인계',
  not_available: '탈퇴 신청 준비',
};

export function AccountDeletionPanel({ presentation, requestKey }: AccountDeletionPanelProps) {
  const [actionState, action, pending] = useActionState(
    requestAccountDeletionAction,
    emptyState,
  );
  const confirmationRef = useRef<HTMLInputElement>(null);
  const currentStatus = actionState.status ?? presentation.status;
  const message = statusMessage(currentStatus);
  const isPreviewBlocker = currentStatus.status === 'not_requested'
    && presentation.preview.available
    && !presentation.preview.eligible;
  const visibleBlockers = currentStatus.status === 'blocked'
    ? currentStatus.blockers
    : isPreviewBlocker
      ? presentation.preview.blockers
      : [];

  useEffect(() => {
    if (actionState.error) focusAccountDeletionConfirmation(confirmationRef.current);
  }, [actionState.error]);

  return (
    <section className="account-deletion-panel col">
      <h2 className="account-deletion-title">회원 탈퇴</h2>
      <p className="account-deletion-description">
        신청 즉시 새 구매·예매·작성·카드팩 개봉·게임·마케팅 변경이 중단됩니다.
        진행 중인 거래가 있으면 삭제는 보류됩니다. 법정 거래 기록은 분리 보존되며,
        현재 신청 단계에서는 계정이 삭제되지 않습니다. 실제 Storage·DB·Auth hard delete와
        복원 방지 원장 기록이 시작되면 되돌릴 수 없습니다. 해당 단계 직전에 대상과
        비가역성을 다시 보여드리고 별도 확인을 받습니다.
      </p>

      {presentation.preview.available && currentStatus.status === 'not_requested' && (
        <p className="account-deletion-description">
          신청 직전에 본인 세션을 다시 확인합니다. 오래된 세션이면{' '}
          <a href="/login?next=%2Fsettings%2Fdelete-account&reauth=1">다시 로그인</a>해주세요.
        </p>
      )}

      {!presentation.preview.available && currentStatus.status === 'not_requested' && (
        <div className="account-deletion-feedback account-deletion-feedback--neutral" role="status">
          안전한 통지와 복원 방지 절차를 준비 중이라 아직 탈퇴 신청을 받지 않습니다.
        </div>
      )}

      {message && (
        <div
          className={`account-deletion-feedback account-deletion-feedback--${currentStatus.status}`}
          role="status"
        >
          {message}
        </div>
      )}

      {visibleBlockers.length > 0 && (
        <div className="account-deletion-blockers">
          {isPreviewBlocker && (
            <p>탈퇴 신청 전에 진행 중인 의무를 먼저 확인해주세요.</p>
          )}
          <ul>
            {visibleBlockers.map((blocker) => (
              <li key={blocker.code}>
                <a href={blocker.path}>
                  {isPreviewBlocker ? '신청 전 ' : ''}{blockerLabels[blocker.code]} {blocker.count}건 확인
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {presentation.preview.available && currentStatus.status === 'not_requested' && (
        <form action={action} className="account-deletion-form col">
          <input name="idempotencyKey" type="hidden" value={requestKey} />
          <label className="account-deletion-label col" htmlFor="account-deletion-confirmation">
            계속하려면 <strong>{ACCOUNT_DELETION_CONFIRMATION}</strong>을 입력하세요.
            <span id={confirmationHintId}>문구를 띄어쓰기까지 그대로 입력해주세요.</span>
            <input
              aria-describedby={actionState.error
                ? `${confirmationHintId} ${confirmationErrorId}`
                : confirmationHintId}
              aria-invalid={Boolean(actionState.error)}
              autoComplete="off"
              className="account-deletion-confirmation"
              id="account-deletion-confirmation"
              name="confirmation"
              ref={confirmationRef}
              required
            />
          </label>
          {actionState.error && (
            <div
              className="account-deletion-feedback account-deletion-feedback--error"
              id={confirmationErrorId}
              role="alert"
            >
              {actionState.error}
            </div>
          )}
          {actionState.message && (
            <div className="account-deletion-feedback account-deletion-feedback--success" role="status">
              {actionState.message}
            </div>
          )}
          <button
            className="btn account-deletion-submit"
            disabled={pending}
          >
            {pending ? '신청 중' : '회원 탈퇴 신청'}
          </button>
        </form>
      )}
    </section>
  );
}
