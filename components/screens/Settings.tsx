'use client';

import { useActionState, useState } from 'react';
import { updateMarketingConsentAction, type SettingsActionState } from '@/app/settings/actions';

interface SettingsProps {
  email: string;
  initialMarketing: boolean;
  isConfigured: boolean;
  nickname: string;
}

const emptyState: SettingsActionState = {};

const inputStyle: React.CSSProperties = {
  height: 50, padding: '0 18px', borderRadius: 14,
  border: '1px solid var(--line-2)', background: 'rgba(21,17,42,.7)',
  color: 'var(--text)', fontSize: 14.5, fontFamily: 'inherit', outline: 'none',
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
        checked={checked}
        name="marketing"
        onChange={(e) => setChecked(e.target.checked)}
        type="checkbox"
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
      />
      <span aria-hidden style={{ flex: '0 0 auto', width: 22, height: 22, borderRadius: 7, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, color: '#0A0813', border: `1px solid ${checked ? 'transparent' : 'var(--line-3)'}`, background: checked ? 'var(--holo)' : 'transparent', transition: 'all .2s ease' }}>
        {checked ? '✓' : ''}
      </span>
      <span style={{ fontSize: 13.5, color: '#C9C3E4' }}>
        마케팅 정보 수신 동의 <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>선택</span>
      </span>
    </label>
  );
}

export function Settings({ email, initialMarketing, isConfigured, nickname }: SettingsProps) {
  const [state, action, pending] = useActionState(updateMarketingConsentAction, emptyState);

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '110px 0 80px' }}>
      <div className="rise" style={{ width: 'min(520px, 92vw)' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.03em' }}>설정</h2>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--dim)' }}>계정 정보를 확인하고 마케팅 정보 수신 동의를 관리해요.</p>

        <form action={action} className="col" style={{ gap: 16, marginTop: 24 }}>
          <div className="col" style={{ gap: 10 }}>
            <SectionTitle>계정 정보</SectionTitle>
            <input disabled value={email} aria-label="이메일" style={{ ...inputStyle, color: 'var(--dim)' }} />
            <input disabled value={nickname} aria-label="닉네임" style={{ ...inputStyle, color: 'var(--dim)' }} />
          </div>

          <div className="col" style={{ gap: 4 }}>
            <SectionTitle>약관 동의</SectionTitle>
            <RequiredConsentRow label="이용약관 동의" />
            <RequiredConsentRow label="개인정보 처리방침 동의" />
            <MarketingConsentRow defaultChecked={initialMarketing} />
          </div>

          {state.errors?.form && (
            <div role="alert" style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(255,77,157,.3)', color: 'var(--pink)', fontSize: 13.5, fontWeight: 700 }}>
              {state.errors.form}
            </div>
          )}
          {state.message && (
            <div role="status" style={{ padding: 12, borderRadius: 12, border: '1px solid var(--line-2)', color: 'var(--text)', fontSize: 13.5, fontWeight: 700 }}>
              {state.message}
            </div>
          )}

          <button className="btn btn-holo" disabled={!isConfigured || pending} style={{ width: '100%', height: 52, marginTop: 4, fontSize: 15 }}>
            {pending ? '저장 중' : '변경사항 저장'}
          </button>
          <p className="mono" style={{ margin: 0, textAlign: 'center', fontSize: 10, color: 'var(--faint)', letterSpacing: '.03em' }}>
            필수 동의는 서비스 이용을 위해 유지돼요 · 마케팅 수신 동의는 언제든 변경할 수 있어요
          </p>
        </form>
      </div>
    </div>
  );
}
