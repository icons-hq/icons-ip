'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { completeOnboardingAction, finishOnboardingAction, type OnboardingActionState } from '@/app/onboarding/actions';
import { CountryPicker } from '@/components/account/CountryPicker';
import { EmailChangePanel, type EmailChangePanelView } from '@/components/screens/EmailChangePanel';
import { OnboardingConsents } from '@/components/screens/OnboardingConsents';
import { PhoneVerificationPanel, type PhoneVerificationPanelView } from '@/components/screens/OnboardingPhoneVerification';
import { WcButton } from '@/components/wc/WcButton';
import { RESIDENCE_COUNTRIES } from '@/lib/country-names';
import { DEMOGRAPHIC_GENDER_LABELS } from '@/lib/customer-demographics';
import { DEMOGRAPHIC_PRIVACY_ANCHOR, legalDocumentHref } from '@/lib/legal/links';
import { MARKETING_CHANNELS, type MarketingChannel, type MarketingChannelChoices } from '@/lib/marketing-consent';

interface OnboardingProps {
  birthDate: string;
  residenceCountry?: string;
  email: string;
  /**
   * 로그인 이메일이 쓸 수 없는 주소(Apple 이메일 가리기 릴레이·빈 값)일 때만 있다 — 다른 이메일로 바꾸는 조각을 그린다
   * (2026-11-17, 릴레이는 선택·빈 값은 필수). 없으면 지금처럼 이메일을 읽기 전용으로 보인다.
   */
  emailChange?: EmailChangePanelView;
  /** 채널별 마케팅 정보 수신 동의의 현재 선택(10/14 회의 S4). */
  initialMarketing: MarketingChannelChoices;
  /** 그릴 수신 동의 수단. 카카오톡 채널 스위치가 꺼져 있으면 이메일·SMS 두 줄 그대로다(1014-010). */
  marketingChannels?: readonly MarketingChannel[];
  /**
   * 선택 성별을 받을 수 있는 계정인지. 성별 동의는 일반 회원(role=user)만 저장되므로(설정 화면과 같은 기준)
   * 운영자 초대 가입처럼 저장되지 않는 계정에는 묻지 않는다.
   */
  genderEligible: boolean;
  isConfigured: boolean;
  next: string;
  /** 휴대폰 번호 인증(1014-005·006). 스위치가 꺼져 있으면 없다 — 그때 화면은 이 단계 없이 예전과 같다. */
  phoneVerification?: PhoneVerificationPanelView;
  /**
   * 서버가 본 1단계(생년월일·약관 동의) 저장 여부. 스위치가 켜졌고 저장돼 있으면 처음부터 휴대폰 인증 단계를 연다
   * (새로고침, 또는 번호를 다른 계정에 옮겨 간 회원의 재인증).
   */
  phoneStep?: boolean;
}

const emptyState: OnboardingActionState = {};

function ErrorText({ children, id }: { children?: string; id: string }) {
  if (!children) return null;
  return (
    <span className="wc-auth__error" id={id}>
      {children}
    </span>
  );
}

/** 버튼 위 오류 요약(QA1 S-T02-02) — 칸 순서대로, 그 칸의 오류 문구로 잇는다. */
function onboardingFieldErrors(errors: Partial<Record<string, string>> | undefined): { anchor: string; label: string; message: string }[] {
  const fields = [
    { key: 'birthDate', anchor: 'birth-date-error', label: '생년월일' },
    { key: 'residenceCountry', anchor: 'residence-country-error', label: '거주 국가·지역' },
    { key: 'gender', anchor: 'gender-error', label: '성별' },
    { key: 'terms', anchor: 'terms-error', label: '이용약관 동의' },
    { key: 'privacy', anchor: 'privacy-error', label: '개인정보 처리방침 동의' },
  ];
  return fields.flatMap((field) => {
    const message = errors?.[field.key];
    return message ? [{ anchor: field.anchor, label: field.label, message }] : [];
  });
}

