'use client';

import {
  startTransition,
  useActionState,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  updateMarketingConsentAction,
  updateProfileAction,
  type SettingsActionState,
} from '@/app/settings/actions';
import Link from 'next/link';
import { AccountDeletionPanel } from '@/components/account/AccountDeletionPanel';
import { MemberActivityConsent } from '@/components/account/MemberActivityConsent';
import { CustomerDemographicConsent } from '@/components/account/CustomerDemographicConsent';
import { Icon } from '@/components/ui/Icon';
import { MypageShell } from '@/components/wc/MypageShell';
import { WcButton } from '@/components/wc/WcButton';
import type { AccountDeletionPresentation } from '@/lib/account-deletion';
import { updatePasswordPath } from '@/lib/auth/onboarding';
import { LEGAL_DOCUMENT_LABELS, legalDocumentHref } from '@/lib/legal/links';
import { PROFILE_IMAGE_ACCEPT } from '@/lib/profile';
import { uploadProfileAvatar } from '@/lib/profile-upload.client';

interface SettingsProps {
  accountDeletion: AccountDeletionPresentation;
  accountDeletionRequestKey: string;
  avatarInitial: string;
  avatarUrl: string | null;
  email: string;
  initialMarketing: boolean;
  isConfigured: boolean;
  nickname: string;
}

const emptyState: SettingsActionState = {};

/* 필수 동의(이용약관·개인정보)는 변경 불가 — 동의 완료 상태만 읽기 전용으로 표시 */
function RequiredConsentRow({ label }: { label: string }) {
  return (
    <div className="wc-auth__agree-row">
      <span aria-hidden className="wc-settings__consent-check">✓</span>
      <span>
        {label} <em className="wc-auth__req">필수</em>
      </span>
      <span className="wc-settings__consent-state">동의 완료</span>
    </div>
  );
}

/* 설정에서 나가는 링크 행(11 §5.7 ④ 약관 및 정책 — 16/700 + ›). 비밀번호 변경 진입도 같은 행 문법이다(MY-09). */
function SettingsLinkRow({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <li>
      <Link className="wc-settings__link-row" href={href}>
        <span>
          <strong>{label}</strong>
          {hint ? <span className="wc-settings__link-hint">{hint}</span> : null}
        </span>
        <span aria-hidden className="wc-settings__link-arrow"><Icon name="chevronRight" size={18} /></span>
      </Link>
    </li>
  );
}

function MarketingConsentRow({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <div className="wc-auth__agree-row">
      <label>
        <input
          className="settings-marketing-input"
          defaultChecked={defaultChecked}
          name="marketing"
          type="checkbox"
        />
        <span>
          마케팅 정보 수신 동의 <em className="wc-auth__opt">선택</em>
        </span>
      </label>
    </div>
  );
}

