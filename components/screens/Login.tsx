'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import {
  requestPasswordResetAction,
  signInWithEmailAction,
  signInWithSocialAction,
  signUpWithEmailAction,
  type AuthActionState,
} from '@/app/login/actions';
import { WcButton } from '@/components/wc/WcButton';

export type LoginMode = 'signin' | 'signup' | 'reset';

interface LoginProps {
  initialError?: string;
  initialMessage?: string;
  initialMode: LoginMode;
  isConfigured: boolean;
  next: string;
}

const emptyState: AuthActionState = {};

function Field({
  error,
  autoComplete,
  label,
  name,
  placeholder,
  type = 'text',
}: {
  error?: string;
  autoComplete: string;
  label: string;
  name: string;
  placeholder: string;
  type?: string;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;

  return (
    <div className="wc-auth__field">
      <input
        aria-label={label}
        autoComplete={autoComplete}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        id={inputId}
        name={name}
        spellCheck={type === 'email' ? false : undefined}
        type={type}
        placeholder={placeholder}
      />
      {error && (
        <span className="wc-auth__error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

/*
 * 비밀번호 칸 (현업 슬라이스 5 · 「비밀번호 입력에 대/소문자 표시」).
 *
 * 두 가지를 한다: **Caps Lock 켜짐 경고**와 **보기 토글**. 로그인 실패의 흔한 원인이
 * 「대문자로 쳤다」인데, 화면이 점만 보여 주면 몇 번이고 같은 실수를 반복한다.
 *
 * Caps 상태는 **키 이벤트로만** 읽는다 — 브라우저는 그 밖에 알려 주지 않고, 렌더 중에
 * 물어볼 방법도 없다. 그래서 첫 타를 치기 전에는 아무 말도 하지 않는다(모르는 것을
 * 「꺼짐」이라고 말하지 않는다).
 *
 * 보기 토글은 **로그인 화면 한정**이다. 어깨 너머로 보이는 위험을 감수할 자리는 자기
 * 비밀번호를 자기가 치는 순간뿐이다.
 */
function PasswordField({
  autoComplete,
  error,
  label,
  name,
  placeholder,
}: {
  autoComplete: string;
  error?: string;
  label: string;
  name: string;
  placeholder: string;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const capsId = `${inputId}-caps`;
  const [revealed, setRevealed] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const readCaps = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsOn(event.getModifierState('CapsLock'));
  };

  return (
    <div className="wc-auth__field">
      <div className="wc-auth__password">
        <input
          aria-label={label}
          autoComplete={autoComplete}
          aria-describedby={[error ? errorId : null, capsOn ? capsId : null].filter(Boolean).join(' ') || undefined}
          aria-invalid={Boolean(error)}
          id={inputId}
          name={name}
          onBlur={() => setCapsOn(false)}
          onKeyDown={readCaps}
          onKeyUp={readCaps}
          placeholder={placeholder}
          type={revealed ? 'text' : 'password'}
        />
        <button
          aria-pressed={revealed}
          className="wc-auth__reveal"
          onClick={() => setRevealed((current) => !current)}
          type="button"
        >
          {revealed ? '숨기기' : '보기'}
        </button>
      </div>
      {capsOn && (
        <p className="wc-auth__notice" id={capsId} role="status">
          Caps Lock 이 켜져 있습니다.
        </p>
      )}
      {error && (
        <span className="wc-auth__error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

/* 원형 55px 소셜 버튼 열 — 브랜드 마크만 담고 접근 이름은 aria-label 로 남긴다. */
function SocialMark({ provider }: { provider: 'google' | 'apple' | 'kakao' }) {
  if (provider === 'apple') {
    return (
      <svg aria-hidden fill="currentColor" height="22" viewBox="0 0 24 24" width="22">
        <path d="M16.7 12.9c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-2-.9-3.2-.9-1.7 0-3.2 1-4 2.5-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.4 0 1.9.8 3.2.8 1.3 0 2.1-1.2 2.9-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.4-1-2.4-3.9zM14.4 5.6c.7-.8 1.1-1.9 1-3-1 0-2.1.6-2.8 1.4-.6.7-1.2 1.9-1 3 1 .1 2.1-.6 2.8-1.4z" />
      </svg>
    );
  }
  return <span aria-hidden>{provider === 'google' ? 'G' : 'K'}</span>;
}

export function Login({ initialError, initialMessage, initialMode, isConfigured, next }: LoginProps) {
  const [signInState, signInAction, signInPending] = useActionState(signInWithEmailAction, emptyState);
  const [signUpState, signUpAction, signUpPending] = useActionState(signUpWithEmailAction, emptyState);
  const [resetState, resetAction, resetPending] = useActionState(requestPasswordResetAction, emptyState);
  const [socialState, socialAction, socialPending] = useActionState(signInWithSocialAction, emptyState);

  const isSignUp = initialMode === 'signup';
  const isReset = initialMode === 'reset';
  const state = isReset ? resetState : isSignUp ? signUpState : signInState;
  const pending = isReset ? resetPending : isSignUp ? signUpPending : signInPending;
  const formError = state.errors?.form
    ?? (!isReset ? socialState.errors?.form : undefined)
    ?? (state.message ? undefined : initialError);
  const formMessage = state.message ?? (!isSignUp && !isReset ? initialMessage : undefined);
  const modeHref = (m: LoginMode) => `/login?mode=${m}${next === '/' ? '' : `&next=${encodeURIComponent(next)}`}`;
  const resetHref = modeHref('reset');
  const signInHref = modeHref('signin');

  return (
    <main className="wc-root wc-auth">
      <div className="wc-auth__panel">
        <p className="wc-auth__step-note">
          <Link href="/">ICONS</Link>
        </p>
        <h1 className={`wc-auth__title${isReset ? ' wc-auth__title--sub' : ''}`}>
          {isReset ? '비밀번호 재설정' : isSignUp ? '이메일 회원가입' : '로그인'}
        </h1>
        {isReset ? (
          <p className="wc-auth__lede">비밀번호 재설정을 위해 이메일을 보내드릴게요.</p>
        ) : null}

        <form action={isReset ? resetAction : isSignUp ? signUpAction : signInAction} className="wc-auth__form">
          <input type="hidden" name="next" value={next} />
          <Field autoComplete="email" error={state.errors?.email} label="이메일" name="email" placeholder="이메일" type="email" />
          {!isReset && (
            <PasswordField
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              error={state.errors?.password}
              label="비밀번호"
              name="password"
              placeholder="비밀번호"
            />
          )}
          {!isSignUp && !isReset && (
            <p className="wc-auth__aside-link">
              <Link href={resetHref}>비밀번호를 잊으셨나요?</Link>
            </p>
          )}
          {formError && (
            <div className="wc-auth__alert" role="alert">
              {formError}
            </div>
          )}
          {formMessage && (
            <div aria-live="polite" className="wc-auth__status" role="status">
              {formMessage}
            </div>
          )}
          <WcButton disabled={!isConfigured || pending} type="submit" variant="primary">
            {pending
              ? isReset ? '메일 보내는 중…' : '처리 중'
              : isReset ? '재설정 메일 받기' : isSignUp ? '회원가입' : '로그인'}
          </WcButton>
          {!isSignUp && !isReset && (
            <WcButton href={modeHref('signup')}>이메일 회원가입</WcButton>
          )}
        </form>

        {isSignUp && (
          <p className="wc-auth__switch">
            이미 계정이 있나요? <Link href={signInHref}>로그인</Link>
          </p>
        )}
        {isReset && (
          <p className="wc-auth__switch">
            <Link href={signInHref}>로그인으로 돌아가기</Link>
          </p>
        )}

        {!isReset && (
          <div className="wc-auth__social">
            <h2 className="wc-auth__social-title">SNS 계정으로 {isSignUp ? '시작' : '로그인'}</h2>
            <p className="wc-auth__social-sub">처음이라면 소셜 계정으로 바로 가입돼요.</p>
            <form action={socialAction} className="wc-auth__social-row">
              <input type="hidden" name="next" value={next} />
              <button
                aria-label="Google로 계속하기"
                className="wc-auth__social-btn"
                disabled={!isConfigured || socialPending}
                name="provider"
                type="submit"
                value="google"
              >
                <SocialMark provider="google" />
              </button>
              <button
                aria-label="카카오로 계속하기"
                className="wc-auth__social-btn wc-auth__social-btn--kakao"
                disabled={!isConfigured || socialPending}
                name="provider"
                type="submit"
                value="kakao"
              >
                <SocialMark provider="kakao" />
              </button>
              <button
                aria-label="Apple로 계속하기"
                className="wc-auth__social-btn wc-auth__social-btn--apple"
                disabled={!isConfigured || socialPending}
                name="provider"
                type="submit"
                value="apple"
              >
                <SocialMark provider="apple" />
              </button>
            </form>
          </div>
        )}

        <p className="wc-auth__legal">
          둘러보기는 로그인 없이 가능해요 · <Link href="/">먼저 구경하기</Link>
          <br />
          공식 라이선스 정품만 입점 · 결제사 승인 확인 후 주문 확정
        </p>
      </div>
    </main>
  );
}