export function Onboarding({
  birthDate,
  email,
  emailChange,
  genderEligible,
  initialMarketing,
  isConfigured,
  marketingChannels = MARKETING_CHANNELS,
  next,
  phoneStep = false,
  phoneVerification,
  residenceCountry = '',
}: OnboardingProps) {
  const [state, action, pending] = useActionState(completeOnboardingAction, emptyState);
  const [finishState, finishAction, finishPending] = useActionState(finishOnboardingAction, emptyState);
  const [birthYear = '', birthMonth = '', birthDay = ''] = birthDate.split('-');
  const [country, setCountry] = useState(residenceCountry);
  const countryError = country ? undefined : state.errors?.residenceCountry;
  const fieldErrors = onboardingFieldErrors({ ...state.errors, residenceCountry: countryError });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const payload = new FormData(event.currentTarget);
    startTransition(() => action(payload));
  }

  /* 휴대폰 번호 인증 단계(스위치 ON): 1단계를 저장했으면(이번 제출이든 서버가 본 상태든) 인증 단계로 넘어간다.
     동의·만 14세 확인 전에는 번호를 받지 않는다(1014-005·006, 리뷰 F2). */
  const showPhoneStep = Boolean(phoneVerification) && (phoneStep || state.phoneStep === true || finishState.phoneStep === true);
  const carriedGender = finishState.carriedGender ?? state.carriedGender;

  function handleFinish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (finishPending) return;

    const payload = new FormData(event.currentTarget);
    startTransition(() => finishAction(payload));
  }

  if (showPhoneStep && phoneVerification) {
    return (
      <main className="wc-root wc-auth">
        <div className="wc-auth__panel">
          <h1 className="wc-auth__title">프로필을 완성해요</h1>
          <p className="wc-auth__lede">
            {phoneVerification.reverificationRequired
              ? '다른 계정에서 같은 휴대폰 번호를 인증해 이 계정의 휴대폰 인증이 해제됐어요. 다시 인증하면 이어서 이용할 수 있어요.'
              : '마지막으로 휴대폰 번호를 인증해주세요. 인증을 마치면 엑스스퀘어를 시작할 수 있어요.'}
          </p>
          <PhoneVerificationPanel context="onboarding" isConfigured={isConfigured} preferredCountry={country} view={phoneVerification} />
          <form action={finishAction} className="wc-auth__form" data-onboarding-finish onSubmit={handleFinish}>
            <input type="hidden" name="next" value={next} />
            {carriedGender && <input type="hidden" name="consentedGender" value={carriedGender} />}
            {finishState.errors?.form && (
              <div className="wc-auth__alert" role="alert">
                {finishState.errors.form}
              </div>
            )}
            <WcButton disabled={!isConfigured || finishPending} type="submit" variant="primary">
              {finishPending ? '확인 중' : '엑스스퀘어 시작하기'}
            </WcButton>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="wc-root wc-auth">
      <div className="wc-auth__panel">
        <h1 className="wc-auth__title">프로필을 완성해요</h1>
        <p className="wc-auth__lede">
          생년월일과 거주 국가를 입력하고 약관에 동의해주세요.
          {phoneVerification && ' 다음 단계에서 휴대폰 번호를 인증해요.'}
          {' 닉네임은 자동으로 만들어 두니 설정에서 언제든 바꿀 수 있어요.'}
        </p>

        {emailChange ? <EmailChangePanel context="onboarding" isConfigured={isConfigured} view={emailChange} /> : null}

        <form action={action} className="wc-auth__form" data-onboarding-form onSubmit={handleSubmit}>
          <input type="hidden" name="next" value={next} />

          {emailChange ? null : <input disabled value={email} aria-label="이메일" />}
          <fieldset
            aria-describedby={state.errors?.birthDate ? 'birth-date-hint birth-date-error' : 'birth-date-hint'}
            className="onboarding-birth-fieldset"
          >
            <legend>생년월일</legend>
            <span className="onboarding-birth-hint" id="birth-date-hint">예: 2000년 1월 31일 · 만 14세 이상만 가입할 수 있어요</span>
            <div className="onboarding-birth-inputs">
              <label htmlFor="birth-year">
                연도
                <input
                  aria-invalid={Boolean(state.errors?.birthDate)}
                  autoComplete="bday-year"
                  defaultValue={birthYear}
                  id="birth-year"
                  inputMode="numeric"
                  maxLength={4}
                  name="birthYear"
                  pattern="[0-9]*"
                  placeholder="YYYY"
                  type="text"
                />
              </label>
              <label htmlFor="birth-month">
                월
                <input
                  aria-invalid={Boolean(state.errors?.birthDate)}
                  autoComplete="bday-month"
                  defaultValue={birthMonth}
                  id="birth-month"
                  inputMode="numeric"
                  maxLength={2}
                  name="birthMonth"
                  pattern="[0-9]*"
                  placeholder="MM"
                  type="text"
                />
              </label>
              <label htmlFor="birth-day">
                일
                <input
                  aria-invalid={Boolean(state.errors?.birthDate)}
                  autoComplete="bday-day"
                  defaultValue={birthDay}
                  id="birth-day"
                  inputMode="numeric"
                  maxLength={2}
                  name="birthDay"
                  pattern="[0-9]*"
                  placeholder="DD"
                  type="text"
                />
              </label>
            </div>
            <ErrorText id="birth-date-error">{state.errors?.birthDate}</ErrorText>
          </fieldset>

          <div className="wc-auth__field">
            <label className="wc-auth__label" htmlFor="residence-country">거주 국가·지역 <em className="wc-auth__req">필수</em></label>
            <CountryPicker
              errorId={countryError ? 'residence-country-error' : undefined}
              id="residence-country"
              name="residenceCountry"
              onChange={setCountry}
              options={RESIDENCE_COUNTRIES}
              value={country}
            />
            <ErrorText id="residence-country-error">{countryError}</ErrorText>
          </div>

          {genderEligible && (
            <fieldset
              aria-describedby={state.errors?.gender ? 'gender-hint gender-error' : 'gender-hint'}
              className="wc-auth__field onboarding-gender"
            >
              <legend className="wc-auth__label">
                성별 <em className="wc-auth__opt">선택</em>
              </legend>
              <div className="onboarding-gender__choices">
                {(['male', 'female', 'other', ''] as const).map(gender => (
                  <label key={gender}>
                    <input className="wc-sr-only" defaultChecked={gender === ''} name="consentedGender" type="radio" value={gender} />
                    <span>{gender ? DEMOGRAPHIC_GENDER_LABELS[gender] : '선택 안 함'}</span>
                  </label>
                ))}
              </div>
              <p className="onboarding-birth-hint" id="gender-hint">
                성별을 고르면 성별 정보 수집·이용에 동의하게 돼요.{' '}
                <a
                  aria-label="성별 수집·이용에 관한 처리방침 보기"
                  className="wc-auth__policy-link"
                  href={`${legalDocumentHref('privacy')}#${DEMOGRAPHIC_PRIVACY_ANCHOR}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  처리방침 보기
                </a>
              </p>
              <ErrorText id="gender-error">{state.errors?.gender}</ErrorText>
            </fieldset>
          )}

          <OnboardingConsents
            errors={state.errors}
            initialMarketing={initialMarketing}
            marketingChannels={marketingChannels}
          />

          {state.errors?.form && (
            <div className="wc-auth__alert" role="alert">
              {state.errors.form}
            </div>
          )}
          {/* 칸 오류는 그 칸에 붙고, 모바일에서는 화면 위쪽이라 버튼 근처에서 보이지 않았다(QA1 S-T02-02) — 버튼 위에 무엇을 고칠지
              모아 보이고 그 칸으로 잇는다. */}
          {!state.errors?.form && fieldErrors.length > 0 && (
            <div className="wc-auth__alert" data-onboarding-error-summary role="alert">
              {fieldErrors.map((error) => (
                <p className="wc-auth__alert-line" key={error.anchor}>
                  <a href={`#${error.anchor}`}>{error.label}</a>: {error.message}
                </p>
              ))}
            </div>
          )}

          <WcButton disabled={!isConfigured || pending} type="submit" variant="primary">
            {pending ? '저장 중' : phoneVerification ? '다음: 휴대폰 번호 인증' : '엑스스퀘어 시작하기'}
          </WcButton>
          <p className="wc-auth__legal">
            본인확인은 자가신고와 결제 시 결제사 확인으로 진행돼요
          </p>
        </form>
      </div>
    </main>
  );
}