export function Settings({
  accountDeletion,
  accountDeletionRequestKey,
  avatarInitial,
  avatarUrl,
  email,
  initialMarketing,
  isConfigured,
  nickname,
}: SettingsProps) {
  const [profileState, profileAction, profilePending] = useActionState(updateProfileAction, emptyState);
  const [marketingState, marketingAction, marketingPending] = useActionState(updateMarketingConsentAction, emptyState);
  const [uploadErrors, setUploadErrors] = useState<SettingsActionState['errors']>();
  const [uploadPending, setUploadPending] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const profileBusy = uploadPending || profilePending;
  const visibleProfileErrors = uploadErrors ?? profileState.errors;

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileBusy) return;

    const form = event.currentTarget;
    const payload = new FormData(form);
    const nicknameEntry = payload.get('nickname');
    const submittedNickname = typeof nicknameEntry === 'string' ? nicknameEntry : '';
    const file = avatarInputRef.current?.files?.[0] ?? null;
    setUploadErrors(undefined);

    if (file) {
      setUploadPending(true);
      const result = await uploadProfileAvatar({ nickname: submittedNickname, file });
      setUploadPending(false);

      if (!result.ok) {
        setUploadErrors(result.errors);
        return;
      }

      payload.set('avatarPath', result.path);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }

    startTransition(() => profileAction(payload));
  }

  return (
    <MypageShell active="/settings">
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">설정</h1>
      </div>
      <p className="wc-mypage__lede">프로필을 수정하고 마케팅 정보 수신 동의를 관리해요.</p>

      <form action={profileAction} className="wc-mypage__form" onSubmit={handleProfileSubmit}>
        <h2 className="wc-mypage__subtitle">프로필</h2>
        <div className="wc-settings__avatar-row">
          <span className="wc-mypage__avatar">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="프로필 아바타" height={72} src={avatarUrl} width={72} />
            ) : (
              <span aria-hidden>{avatarInitial}</span>
            )}
          </span>
          <label className="wc-mypage__field" htmlFor="settings-avatar">
            프로필 이미지
            <input
              accept={PROFILE_IMAGE_ACCEPT}
              aria-describedby={visibleProfileErrors?.avatar ? 'settings-avatar-error' : undefined}
              aria-invalid={visibleProfileErrors?.avatar ? true : undefined}
              className="settings-avatar-input"
              id="settings-avatar"
              ref={avatarInputRef}
              type="file"
            />
            <small>JPEG, PNG, WebP · 최대 5MB</small>
          </label>
        </div>
        <input disabled value={email} aria-label="이메일" />
        <label className="wc-mypage__field" htmlFor="settings-nickname">
          닉네임
          <input
            aria-describedby={visibleProfileErrors?.nickname ? 'settings-nickname-error' : undefined}
            aria-invalid={visibleProfileErrors?.nickname ? true : undefined}
            className="settings-nickname-control"
            defaultValue={nickname}
            id="settings-nickname"
            name="nickname"
            required
          />
        </label>

        <div aria-label="프로필 저장 상태" aria-live="polite" role="group">
          {visibleProfileErrors?.nickname && (
            <p className="wc-auth__error" id="settings-nickname-error" role="alert">
              {visibleProfileErrors.nickname}
            </p>
          )}
          {visibleProfileErrors?.avatar && (
            <p className="wc-auth__error" id="settings-avatar-error" role="alert">
              {visibleProfileErrors.avatar}
            </p>
          )}
          {visibleProfileErrors?.form && (
            <div className="wc-auth__alert" role="alert">
              {visibleProfileErrors.form}
            </div>
          )}
          {!profileBusy && profileState.message && (
            <div className="wc-auth__status" role="status">
              {profileState.message}
            </div>
          )}
        </div>

        <WcButton className="settings-profile-submit" disabled={!isConfigured || profileBusy} type="submit" variant="primary">
          {profileBusy ? '저장 중' : '프로필 저장'}
        </WcButton>
      </form>

      <MemberActivityConsent />
      <CustomerDemographicConsent />
      <form action={marketingAction} className="wc-mypage__form">
        <h2 className="wc-mypage__subtitle">약관 동의</h2>
        <ul className="wc-auth__agree">
          <li><RequiredConsentRow label="이용약관 동의" /></li>
          <li><RequiredConsentRow label="개인정보 처리방침 동의" /></li>
          <li><MarketingConsentRow defaultChecked={initialMarketing} /></li>
        </ul>

        <div aria-label="마케팅 동의 저장 상태" aria-live="polite" role="group">
          {marketingState.errors?.form && (
            <div className="wc-auth__alert" role="alert">
              {marketingState.errors.form}
            </div>
          )}
          {marketingState.message && (
            <div className="wc-auth__status" role="status">
              {marketingState.message}
            </div>
          )}
        </div>

        <WcButton className="settings-marketing-submit" disabled={!isConfigured || marketingPending} type="submit" variant="primary">
          {marketingPending ? '저장 중' : '변경사항 저장'}
        </WcButton>
        <p className="wc-mypage__note">
          필수 동의는 서비스 이용을 위해 유지돼요 · 마케팅 수신 동의는 언제든 변경할 수 있어요
        </p>
      </form>

      {/* 로그인 정보 — 비밀번호 변경은 재설정과 같은 화면(/update-password)으로 들어가고 저장 뒤 이 화면으로 돌아온다.
          저장하면 모든 기기에서 로그아웃되므로 들어가기 전에 미리 알린다. */}
      <section aria-labelledby="settings-login-heading" className="wc-settings__links">
        <h2 className="wc-mypage__subtitle" id="settings-login-heading">로그인 정보</h2>
        <ul>
          <SettingsLinkRow
            hint="새 비밀번호를 저장하면 모든 기기에서 로그아웃되고 새 비밀번호로 다시 로그인해요."
            href={updatePasswordPath('/settings')}
            label="비밀번호 변경"
          />
        </ul>
      </section>

      <section aria-labelledby="settings-policy-heading" className="wc-settings__links">
        <h2 className="wc-mypage__subtitle" id="settings-policy-heading">약관 및 정책</h2>
        <ul>
          <SettingsLinkRow href={legalDocumentHref('terms')} label={LEGAL_DOCUMENT_LABELS.terms} />
          <SettingsLinkRow href={legalDocumentHref('privacy')} label={LEGAL_DOCUMENT_LABELS.privacy} />
        </ul>
      </section>

      <div className="wc-settings__danger">
        <AccountDeletionPanel
          presentation={accountDeletion}
          requestKey={accountDeletionRequestKey}
        />
      </div>
    </MypageShell>
  );
}
