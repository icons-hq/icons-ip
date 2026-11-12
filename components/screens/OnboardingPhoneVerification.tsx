'use client';

import { useActionState, useState } from 'react';
import {
  requestPhoneCodeAction,
  verifyPhoneCodeAction,
  type PhoneVerificationActionState,
} from '@/app/onboarding/phone-actions';
import { WcButton } from '@/components/wc/WcButton';

/*
 * 휴대폰 번호 인증(10/14 회의 1014-005·006) 화면 조각. 스위치(ICONS_PHONE_VERIFICATION_ENABLED)가 켜졌을 때만
 * 서버 페이지가 `view`를 넘기고, 꺼져 있으면 온보딩·설정 어디에도 그리지 않는다.
 * 온보딩에서는 필수, 설정에서는 이미 가입한 회원이 번호를 등록·변경하는 자리다.
 * 번호 입력 → 인증번호 문자 → 6자리 확인. 확인이 끝난 번호만 회원 정보로 남는다(서버·DB가 판정).
 */

export interface PhoneVerificationPanelView {
  countries: { iso: string; label: string }[];
  defaultCountry: string;
  verified: { maskedPhone: string } | null;
  /** 다른 계정이 같은 번호를 인증해 이 계정의 인증이 해제됐다 — 다시 인증해야 한다(사용자 결정 '옮기고 재인증 요구'). */
  reverificationRequired?: boolean;
}

const emptyState: PhoneVerificationActionState = {};

