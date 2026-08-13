'use client';

import { useActionState } from 'react';
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

const inputStyle: React.CSSProperties = {
  height: 50,
  padding: '0 18px',
  borderRadius: 14,
  border: '1px solid var(--line-2)',
  background: 'rgba(21,17,42,.7)',
  color: 'var(--text)',
  fontSize: 14.5,
  fontFamily: 'inherit',
};

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
  const currentStatus = actionState.status ?? presentation.status;
  const message = statusMessage(currentStatus);

  return (
    <section className="col" style={{ gap: 14 }}>
      <span style={{ fontWeight: 700, fontSize: 15 }}>회원 탈퇴</span>
      <p style={{ margin: 0, color: 'var(--dim)', fontSize: 13.5, lineHeight: 1.65 }}>
        신청 즉시 새 구매·예매·작성·카드팩 개봉·게임·마케팅 변경이 중단됩니다.
        진행 중인 거래가 있으면 삭제는 보류됩니다. 법정 거래 기록은 분리 보존되며,
        실제 Storage·DB·Auth 삭제는 필수 통지와 복원 방지 절차가 준비된 뒤 별도로 진행됩니다.
      </p>

      {!presentation.preview.available && currentStatus.status === 'not_requested' && (
        <div role="status" style={{ padding: 12, borderRadius: 12, border: '1px solid var(--line-2)', color: 'var(--dim)', fontSize: 13.5 }}>
          안전한 통지와 복원 방지 절차를 준비 중이라 아직 탈퇴 신청을 받지 않습니다.
        </div>
      )}

      {message && (
        <div role="status" style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(255,178,61,.35)', color: '#FFD08A', fontSize: 13.5, fontWeight: 700 }}>
          {message}
        </div>
      )}

      {currentStatus.blockers.length > 0 && currentStatus.status === 'blocked' && (
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--dim)', fontSize: 13 }}>
          {currentStatus.blockers.map((blocker) => (
            <li key={blocker.code}>
              <a href={blocker.path} style={{ color: 'var(--cyan)' }}>
                해결할 항목 {blocker.count}건 확인
              </a>
            </li>
          ))}
        </ul>
      )}

      {presentation.preview.available && currentStatus.status === 'not_requested' && (
        <form action={action} className="col" style={{ gap: 12 }}>
          <input name="idempotencyKey" type="hidden" value={requestKey} />
          <label className="col" htmlFor="account-deletion-confirmation" style={{ gap: 7, color: '#C9C3E4', fontSize: 13.5 }}>
            계속하려면 <strong>{ACCOUNT_DELETION_CONFIRMATION}</strong>을 입력하세요.
            <input
              autoComplete="off"
              id="account-deletion-confirmation"
              name="confirmation"
              required
              style={inputStyle}
            />
          </label>
          {actionState.error && (
            <div role="alert" style={{ color: 'var(--pink)', fontSize: 13.5, fontWeight: 700 }}>
              {actionState.error}
            </div>
          )}
          {actionState.message && (
            <div role="status" style={{ color: 'var(--text)', fontSize: 13.5, fontWeight: 700 }}>
              {actionState.message}
            </div>
          )}
          <button
            className="btn"
            disabled={pending}
            style={{ width: '100%', height: 50, border: '1px solid rgba(255,77,157,.45)', color: 'var(--pink)', background: 'rgba(255,77,157,.08)' }}
          >
            {pending ? '신청 중' : '회원 탈퇴 신청'}
          </button>
        </form>
      )}
    </section>
  );
}
