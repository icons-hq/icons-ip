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
import { PROFILE_IMAGE_ACCEPT } from '@/lib/profile';
import { uploadProfileAvatar } from '@/lib/profile-upload.client';

interface SettingsProps {
  avatarInitial: string;
  avatarUrl: string | null;
  email: string;
  initialMarketing: boolean;
  isConfigured: boolean;
  nickname: string;
}

const emptyState: SettingsActionState = {};

const inputStyle: React.CSSProperties = {
  height: 50, padding: '0 18px', borderRadius: 14,
  border: '1px solid var(--line-2)', background: 'rgba(21,17,42,.7)',
  color: 'var(--text)', fontSize: 14.5, fontFamily: 'inherit',
};

function SectionTitle({ children }: { children: string }) {
  return <span style={{ fontWeight: 700, fontSize: 15 }}>{children}</span>;
}

/* 필수 동의(이용약관·개인정보)는 변경 불가 — 동의 완료 상태만 읽기 전용으로 표시 */
function RequiredConsentRow({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12 }}>
      <span aria-hidden style={{ flex: '0 0 auto', width: 22, height: 22, borderRadius: 7, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, color: '#0A0813', background: 'var(--holo)' }}>
        ✓
      </span>
      <span style={{ fontSize: 13.5, color: '#C9C3E4' }}>
        {label} <span className="mono" style={{ fontSize: 10, color: 'var(--pink)' }}>필수</span>
      </span>
      <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--faint)' }}>동의 완료</span>
    </div>
  );
}

function MarketingConsentRow({ defaultChecked }: { defaultChecked: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, cursor: 'pointer' }}>
      <input
        className="settings-marketing-input"
        checked={checked}
        name="marketing"
        onChange={(e) => setChecked(e.target.checked)}
        type="checkbox"
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
      />
      <span aria-hidden className="settings-marketing-proxy" style={{ flex: '0 0 auto', width: 22, height: 22, borderRadius: 7, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, color: '#0A0813', border: `1px solid ${checked ? 'transparent' : 'var(--line-3)'}`, background: checked ? 'var(--holo)' : 'transparent', transition: 'all .2s ease' }}>
        {checked ? '✓' : ''}
      </span>
      <span style={{ fontSize: 13.5, color: '#C9C3E4' }}>
        마케팅 정보 수신 동의 <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>선택</span>
      </span>
    </label>
  );
}

