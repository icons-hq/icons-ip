'use client';

import { useActionState, useState } from 'react';
import {
  requestEmailChangeCodeAction,
  verifyEmailChangeCodeAction,
  type EmailChangeActionState,
} from '@/app/onboarding/email-actions';
import { WcButton } from '@/components/wc/WcButton';
import { isAppleRelayEmail } from '@/lib/auth/email-change';

/*
 * 로그인 이메일이 쓸 수 없는 주소(Apple 이메일 가리기 릴레이·빈 값)인 회원의 이메일 변경(2026-11-17 사용자 결정 '선택 변경').
 * 서버 페이지가 대상 계정에만 그린다. 릴레이 주소는 그대로 써도 되므로(발신 도메인 등록 뒤 메일함으로 전달) 선택이고,
 * 이메일이 없는 계정만 필수다. 새 이메일 → 메일로 받은 6자리 코드 확인 → 로그인 이메일 변경(서버·DB가 판정).
 * 온보딩에서는 1단계 폼 바깥에 둔다 — 폼 안에 폼을 넣을 수 없다.
 */

export interface EmailChangePanelView {
  currentEmail: string;
  /** 이메일이 아예 없는 계정 — 바꾸기 전에는 온보딩을 마칠 수 없다. */
  required: boolean;
  /** 메일 발송 설정이 없거나 처리방침 시행 전이라 지금은 바꿀 수 없다(필수 계정에만 그린다). */
  unavailable?: boolean;
}

const emptyState: EmailChangeActionState = {};

export function EmailChangePanel({
  context,
  isConfigured,
  view,
}: {
  context: 'onboarding' | 'settings';
  isConfigured: boolean;
  view: EmailChangePanelView;
}) {
  const [requestState, requestAction, requestPending] = useActionState(requestEmailChangeCodeAction, emptyState);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyEmailChangeCodeAction, emptyState);
  /* 선택일 때는 [이메일 바꾸기]를 눌러야 입력 칸이 열린다. 필수(이메일 없음)면 처음부터 연다. */
  const [open, setOpen] = useState(view.required);
  /* [이메일 다시 입력]은 지금 받은 요청 하나만 접는다. 다음 요청 결과는 다시 코드 단계를 연다. */
  const [dismissedRequest, setDismissedRequest] = useState<EmailChangeActionState | null>(null);

  const activeChallenge = requestState.stage === 'code_sent' && requestState !== dismissedRequest ? requestState.challengeId : undefined;
  const verifyResult = activeChallenge && verifyState.challengeId === activeChallenge ? verifyState : null;
  const changed = verifyResult?.stage === 'changed';
  const codeStage = !changed && activeChallenge && !verifyResult?.restart;
  const emailError = !codeStage ? requestState.errors?.email : undefined;
  const formError = codeStage
    ? verifyResult?.errors?.form
    : verifyResult?.restart ? verifyResult.errors?.form : requestState.errors?.form;
  const onboarding = context === 'onboarding';
  const formClass = onboarding ? 'wc-auth__form' : 'wc-mypage__form';
  const statusClass = onboarding ? 'wc-auth__status' : 'wc-mypage__success';
  const relay = isAppleRelayEmail(view.currentEmail);

  return (
    <section
      aria-labelledby={`${context}-email-change-title`}
      className={onboarding ? 'onboarding-birth-fieldset onboarding-gender-fieldset' : 'wc-mypage__form'}
      data-email-change={changed ? 'changed' : codeStage ? 'code' : open ? 'email' : 'closed'}
    >
      {onboarding ? (
        <p className="wc-auth__picks-title" id={`${context}-email-change-title`}>
          이메일 <em className={view.required ? 'wc-auth__req' : 'wc-auth__opt'}>{view.required ? '필수' : '선택 변경'}</em>
        </p>
      ) : (
        <h2 className="wc-mypage__subtitle" id={`${context}-email-change-title`}>이메일</h2>
      )}
      {view.currentEmail ? <input aria-label="지금 이메일" disabled value={changed ? verifyResult?.email ?? view.currentEmail : view.currentEmail} /> : null}
      <p className={onboarding ? 'onboarding-birth-hint' : 'wc-mypage__note'}>
        {view.required
          ? '로그인한 계정에서 이메일을 받지 못했어요. 주문·배송 안내를 받을 이메일을 입력하고 메일로 받은 인증 코드로 확인해주세요.'
          : relay
            ? 'Apple의 이메일 가리기 주소로 가입했어요. 주문·배송 안내를 다른 이메일로 받고 싶으면 바꿀 수 있어요.'
            : '다른 이메일로 바꿀 수 있어요.'}
      </p>

      {view.unavailable ? (
        <div className="wc-auth__alert" role="alert">
          지금은 여기서 이메일을 등록할 수 없어요. 잠시 후 다시 시도하거나 고객센터로 알려주세요.
        </div>
      ) : changed ? (
        <div aria-live="polite" className={statusClass} role="status">
          {verifyResult?.message}
        </div>
      ) : !open ? (
        <button className="wc-auth__picks-skip" onClick={() => setOpen(true)} type="button">
          다른 이메일로 바꾸기
        </button>
      ) : codeStage ? (
        <form action={verifyAction} className={formClass}>
          <input name="challengeId" type="hidden" value={activeChallenge} />
          <input name="context" type="hidden" value={context} />
          <input name="email" type="hidden" value={requestState.email ?? ''} />
          {requestState.message ? (
            <div aria-live="polite" className={statusClass} role="status">
              {requestState.message}
            </div>
          ) : null}
          <input
            aria-describedby={verifyResult?.errors?.code ? `${context}-email-code-error` : undefined}
            aria-invalid={Boolean(verifyResult?.errors?.code)}
            aria-label="이메일 인증 코드"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            name="code"
            placeholder="인증 코드 6자리"
          />
          {verifyResult?.errors?.code ? (
            <span className="wc-auth__error" id={`${context}-email-code-error`}>{verifyResult.errors.code}</span>
          ) : null}
          {formError ? <div className="wc-auth__alert" role="alert">{formError}</div> : null}
          <WcButton disabled={!isConfigured || verifyPending} type="submit" variant="primary">
            {verifyPending ? '확인 중' : '인증 코드 확인'}
          </WcButton>
          <button className="wc-auth__picks-skip" onClick={() => setDismissedRequest(requestState)} type="button">
            이메일 다시 입력·인증 코드 다시 받기
          </button>
        </form>
      ) : (
        <form action={requestAction} className={formClass}>
          <input
            aria-describedby={emailError ? `${context}-email-change-error` : undefined}
            aria-invalid={Boolean(emailError)}
            aria-label="바꿀 이메일"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            name="email"
            placeholder="이메일 주소"
            type="email"
          />
          {emailError ? <span className="wc-auth__error" id={`${context}-email-change-error`}>{emailError}</span> : null}
          {formError ? <div className="wc-auth__alert" role="alert">{formError}</div> : null}
          <WcButton disabled={!isConfigured || requestPending} type="submit">
            {requestPending ? '보내는 중' : '인증 코드 받기'}
          </WcButton>
          {!view.required ? (
            <button className="wc-auth__picks-skip" onClick={() => setOpen(false)} type="button">
              바꾸지 않기
            </button>
          ) : null}
        </form>
      )}
    </section>
  );
}
