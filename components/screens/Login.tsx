'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import { signInWithEmailAction, signUpWithEmailAction, type AuthActionState } from '@/app/login/actions';

type LoginMode = 'signin' | 'signup';

interface LoginProps {
  initialError?: string;
  initialMode: LoginMode;
  isConfigured: boolean;
  next: string;
  /* 좌측 브랜드 패널의 플로팅 카드 아트 (카탈로그 상위 카드 bg) */
  panelCards: string[];
}

const emptyState: AuthActionState = {};

const inputStyle: React.CSSProperties = {
  height: 50, padding: '0 18px', borderRadius: 14,
  border: '1px solid var(--line-2)', background: 'rgba(21,17,42,.7)',
  color: 'var(--text)', fontSize: 14.5, fontFamily: 'inherit', outline: 'none',
};

function Field({
  error,
  name,
  placeholder,
  type = 'text',
}: {
  error?: string;
  name: string;
  placeholder: string;
  type?: string;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;

  return (
    <div className="col" style={{ gap: 6 }}>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        aria-label={placeholder}
        id={inputId}
        name={name}
        type={type}
        placeholder={placeholder}
        style={inputStyle}
        onFocus={(e) => (e.target.style.borderColor = 'rgba(139,92,255,.7)')}
        onBlur={(e) => (e.target.style.borderColor = 'var(--line-2)')}
      />
      {error && (
        <span id={errorId} style={{ color: 'var(--pink)', fontSize: 12.5, fontWeight: 600 }}>
          {error}
        </span>
      )}
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="dot" />ICONS
    </Link>
  );
}

export function Login({ initialError, initialMode, isConfigured, next, panelCards }: LoginProps) {
  const [mode, setMode] = useState<LoginMode>(initialMode);
  const [signInState, signInAction, signInPending] = useActionState(signInWithEmailAction, emptyState);
  const [signUpState, signUpAction, signUpPending] = useActionState(signUpWithEmailAction, emptyState);
  const isSignUp = mode === 'signup';
  const state = isSignUp ? signUpState : signInState;
  const pending = isSignUp ? signUpPending : signInPending;
  const formError = state.errors?.form ?? (state.message ? undefined : initialError);

  const tab = (m: LoginMode, label: string) => {
    const active = mode === m;
    return (
      <button
        key={m}
        type="button"
        onClick={() => setMode(m)}
        style={{
          height: 34, padding: '0 18px', borderRadius: 999, fontSize: 13,
          fontWeight: active ? 700 : 500,
          color: active ? '#0A0813' : 'var(--dim)',
          background: active ? 'var(--text)' : 'transparent',
          transition: 'all .2s ease',
        }}
      >
        {label}
      </button>
    );
  };

  const cardPositions = [
    { left: '6%', top: '10%', width: 172, rot: '-7deg', dur: '8s', delay: '0s', z: 1 },
    { left: '38%', top: 0, width: 186, rot: '3deg', dur: '7s', delay: '.6s', z: 2 },
    { left: '68%', top: '22%', width: 160, rot: '9deg', dur: '9s', delay: '1.1s', z: 1 },
  ];

  return (
    <div className="login-split" style={{ minHeight: '100vh' }}>
      {/* left / brand panel */}
      <div className="login-panel" style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '40px clamp(32px, 4vw, 64px)', borderRight: '1px solid var(--line)', overflow: 'hidden' }}>
        <Brand />
        <div style={{ position: 'relative', height: 340 }}>
          {panelCards.slice(0, 3).map((bg, i) => {
            const pos = cardPositions[i];
            return (
              <div
                key={i}
                className="home-float"
                style={{ position: 'absolute', left: pos.left, top: pos.top, width: pos.width, zIndex: pos.z, animationDuration: pos.dur, animationDelay: pos.delay }}
              >
                <div
                  style={{
                    aspectRatio: '5 / 7', borderRadius: 16, overflow: 'hidden', position: 'relative',
                    background: bg, backgroundSize: 'cover', backgroundPosition: 'center',
                    transform: `rotate(${pos.rot})`,
                    boxShadow: i === 1
                      ? '0 34px 80px -26px rgba(0,0,0,.95), 0 0 0 1px rgba(255,255,255,.16), 0 0 50px -14px rgba(139,92,255,.6)'
                      : '0 30px 70px -24px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.14)',
                  }}
                >
                  {i === 1 && (
                    <span className="mono" style={{ position: 'absolute', top: 10, left: 10, fontSize: 10, letterSpacing: '.06em', padding: '4px 8px', borderRadius: 5, fontWeight: 700, color: '#0A0813', background: 'var(--holo)', backgroundSize: '200% 200%', animation: 'holoShift 5s ease infinite' }}>HOLO</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(34px, 3.6vw, 52px)', lineHeight: 1.05, letterSpacing: '-0.04em' }}>
            누구의 <span className="holo-text" style={{ backgroundSize: '200% 200%' }}>팬</span>이세요?
          </h1>
          <p style={{ margin: '14px 0 0', fontSize: 15, color: 'var(--dim)', maxWidth: 380, textWrap: 'pretty' }}>
            사고 · 모으고 · 만나고 · 떠들고 — 흩어져 있던 덕질을 한 곳에서.
          </p>
          <div className="mono" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 26, fontSize: 11.5, color: 'var(--faint)', letterSpacing: '.04em' }}>
            <span>✓ 공식 라이선스 정품만 입점</span>
            <span>✓ 가챠 확률 전문 공시 · 천장 보장</span>
            <span>✓ 토스페이먼츠 안전 결제 · 미사용 충전금 전액 환불</span>
          </div>
        </div>
      </div>

      {/* right / form panel */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', minHeight: '100vh', boxSizing: 'border-box' }}>
        <div className="login-mobile-brand" style={{ marginBottom: 28 }}>
          <Brand />
        </div>
        <div style={{ width: 'min(400px, 100%)' }} className="rise">
          <div style={{ display: 'inline-flex', padding: 4, borderRadius: 999, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.03)', gap: 2 }}>
            {tab('signin', '로그인')}
            {tab('signup', '회원가입')}
          </div>
          <h2 style={{ margin: '22px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.03em' }}>
            {isSignUp ? '3초면 충분해요' : '다시 만나서 반가워요'}
          </h2>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--dim)' }}>
            {isSignUp ? '이메일로 가입하고 최애의 세계를 열어보세요.' : '오늘의 드랍과 팬덤 소식이 기다리고 있어요.'}
          </p>

          <form action={isSignUp ? signUpAction : signInAction} className="col" style={{ gap: 10, marginTop: 24 }}>
            <input type="hidden" name="next" value={next} />
            <Field error={state.errors?.email} name="email" placeholder="이메일" type="email" />
            <Field error={state.errors?.password} name="password" placeholder="비밀번호" type="password" />
            {formError && (
              <div role="alert" style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(255,77,157,.3)', color: 'var(--pink)', fontSize: 13.5, fontWeight: 700 }}>
                {formError}
              </div>
            )}
            {state.message && (
              <div role="status" style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(56,240,192,.3)', color: 'var(--mint)', fontSize: 13.5, fontWeight: 700 }}>
                {state.message}
              </div>
            )}
            <button className="btn btn-holo" disabled={!isConfigured || pending} style={{ width: '100%', height: 52, marginTop: 4, fontSize: 15 }}>
              {pending ? '처리 중' : isSignUp ? '가입하고 시작하기' : '로그인'}
            </button>
          </form>
          {!isSignUp && (
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button type="button" className="mono" style={{ fontSize: 11.5, color: 'var(--faint)' }}>비밀번호를 잊으셨나요?</button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0' }}>
            <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.09)' }} />
            <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.14em', color: 'var(--faint)' }}>또는</span>
            <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.09)' }} />
          </div>

          <div className="col" style={{ gap: 9 }}>
            <button type="button" style={{ height: 48, borderRadius: 999, fontWeight: 600, fontSize: 14, color: '#1F1F1F', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
              <span style={{ fontWeight: 700 }}>G</span> Google로 계속하기
            </button>
            <button type="button" style={{ height: 48, borderRadius: 999, fontWeight: 600, fontSize: 14, color: '#fff', background: '#000', border: '1px solid rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
               Apple로 계속하기
            </button>
            <button type="button" style={{ height: 48, borderRadius: 999, fontWeight: 600, fontSize: 14, color: '#191919', background: '#FEE500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
              <span style={{ fontWeight: 800 }}>K</span> 카카오로 계속하기
            </button>
          </div>

          <p className="mono" style={{ margin: '20px 0 0', textAlign: 'center', fontSize: 10, color: 'var(--faint)', letterSpacing: '.03em', lineHeight: 1.7 }}>
            둘러보기는 로그인 없이 가능해요 · <Link href="/" style={{ color: 'var(--dim)', textDecoration: 'underline' }}>먼저 구경하기</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