export function Settings({ avatarInitial, avatarUrl, email, initialMarketing, isConfigured, nickname }: SettingsProps) {
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
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '110px 0 80px' }}>
      <div className="rise" style={{ width: 'min(520px, 92vw)' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.03em' }}>설정</h2>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--dim)' }}>프로필을 수정하고 마케팅 정보 수신 동의를 관리해요.</p>

        <form action={profileAction} className="col" onSubmit={handleProfileSubmit} style={{ gap: 16, marginTop: 24 }}>
          <div className="col" style={{ gap: 10 }}>
            <SectionTitle>프로필</SectionTitle>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 82, height: 82, flex: '0 0 auto', overflow: 'hidden', borderRadius: '50%', border: '1px solid var(--line-2)', background: 'rgba(21,17,42,.9)', display: 'grid', placeItems: 'center' }}>
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="프로필 아바타" height={82} src={avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} width={82} />
                ) : (
                  <span aria-hidden style={{ fontFamily: 'var(--ff-display)', fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>{avatarInitial}</span>
                )}
              </div>
              <label className="col" htmlFor="settings-avatar" style={{ flex: 1, gap: 7, fontSize: 13.5, color: '#C9C3E4' }}>
                프로필 이미지
                <input
                  accept={PROFILE_IMAGE_ACCEPT}
                  aria-describedby={visibleProfileErrors?.avatar ? 'settings-avatar-error' : undefined}
                  aria-invalid={visibleProfileErrors?.avatar ? true : undefined}
                  className="settings-avatar-input"
                  id="settings-avatar"
                  ref={avatarInputRef}
                  type="file"
                  style={{ width: '100%', color: 'var(--dim)', fontFamily: 'inherit', fontSize: 12.5 }}
                />
                <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>JPEG, PNG, WebP · 최대 5MB</span>
              </label>
            </div>
            <input disabled value={email} aria-label="이메일" style={{ ...inputStyle, color: 'var(--dim)' }} />
            <label className="col" htmlFor="settings-nickname" style={{ gap: 7, fontSize: 13.5, color: '#C9C3E4' }}>
              닉네임
              <input
                aria-describedby={visibleProfileErrors?.nickname ? 'settings-nickname-error' : undefined}
                aria-invalid={visibleProfileErrors?.nickname ? true : undefined}
                className="settings-nickname-control"
                defaultValue={nickname}
                id="settings-nickname"
                name="nickname"
                required
                style={inputStyle}
              />
            </label>
          </div>

          <div aria-label="프로필 저장 상태" aria-live="polite" role="group">
            {visibleProfileErrors?.nickname && (
              <div id="settings-nickname-error" role="alert" style={{ color: 'var(--pink)', fontSize: 13, fontWeight: 700 }}>
                {visibleProfileErrors.nickname}
              </div>
            )}
            {visibleProfileErrors?.avatar && (
              <div id="settings-avatar-error" role="alert" style={{ marginTop: 8, color: 'var(--pink)', fontSize: 13, fontWeight: 700 }}>
                {visibleProfileErrors.avatar}
              </div>
            )}
            {visibleProfileErrors?.form && (
              <div role="alert" style={{ marginTop: 8, padding: 12, borderRadius: 12, border: '1px solid rgba(255,77,157,.3)', color: 'var(--pink)', fontSize: 13.5, fontWeight: 700 }}>
                {visibleProfileErrors.form}
              </div>
            )}
            {!profileBusy && profileState.message && (
              <div role="status" style={{ marginTop: 8, padding: 12, borderRadius: 12, border: '1px solid var(--line-2)', color: 'var(--text)', fontSize: 13.5, fontWeight: 700 }}>
                {profileState.message}
              </div>
            )}
          </div>

          <button className="btn btn-holo settings-profile-submit" disabled={!isConfigured || profileBusy} style={{ width: '100%', height: 52, marginTop: 4, fontSize: 15 }}>
            {profileBusy ? '저장 중' : '프로필 저장'}
          </button>
        </form>

        <form action={marketingAction} className="col" style={{ gap: 16, marginTop: 28 }}>
          <div className="col" style={{ gap: 4 }}>
            <SectionTitle>약관 동의</SectionTitle>
            <RequiredConsentRow label="이용약관 동의" />
            <RequiredConsentRow label="개인정보 처리방침 동의" />
            <MarketingConsentRow defaultChecked={initialMarketing} />
          </div>

          <div aria-label="마케팅 동의 저장 상태" aria-live="polite" role="group">
            {marketingState.errors?.form && (
              <div role="alert" style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(255,77,157,.3)', color: 'var(--pink)', fontSize: 13.5, fontWeight: 700 }}>
                {marketingState.errors.form}
              </div>
            )}
            {marketingState.message && (
              <div role="status" style={{ padding: 12, borderRadius: 12, border: '1px solid var(--line-2)', color: 'var(--text)', fontSize: 13.5, fontWeight: 700 }}>
                {marketingState.message}
              </div>
            )}
          </div>

          <button className="btn btn-holo settings-marketing-submit" disabled={!isConfigured || marketingPending} style={{ width: '100%', height: 52, marginTop: 4, fontSize: 15 }}>
            {marketingPending ? '저장 중' : '변경사항 저장'}
          </button>
          <p className="mono" style={{ margin: 0, textAlign: 'center', fontSize: 10, color: 'var(--faint)', letterSpacing: '.03em' }}>
            필수 동의는 서비스 이용을 위해 유지돼요 · 마케팅 수신 동의는 언제든 변경할 수 있어요
          </p>
        </form>
      </div>
    </div>
  );
}
