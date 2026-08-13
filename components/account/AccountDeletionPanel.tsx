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
        실제 Storage·DB·Auth 삭제는 필수 통지와 복원 방지 절차가 준비된 뒤 별도로 진행됩니다.
      </p>

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
                  {isPreviewBlocker ? '신청 전 ' : ''}해결할 항목 {blocker.count}건 확인
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
