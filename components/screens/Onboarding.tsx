'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { completeOnboardingAction, type OnboardingActionState } from '@/app/onboarding/actions';
import { WcButton } from '@/components/wc/WcButton';
import { DEMOGRAPHIC_GENDER_LABELS, DEMOGRAPHIC_GENDERS, DEMOGRAPHIC_NOTICE } from '@/lib/customer-demographics';
import { LEGAL_DOCUMENT_LABELS, legalDocumentHref, type LegalDocumentSlug } from '@/lib/legal/links';
import {
  MARKETING_CHANNEL_FIELDS,
  MARKETING_CHANNEL_LABELS,
  MARKETING_CHANNELS,
  MARKETING_CONSENT_NOTICE,
  type MarketingChannelChoices,
} from '@/lib/marketing-consent';

interface OnboardingProps {
  birthDate: string;
  email: string;
  followedIpIds: string[];
  /** 채널별 마케팅 정보 수신 동의의 현재 선택(10/14 회의 S4). */
  initialMarketing: MarketingChannelChoices;
  /**
   * 선택 성별을 받을 수 있는 계정인지. 성별 동의는 일반 회원(role=user)만 저장되므로(설정 화면과 같은 기준)
   * 운영자 초대 가입처럼 저장되지 않는 계정에는 묻지 않는다.
   */
  genderEligible: boolean;
  isConfigured: boolean;
  next: string;
  nickname: string;
  recommendedIps: {
    bg: string;
    color: string;
    fans: number;
    id: string;
    sub: string;
    tagline: string;
    title: string;
  }[];
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

function TermRow({
  defaultChecked,
  errorId,
  hasError,
  label,
  name,
  required,
  slug,
}: {
  defaultChecked?: boolean;
  errorId?: string;
  hasError?: boolean;
  label: string;
  name: string;
  required: boolean;
  /** 동의 대상 문서. 링크는 label 바깥에 두어야 클릭이 체크박스를 토글하지 않는다. */
  slug?: LegalDocumentSlug;
}) {
  return (
    <div className="wc-auth__agree-row">
      <label>
        <input
          aria-describedby={hasError ? errorId : undefined}
          aria-invalid={hasError}
          defaultChecked={Boolean(defaultChecked)}
          name={name}
          type="checkbox"
        />
        <span>
          {label} <em className={required ? 'wc-auth__req' : 'wc-auth__opt'}>{required ? '필수' : '선택'}</em>
        </span>
      </label>
      {slug && (
        /* 링크 목록으로 훑는 스크린리더에는 "전문 보기"만 두 번 남는다.
           보이는 문구는 그대로 두고 접근 이름에 문서 이름을 붙여 서로 구분한다(WCAG 2.4.4). */
        <a
          aria-label={`${LEGAL_DOCUMENT_LABELS[slug]} 전문 보기`}
          href={legalDocumentHref(slug)}
          rel="noreferrer"
          target="_blank"
        >
          전문 보기
        </a>
      )}
    </div>
  );
}

function IpPickTile({
  bg,
  defaultChecked,
  id,
  title,
}: {
  bg: string;
  defaultChecked: boolean;
  id: string;
  title: string;
}) {
  return (
    <label className="onboarding-ip-tile" style={{ background: bg, backgroundSize: 'cover', backgroundPosition: 'center' }}>
      <input
        defaultChecked={defaultChecked}
        name="followIpIds"
        type="checkbox"
        value={id}
      />
      <input name="recommendedIpIds" type="hidden" value={id} />
      <span className="onboarding-ip-meta">
        <span className="onboarding-ip-title">{title}</span>
        <span aria-hidden className="onboarding-ip-checkmark" />
      </span>
    </label>
  );
}

export function Onboarding({
  birthDate,
  email,
  followedIpIds,
  genderEligible,
  initialMarketing,
  isConfigured,
  next,
  nickname,
  recommendedIps,
}: OnboardingProps) {
  const [state, action, pending] = useActionState(completeOnboardingAction, emptyState);
  /* 관심 IP는 선택 단계다(10/14 회의 S2 · D5). 건너뛰면 타일과 추천 목록 입력을 함께 내려
     서버가 팔로우를 바꾸지 않는다 — 고르지 않은 채 제출해 이미 팔로우한 IP가 풀리는 일도 없다. */
  const [ipPicksSkipped, setIpPicksSkipped] = useState(false);
  const initiallyFollowed = new Set(followedIpIds);
  const [birthYear = '', birthMonth = '', birthDay = ''] = birthDate.split('-');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const payload = new FormData(event.currentTarget);
    startTransition(() => action(payload));
  }