export function PhoneVerificationPanel({
  context,
  isConfigured,
  view,
}: {
  context: 'onboarding' | 'settings';
  isConfigured: boolean;
  view: PhoneVerificationPanelView;
}) {
  const [requestState, requestAction, requestPending] = useActionState(requestPhoneCodeAction, emptyState);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyPhoneCodeAction, emptyState);
  /* [번호 다시 입력]은 지금 받은 인증 요청 하나만 접는다. 다음 요청 결과는 다시 확인 단계를 연다. */
  const [dismissedRequest, setDismissedRequest] = useState<PhoneVerificationActionState | null>(null);
  const [changing, setChanging] = useState(false);

  const activeChallenge = requestState.stage === 'code_sent' && requestState !== dismissedRequest ? requestState.challengeId : undefined;
  const verifyResult = activeChallenge && verifyState.challengeId === activeChallenge ? verifyState : null;
  const justVerified = verifyResult?.stage === 'verified';
  /* 방금 확인을 마쳤거나, 서버가 읽은 인증 번호가 있고 바꾸는 중이 아니면 인증 완료로 보여 준다. */
  const showVerified = justVerified || (Boolean(view.verified) && !changing);
  const verifiedPhone = justVerified ? verifyResult?.maskedPhone : view.verified?.maskedPhone;
  const codeStage = !showVerified && activeChallenge && !verifyResult?.restart;
  const required = context === 'onboarding';
  const phoneError = !codeStage ? requestState.errors?.phone : undefined;
  const formError = codeStage
    ? verifyResult?.errors?.form
    : verifyResult?.restart ? verifyResult.errors?.form : requestState.errors?.form;
  const status = justVerified ? verifyResult?.message : codeStage ? requestState.message : undefined;
  const formClass = context === 'onboarding' ? 'wc-auth__form' : 'wc-mypage__form';

  return (
    <section
      aria-labelledby={`${context}-phone-verification-title`}
      className={context === 'onboarding' ? 'onboarding-birth-fieldset onboarding-gender-fieldset' : 'wc-mypage__form'}
      data-phone-verification={showVerified ? 'verified' : codeStage ? 'code' : 'phone'}
    >
      {context === 'onboarding' ? (
        <p className="wc-auth__picks-title" id={`${context}-phone-verification-title`}>
          휴대폰 번호 인증 <em className={required ? 'wc-auth__req' : 'wc-auth__opt'}>{required ? '필수' : '선택'}</em>
        </p>
      ) : (
        <h2 className="wc-mypage__subtitle" id={`${context}-phone-verification-title`}>휴대폰 번호</h2>
      )}
      <p className={context === 'onboarding' ? 'onboarding-birth-hint' : 'wc-mypage__note'}>
        문자로 받은 인증번호로 휴대폰 번호를 확인해요. 해외 번호도 인증할 수 있어요. 한 번호는 한 계정에서만 인증된 상태로 남아요.
      </p>
      {view.reverificationRequired && !showVerified ? (
        <div className="wc-auth__alert" role="alert">
          다른 계정에서 같은 번호를 인증해 휴대폰 인증이 해제됐어요. 주문 같은 기능을 쓰려면 다시 인증해주세요.
        </div>
      ) : null}

      {showVerified ? (
        <div className={formClass}>
          <div aria-live="polite" className={context === 'onboarding' ? 'wc-auth__status' : 'wc-mypage__success'} role="status">
            {justVerified ? `${status ?? '휴대폰 번호를 인증했어요.'} ` : ''}인증된 번호 {verifiedPhone}
          </div>
          <button
            className="wc-auth__picks-skip"
            onClick={() => {
              setChanging(true);
              setDismissedRequest(requestState);
            }}
            type="button"
          >
            다른 번호로 바꾸기
          </button>
        </div>
      ) : codeStage ? (
        <form action={verifyAction} className={formClass}>
          <input name="challengeId" type="hidden" value={activeChallenge} />
          <input name="maskedPhone" type="hidden" value={requestState.maskedPhone ?? ''} />
          {status ? (
            <div aria-live="polite" className={context === 'onboarding' ? 'wc-auth__status' : 'wc-mypage__success'} role="status">
              {status}
            </div>
          ) : null}
          <input
            aria-describedby={verifyResult?.errors?.code ? `${context}-phone-code-error` : undefined}
            aria-invalid={Boolean(verifyResult?.errors?.code)}
            aria-label="인증번호"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            name="code"
            placeholder="인증번호 6자리"
          />
          {verifyResult?.errors?.code ? (
            <span className="wc-auth__error" id={`${context}-phone-code-error`}>{verifyResult.errors.code}</span>
          ) : null}
          {formError ? <div className="wc-auth__alert" role="alert">{formError}</div> : null}
          <WcButton disabled={!isConfigured || verifyPending} type="submit" variant="primary">
            {verifyPending ? '확인 중' : '인증번호 확인'}
          </WcButton>
          <button className="wc-auth__picks-skip" onClick={() => setDismissedRequest(requestState)} type="button">
            번호 다시 입력·인증번호 다시 받기
          </button>
        </form>
      ) : (
        <form action={requestAction} className={formClass}>
          {view.countries.length > 1 ? (
            <select aria-label="휴대폰 번호의 나라" defaultValue={view.defaultCountry} name="phoneCountry">
              {view.countries.map((country) => (
                <option key={country.iso} value={country.iso}>{country.label}</option>
              ))}
            </select>
          ) : (
            <input name="phoneCountry" type="hidden" value={view.countries[0]?.iso ?? view.defaultCountry} />
          )}
          <input
            aria-describedby={phoneError ? `${context}-phone-error` : undefined}
            aria-invalid={Boolean(phoneError)}
            aria-label="휴대폰 번호"
            autoComplete="tel-national"
            inputMode="tel"
            maxLength={40}
            name="phone"
            placeholder="휴대폰 번호 (예: 010-1234-5678)"
            type="tel"
          />
          {phoneError ? <span className="wc-auth__error" id={`${context}-phone-error`}>{phoneError}</span> : null}
          {formError ? <div className="wc-auth__alert" role="alert">{formError}</div> : null}
          <WcButton disabled={!isConfigured || requestPending} type="submit">
            {requestPending ? '보내는 중' : '인증번호 받기'}
          </WcButton>
          {changing && view.verified ? (
            <button className="wc-auth__picks-skip" onClick={() => setChanging(false)} type="button">
              바꾸지 않기
            </button>
          ) : null}
        </form>
      )}
    </section>
  );
}
