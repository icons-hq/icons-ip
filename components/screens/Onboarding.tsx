'use client';

import { useActionState, useState } from 'react';
import { completeOnboardingAction, type OnboardingActionState } from '@/app/onboarding/actions';
import { ipAccent } from '@/lib/ip-display';

interface OnboardingProps {
  birthDate: string;
  email: string;
  followedIpIds: string[];
  initialMarketing: boolean;
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

const inputStyle: React.CSSProperties = {
  height: 50, padding: '0 18px', borderRadius: 14,
  border: '1px solid var(--line-2)', background: 'rgba(21,17,42,.7)',
  color: 'var(--text)', fontSize: 14.5, fontFamily: 'inherit', outline: 'none',
};

function ErrorText({ children, id }: { children?: string; id: string }) {
  if (!children) return null;
  return (
    <span id={id} style={{ color: 'var(--pink)', fontSize: 12.5, fontWeight: 600 }}>
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
}: {
  defaultChecked?: boolean;
  errorId?: string;
  hasError?: boolean;
  label: string;
  name: string;
  required: boolean;
}) {
  const [checked, setChecked] = useState(Boolean(defaultChecked));
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, cursor: 'pointer' }}>
      <input
        aria-describedby={hasError ? errorId : undefined}
        aria-invalid={hasError}
        checked={checked}
        name={name}
        onChange={(e) => setChecked(e.target.checked)}
        type="checkbox"
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
      />
      <span aria-hidden style={{ flex: '0 0 auto', width: 22, height: 22, borderRadius: 7, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, color: '#0A0813', border: `1px solid ${checked ? 'transparent' : 'var(--line-3)'}`, background: checked ? 'var(--holo)' : 'transparent', transition: 'all .2s ease' }}>
        {checked ? '✓' : ''}
      </span>
      <span style={{ fontSize: 13.5, color: '#C9C3E4' }}>
        {label} <span className="mono" style={{ fontSize: 10, color: required ? 'var(--pink)' : 'var(--faint)' }}>{required ? '필수' : '선택'}</span>
      </span>
    </label>
  );
}

function IpPickTile({
  bg,
  defaultChecked,
  accent,
  id,
  title,
}: {
  bg: string;
  defaultChecked: boolean;
  accent: string;
  id: string;
  title: string;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <label
      style={{
        display: 'block', position: 'relative', borderRadius: 16, overflow: 'hidden', aspectRatio: '16 / 10',
        background: bg, backgroundSize: 'cover', backgroundPosition: 'center', cursor: 'pointer',
        boxShadow: checked ? `0 0 0 2px ${accent}, 0 16px 40px -16px ${accent}` : '0 0 0 1px rgba(255,255,255,.12)',
        transition: 'box-shadow .25s ease, transform .25s ease',
      }}
    >
      <input
        checked={checked}
        name="followIpIds"
        onChange={(e) => setChecked(e.target.checked)}
        type="checkbox"
        value={id}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
      />
      <input name="recommendedIpIds" type="hidden" value={id} />
      <span aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 30%, rgba(8,6,15,.85) 100%)' }} />
      <span style={{ position: 'absolute', left: 12, bottom: 10, right: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
        <span aria-hidden style={{ flex: '0 0 auto', width: 22, height: 22, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, color: '#0A0813', background: checked ? 'var(--holo)' : 'rgba(8,6,15,.5)', border: '1px solid rgba(255,255,255,.35)', transition: 'all .2s ease' }}>
          {checked ? '✓' : ''}
        </span>
      </span>
    </label>
  );
}

export function Onboarding({
  birthDate,
  email,
  followedIpIds,
  initialMarketing,
  isConfigured,
  next,
  nickname,
  recommendedIps,
}: OnboardingProps) {
  const [state, action, pending] = useActionState(completeOnboardingAction, emptyState);
  const initiallyFollowed = new Set(followedIpIds);

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '110px 0 80px' }}>
      <div className="rise" style={{ width: 'min(520px, 92vw)' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.03em' }}>프로필을 완성해요</h2>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--dim)' }}>커뮤니티에서 쓸 닉네임과 생년월일, 그리고 최애가 필요해요.</p>

        <form action={action} className="col" style={{ gap: 16, marginTop: 24 }}>
          <input type="hidden" name="next" value={next} />

          <input disabled value={email} aria-label="이메일" style={{ ...inputStyle, color: 'var(--dim)' }} />
          <div className="col" style={{ gap: 6 }}>
            <input
              aria-describedby={state.errors?.nickname ? 'nickname-error' : undefined}
              aria-invalid={Boolean(state.errors?.nickname)}
              aria-label="닉네임"
              defaultValue={nickname}
              name="nickname"
              placeholder="닉네임 (2–12자)"
              style={inputStyle}
            />
            <ErrorText id="nickname-error">{state.errors?.nickname}</ErrorText>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <input
              aria-describedby={state.errors?.birthDate ? 'birth-date-error' : undefined}
              aria-invalid={Boolean(state.errors?.birthDate)}
              aria-label="생년월일"
              defaultValue={birthDate}
              name="birthDate"
              type="date"
              style={inputStyle}
            />
            <ErrorText id="birth-date-error">{state.errors?.birthDate}</ErrorText>
          </div>

          <div className="col" style={{ gap: 4 }}>
            <TermRow errorId="terms-error" hasError={Boolean(state.errors?.terms)} label="이용약관 동의" name="terms" required />
            <ErrorText id="terms-error">{state.errors?.terms}</ErrorText>
            <TermRow errorId="privacy-error" hasError={Boolean(state.errors?.privacy)} label="개인정보 처리방침 동의" name="privacy" required />
            <ErrorText id="privacy-error">{state.errors?.privacy}</ErrorText>
            <TermRow defaultChecked={initialMarketing} label="마케팅 정보 수신 동의" name="marketing" required={false} />
          </div>

          {recommendedIps.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>최애를 골라보세요</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>팔로우한 IP 기준으로 홈과 알림이 맞춰져요</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 14 }}>
                {recommendedIps.map((ip) => (
                  <IpPickTile
                    key={ip.id}
                    bg={ip.bg}
                    defaultChecked={initiallyFollowed.has(ip.id)}
                    accent={ipAccent({ id: ip.id, v: { key: '', label: '', color: ip.color } })}
                    id={ip.id}
                    title={ip.title}
                  />
                ))}
              </div>
            </div>
          )}

          {state.errors?.form && (
            <div role="alert" style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(255,77,157,.3)', color: 'var(--pink)', fontSize: 13.5, fontWeight: 700 }}>
              {state.errors.form}
            </div>
          )}

          <button className="btn btn-holo" disabled={!isConfigured || pending} style={{ width: '100%', height: 52, marginTop: 4, fontSize: 15 }}>
            {pending ? '저장 중' : 'ICONS 시작하기'}
          </button>
          <p className="mono" style={{ margin: 0, textAlign: 'center', fontSize: 10, color: 'var(--faint)', letterSpacing: '.03em' }}>
            본인확인은 자가신고와 결제 시 결제사 확인으로 진행돼요
          </p>
        </form>
      </div>
    </div>
  );
}