  return (
    <main className="wc-root wc-auth">
      <div className="wc-auth__panel">
        <h1 className="wc-auth__title">프로필을 완성해요</h1>
        <p className="wc-auth__lede">서비스에서 쓸 닉네임과 생년월일을 알려주세요. 관심 IP는 골라도 되고 건너뛰어도 돼요.</p>

        <form action={action} className="wc-auth__form" data-onboarding-form onSubmit={handleSubmit}>
          <input type="hidden" name="next" value={next} />

          <input disabled value={email} aria-label="이메일" />
          <div className="wc-auth__field">
            <input
              aria-describedby={state.errors?.nickname ? 'nickname-error' : undefined}
              aria-invalid={Boolean(state.errors?.nickname)}
              aria-label="닉네임"
              defaultValue={nickname}
              name="nickname"
              placeholder="닉네임 (1–30자)"
            />
            <ErrorText id="nickname-error">{state.errors?.nickname}</ErrorText>
          </div>
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

          <ul className="wc-auth__agree">
            <li>
              <TermRow errorId="terms-error" hasError={Boolean(state.errors?.terms)} label="이용약관 동의" name="terms" required slug="terms" />
              <ErrorText id="terms-error">{state.errors?.terms}</ErrorText>
            </li>
            <li>
              <TermRow errorId="privacy-error" hasError={Boolean(state.errors?.privacy)} label="개인정보 처리방침 동의" name="privacy" required slug="privacy" />
              <ErrorText id="privacy-error">{state.errors?.privacy}</ErrorText>
            </li>
            {/* 마케팅 정보 수신 동의는 수단별 선택이다(LFS와 같은 이메일·SMS 두 줄, 10/14 회의 S4). */}
            {MARKETING_CHANNELS.map((channel) => (
              <li key={channel}>
                <TermRow
                  defaultChecked={initialMarketing[channel]}
                  label={`${MARKETING_CONSENT_NOTICE.title} (${MARKETING_CHANNEL_LABELS[channel]})`}
                  name={MARKETING_CHANNEL_FIELDS[channel]}
                  required={false}
                />
              </li>
            ))}
          </ul>
          <p className="onboarding-consent-note">
            {MARKETING_CONSENT_NOTICE.summary} {MARKETING_CONSENT_NOTICE.inApp} {MARKETING_CONSENT_NOTICE.sms} {MARKETING_CONSENT_NOTICE.change}
          </p>

          {/* 선택 성별(10/14 회의 S5). 기본은 미선택이고, 고른 경우에만 별도 수집·이용 동의를 받는다.
              저장은 온보딩 완료 직후 같은 액션에서 기존 선택 동의 경로로 한다. */}
          {genderEligible ? (
            <fieldset
              aria-describedby={state.errors?.gender ? 'gender-hint gender-error' : 'gender-hint'}
              className="onboarding-birth-fieldset onboarding-gender-fieldset"
            >
              <legend>성별 <em className="wc-auth__opt">선택</em></legend>
              <span className="onboarding-birth-hint" id="gender-hint">{DEMOGRAPHIC_NOTICE.purpose}</span>
              <select aria-invalid={Boolean(state.errors?.gender)} aria-label="통계용 성별" defaultValue="" name="gender">
                <option value="">선택 안 함</option>
                {DEMOGRAPHIC_GENDERS.map((gender) => (
                  <option key={gender} value={gender}>{DEMOGRAPHIC_GENDER_LABELS[gender]}</option>
                ))}
              </select>
              <label className="onboarding-gender-consent">
                <input name="genderConsent" type="checkbox" />
                <span>위 안내에 따라 성별 정보를 수집·이용하는 데 동의합니다. <em className="wc-auth__opt">선택</em></span>
              </label>
              <details className="onboarding-gender-notice">
                <summary>수집 항목·보관·철회 안내</summary>
                <p>{DEMOGRAPHIC_NOTICE.collected}</p>
                <p>{DEMOGRAPHIC_NOTICE.retention}</p>
                <p>{DEMOGRAPHIC_NOTICE.choice}</p>
              </details>
              <ErrorText id="gender-error">{state.errors?.gender}</ErrorText>
            </fieldset>
          ) : null}

          {recommendedIps.length > 0 && (
            <div className="wc-auth__picks" data-onboarding-ip-picks={ipPicksSkipped ? 'skipped' : 'open'}>
              <div className="wc-auth__picks-head">
                <span className="wc-auth__picks-title" id="onboarding-ip-picks-title">
                  관심 IP 고르기 <em className="wc-auth__opt">선택</em>
                </span>
                {ipPicksSkipped ? (
                  <button autoFocus className="wc-auth__picks-skip" type="button" onClick={() => setIpPicksSkipped(false)}>
                    다시 고르기
                  </button>
                ) : (
                  <button className="wc-auth__picks-skip" type="button" onClick={() => setIpPicksSkipped(true)}>
                    건너뛰기
                  </button>
                )}
              </div>
              {ipPicksSkipped ? (
                <p className="wc-auth__picks-sub" role="status">관심 IP 고르기를 건너뛰었어요. 나중에 IP 페이지에서 팔로우할 수 있어요.</p>
              ) : (
                <>
                  <p className="wc-auth__picks-sub">팔로우한 IP 기준으로 홈과 알림이 맞춰져요. 고르지 않아도 시작할 수 있어요.</p>
                  <div aria-labelledby="onboarding-ip-picks-title" className="wc-auth__choice-grid" role="group">
                    {recommendedIps.map((ip) => (
                      <IpPickTile
                        key={ip.id}
                        bg={ip.bg}
                        defaultChecked={initiallyFollowed.has(ip.id)}
                        id={ip.id}
                        title={ip.title}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {state.errors?.form && (
            <div className="wc-auth__alert" role="alert">
              {state.errors.form}
            </div>
          )}

          <WcButton disabled={!isConfigured || pending} type="submit" variant="primary">
            {pending ? '저장 중' : 'ICONS 시작하기'}
          </WcButton>
          <p className="wc-auth__legal">
            본인확인은 자가신고와 결제 시 결제사 확인으로 진행돼요
          </p>
        </form>
      </div>
    </main>
  );
}
