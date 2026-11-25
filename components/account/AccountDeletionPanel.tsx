'use client';

import { useActionState, useEffect, useRef } from 'react';
import {
  requestAccountDeletionAction,
  type AccountDeletionActionState,
} from '@/app/settings/actions';
import { WcButton } from '@/components/wc/WcButton';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  INQUIRY_WITHDRAWAL_SCOPE,
  type AccountDeletionPresentation,
  type AccountDeletionStatus,
} from '@/lib/account-deletion';
import { ACCOUNT_INQUIRY_PATH } from '@/lib/auth/onboarding';

interface AccountDeletionPanelProps {
  presentation: AccountDeletionPresentation;
  requestKey: string;
}

const emptyState: AccountDeletionActionState = {};
/** 탈퇴 요청을 받는 1:1 문의 작성 화면(유형 '계정'으로 연다). 정지·온보딩 미완료 회원도 이 경로로 계정 문의를 쓸 수 있다. */
export const ACCOUNT_DELETION_INQUIRY_HREF = ACCOUNT_INQUIRY_PATH;
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
  active_order: '진행 중인 상품 주문',
  active_received_gift: '받은 선물의 배송·취소 처리',
  active_shipping_collect: '착불 수납·환급 확인',
  active_claim_fee: '반품·교환 배송비 청구·반환 확인',
  subscription_active: '정기배송 해지',
  subscription_payment_pending: '정기배송 결제 확인',
  billing_registration_pending: '정기결제 카드 등록 확인',
  billing_card_cleanup: '정기결제 카드 해지',
  active_cancellation: '상품 취소·환급 처리',
  active_order_payment: '상품 결제 확인',
  active_ticket_payment: '티켓 결제 확인',
  active_payment_attempt: '결제 정합화',
  active_order_refund: '상품 환불·송금 대기 처리',
  active_ticket_refund: '티켓 환급 처리',
  active_refund: '환불·송금 확인',
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
  /* 탈퇴 신청 기능이 꺼져 있고 접수된 신청도 없으면 화면 신청 대신 1:1 문의 접수를 안내한다. */
  const inquiryOnly = !presentation.preview.available && currentStatus.status === 'not_requested';
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
      {inquiryOnly ? (
        /* 탈퇴 신청 기능이 꺼져 있는 동안의 접수 경로(원장 CUS-035). 운영자가 문의를 확인해 처리한다. */
        <div className="account-deletion-guide">
          <p className="account-deletion-description">
            지금은 1:1 문의로 탈퇴 요청을 받고 있어요. 문의 유형을 &lsquo;계정&rsquo;으로 골라 탈퇴를 원한다고
            남겨주시면, 운영자가 진행 중인 거래가 없는지 확인한 뒤 처리하고 문의 답변으로 알려드려요.
          </p>
          <ul className="account-deletion-facts">
            <li>처리되면 이 계정으로 다시 로그인할 수 없고, {INQUIRY_WITHDRAWAL_SCOPE.erased.join('·')}은 바로 지워지고, 닉네임은 &lsquo;{INQUIRY_WITHDRAWAL_SCOPE.anonymizedName}&rsquo;에 구분 번호가 붙은 이름으로 바뀌어요. 쓰지 않은 적립금도 더 이상 쓸 수 없어요.</li>
            <li>
              이메일 주소는 처리 결과를 문의 답변으로 알려드리기 위해 {INQUIRY_WITHDRAWAL_SCOPE.emailRetentionDays}일 동안 보관한 뒤 지워요.
              {' '}{INQUIRY_WITHDRAWAL_SCOPE.rejoin}.
            </li>
            <li>관련 법에 따라 {INQUIRY_WITHDRAWAL_SCOPE.transactionRecords}은 5년, {INQUIRY_WITHDRAWAL_SCOPE.inquiries}은 3년 동안 보관한 뒤 파기해요.</li>
            <li>{INQUIRY_WITHDRAWAL_SCOPE.posts}은 지워지지 않고 작성자가 &lsquo;{INQUIRY_WITHDRAWAL_SCOPE.anonymizedName}&rsquo;으로 보여요. 지우고 싶은 리뷰는 탈퇴를 요청하기 전에 직접 삭제해주세요.</li>
            <li>진행 중인 주문·배송·취소·환불, 이용 전 티켓, 정기배송이 있으면 그 일이 끝난 뒤 처리돼요.</li>
          </ul>
          <WcButton href={ACCOUNT_DELETION_INQUIRY_HREF} variant="primary">1:1 문의로 탈퇴 요청하기</WcButton>
        </div>
      ) : (
        <p className="account-deletion-description">
          신청 즉시 새 구매·예매·작성·게임·마케팅 변경이 중단됩니다.
          진행 중인 거래가 있으면 삭제는 보류됩니다. 법정 거래 기록은 분리 보존되며,
          현재 신청 단계에서는 계정이 삭제되지 않습니다. 실제 Storage·DB·Auth hard delete와
          복원 방지 원장 기록이 시작되면 되돌릴 수 없습니다. 해당 단계 직전에 대상과
          비가역성을 다시 보여드리고 별도 확인을 받습니다.
        </p>
      )}

      {presentation.preview.available && currentStatus.status === 'not_requested' && (
        <p className="account-deletion-description">
          신청 직전에 본인 세션을 다시 확인합니다. 오래된 세션이면{' '}
          <a href="/login?next=%2Fsettings%2Fdelete-account&reauth=1">다시 로그인</a>해주세요.
        </p>
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
            className="wc-btn account-deletion-submit"
            disabled={pending}
          >
            {pending ? '신청 중' : '회원 탈퇴 신청'}
          </button>
        </form>
      )}
    </section>
  );
}
