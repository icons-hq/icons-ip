'use client';

import Link from 'next/link';
import { useActionState, useId, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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

/* '이메일 저장'(R29 · MD-0004) — 이 기기 localStorage 에 이메일만 둔다. 비밀번호·세션은 저장하지 않는다
   (로그인 유지는 이미 @supabase/ssr 기본 쿠키가 한다). 저장소를 못 쓰는 브라우저에서는 조용히 넘어간다. */
export const SAVED_LOGIN_EMAIL_KEY = 'icons:login:saved-email';
const MAX_SAVED_EMAIL_LENGTH = 254;
const savedEmailListeners = new Set<() => void>();

function savableEmail(value: string): string | null {
  const email = value.trim();
  return email.length <= MAX_SAVED_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

export function readSavedLoginEmail(): string | null {
  try {
    const value = window.localStorage.getItem(SAVED_LOGIN_EMAIL_KEY);
    return value === null ? null : savableEmail(value);
  } catch {
    return null;
  }
}

/** 로그인 제출 직전(서버 redirect 전)에 부른다 — 체크했으면 이메일을 남기고, 해제했으면 지운다. */
export function saveLoginEmailChoice(email: string, remember: boolean): void {
  try {
    const value = remember ? savableEmail(email) : null;
    if (value) window.localStorage.setItem(SAVED_LOGIN_EMAIL_KEY, value);
    else window.localStorage.removeItem(SAVED_LOGIN_EMAIL_KEY);
  } catch {
    /* 사생활 보호 모드 등 — 이 기기에 남기지 않을 뿐 로그인은 그대로 진행한다. */
  }
  savedEmailListeners.forEach((listener) => listener());
}

function subscribeSavedLoginEmail(listener: () => void) {
  savedEmailListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    savedEmailListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function Field({
  error,
  autoComplete,
  defaultValue,
  label,
  name,
  placeholder,
  type = 'text',
}: {
  error?: string;
  autoComplete: string;
  /** 비제어 입력의 처음 값 — 폼 액션이 끝나 폼이 초기화돼도 이 값으로 돌아온다. */
  defaultValue?: string;
  label: string;
  name: string;
  placeholder: string;
  type?: string;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const capsLockId = `${inputId}-caps-lock`;
  const isPassword = type === 'password';
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  const updateCapsLock = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isPassword) setCapsLockOn(event.getModifierState('CapsLock'));
  };

  const describedBy = [error ? errorId : null, capsLockOn ? capsLockId : null].filter(Boolean).join(' ') || undefined;
  const inputType = isPassword && passwordVisible ? 'text' : type;

  return (
    <div className="wc-auth__field">
      <div className={isPassword ? 'wc-auth__password-control' : undefined}>
        <input
          aria-label={label}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          defaultValue={defaultValue}
          aria-invalid={Boolean(error)}
          id={inputId}
          name={name}
          onBlur={() => isPassword && setCapsLockOn(false)}
          onKeyDown={updateCapsLock}
          onKeyUp={updateCapsLock}
          spellCheck={type === 'email' ? false : undefined}
          type={inputType}
          placeholder={placeholder}
        />
        {isPassword && (
          <button
            aria-controls={inputId}
            aria-label={passwordVisible ? '비밀번호 숨기기' : '비밀번호 보기'}
            aria-pressed={passwordVisible}
            className="wc-auth__password-toggle"
            onClick={() => setPasswordVisible((visible) => !visible)}
            type="button"
          >
            {passwordVisible ? '숨기기' : '보기'}
          </button>
        )}
      </div>
      {error && (
        <span className="wc-auth__error" id={errorId}>
          {error}
        </span>
      )}
      {isPassword && capsLockOn && (
        <span className="wc-auth__caps-lock" id={capsLockId} role="status">
          Caps Lock이 켜져 있어요. 대소문자를 확인해주세요.
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
  const isSignIn = !isSignUp && !isReset;
  /* 서버 렌더·하이드레이션은 null 이고, 이 기기에 저장된 이메일은 그 뒤에 읽는다 — 키가 바뀌어 이메일 칸이 그 값으로 다시 선다. */
  const savedEmail = useSyncExternalStore(subscribeSavedLoginEmail, readSavedLoginEmail, () => null);
  const [rememberChoice, setRememberChoice] = useState<boolean | null>(null);
  const rememberEmail = rememberChoice ?? Boolean(savedEmail);
  const rememberOnSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!isSignIn) return;
    const email = new FormData(event.currentTarget).get('email');
    saveLoginEmailChoice(typeof email === 'string' ? email : '', rememberEmail);
  };
  const state = isReset ? resetState : isSignUp ? signUpState : signInState;
  const pending = isReset ? resetPending : isSignUp ? signUpPending : signInPending;
  const formError = state.errors?.form
    ?? (!isReset ? socialState.errors?.form : undefined)
    ?? (state.message ? undefined : initialError);
  const formMessage = state.message ?? (!isSignUp && !isReset ? initialMessage : undefined);
  const modeHref = (m: LoginMode) => `/login?mode=${m}${next === '/' ? '' : `&next=${encodeURIComponent(next)}`}`;
  const resetHref = modeHref('reset');
  const signInHref = modeHref('signin');

  /* /login은 전역 헤더·푸터·모바일 탭바 안에서 열린다(CH-13) — 홈 진입은 헤더 로고가 맡으므로
     집중형 셸 시절의 'ICONS' 홈 링크를 패널 위에 따로 두지 않는다. 패널(448 플랫)은 그대로다. */
  return (
    <main className="wc-root wc-auth wc-auth--shell">
      <div className="wc-auth__panel">
        <h1 className={`wc-auth__title${isReset ? ' wc-auth__title--sub' : ''}`}>
          {isReset ? '비밀번호 재설정' : isSignUp ? '이메일 회원가입' : '로그인'}
        </h1>
        {isReset ? (
          <p className="wc-auth__lede">
            비밀번호 재설정을 위해 이메일을 보내드릴게요.
            <br />
            {/* AU-02 — 소셜 가입 계정은 재설정 메일 없이 바로 들어갈 수 있다는 안내 한 줄.
                제공자는 로그인 화면의 소셜 버튼과 같은 셋이고, 재설정 모드는 소셜 버튼을 두지 않는다. */}
            Google·카카오·Apple로 가입했다면 재설정 없이 로그인 화면에서 같은 SNS 계정으로 로그인할 수 있어요.
          </p>
        ) : null}

        <form action={isReset ? resetAction : isSignUp ? signUpAction : signInAction} className="wc-auth__form" onSubmit={rememberOnSubmit}>
          <input type="hidden" name="next" value={next} />
          <Field
            autoComplete="email"
            defaultValue={isSignIn ? savedEmail ?? undefined : undefined}
            error={state.errors?.email}
            key={isSignIn ? `email:${savedEmail ?? ''}` : 'email'}
            label="이메일"
            name="email"
            placeholder="이메일"
            type="email"
          />
          {!isReset && (
            <Field
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              error={state.errors?.password}
              label="비밀번호"
              name="password"
              placeholder="비밀번호"
              type="password"
            />
          )}
          {isSignIn && (
            <div className="wc-auth__agree-row">
              <label>
                <input checked={rememberEmail} onChange={(event) => setRememberChoice(event.target.checked)} type="checkbox" />
                <span>이메일 저장</span>
              </label>
            </div>
          )}
          {isSignIn && (
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
