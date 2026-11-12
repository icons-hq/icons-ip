'use client';

import Link from 'next/link';
import { startTransition, useActionState, useEffect, useId, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  requestPasswordResetAction,
  resendSignupCodeAction,
  signInWithEmailAction,
  signInWithSocialAction,
  signUpWithEmailAction,
  verifySignupCodeAction,
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
   (로그인 유지는 옆의 '로그인 상태 유지' 체크가 정한다 — SHEET-005, lib/supabase/session-persistence.ts).
   저장소를 못 쓰는 브라우저에서는 조용히 넘어간다. */
export const SAVED_LOGIN_EMAIL_KEY = 'icons:login:saved-email';
const MAX_SAVED_EMAIL_LENGTH = 254;
const savedEmailListeners = new Set<() => void>();

function savableEmail(value: string): string | null {
  const email = value.trim();
  return email.length <= MAX_SAVED_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

/** 소셜 폼의 keepSignedIn 숨은 칸 값. 체크 칸은 로그인 모드에만 있으므로 가입 모드는 상태와 무관하게 늘 기본값(유지)이다 —
 *  로그인 모드에서 끈 체크가 [이메일 회원가입]으로 넘어간 뒤에도 남아 가입 세션을 몰래 세션 쿠키로 만들지 않는다. */
export function socialKeepSignedInValue(isSignUp: boolean, keepSignedIn: boolean): '1' | '0' {
  return isSignUp || keepSignedIn ? '1' : '0';
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

/* 가입 확인 코드 단계 복원(1014-004, 리뷰 F5) — 새로고침이나 메일 앱을 오가며 화면이 다시 열려도, 확인 메일을 보낸
   이메일을 이 탭(sessionStorage)에서만 1시간 기억해 [받은 코드 입력하기]로 재발송 없이 코드 입력 단계를 다시 연다.
   비밀번호는 저장하지 않는다. 코드 확인을 보내면 지우고, 확인이 실패하면 다시 기억한다. */
export const PENDING_SIGNUP_KEY = 'icons:signup:pending';
const PENDING_SIGNUP_TTL_MS = 60 * 60 * 1000;
const pendingSignupListeners = new Set<() => void>();

export function readPendingSignupEmail(): string | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_SIGNUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: unknown; at?: unknown };
    const now = Date.now();
    if (typeof parsed.email !== 'string' || typeof parsed.at !== 'number' || parsed.at > now || now - parsed.at > PENDING_SIGNUP_TTL_MS) return null;
    return savableEmail(parsed.email);
  } catch {
    return null;
  }
}

/** 확인 메일을 보낸 이메일을 기억하거나(이메일) 지운다(null). */
export function savePendingSignupEmail(email: string | null): void {
  try {
    const value = email ? savableEmail(email) : null;
    if (value) window.sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify({ email: value, at: Date.now() }));
    else window.sessionStorage.removeItem(PENDING_SIGNUP_KEY);
  } catch {
    /* 저장소를 못 쓰면 복원만 못 할 뿐 가입은 그대로 진행한다. */
  }
  pendingSignupListeners.forEach((listener) => listener());
}

function subscribePendingSignup(listener: () => void) {
  pendingSignupListeners.add(listener);
  return () => {
    pendingSignupListeners.delete(listener);
  };
}

function Field({
  error,
  autoComplete,
  defaultValue,
  inputMode,
  label,
  maxLength,
  name,
  placeholder,
  type = 'text',
}: {
  error?: string;
  autoComplete: string;
  /** 비제어 입력의 처음 값 — 폼 액션이 끝나 폼이 초기화돼도 이 값으로 돌아온다. */
  defaultValue?: string;
  inputMode?: 'numeric';
  label: string;
  maxLength?: number;
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
          inputMode={inputMode}
          maxLength={maxLength}
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

/*
 * 가입 확인 코드 단계(10/14 회의 1014-004). 확인 메일 링크를 새 창에서 여는 대신, 가입한 이 화면에서 메일의 6자리
 * 코드를 입력해 가입을 이어 간다. 메일의 링크도 그대로 동작한다. 코드를 다시 받는 것은 회원가입 폼 재제출과
 * 같은 10분 3회 창을 쓴다(app/login/actions.ts).
 */
export function SignupCodeStep({
  email,
  isConfigured,
  next,
  onChangeEmail,
  password,
  restored,
  sentError,
  sentMessage,
  signInHref,
}: {
  email: string;
  isConfigured: boolean;
  next: string;
  onChangeEmail: () => void;
  /**
   * 가입 폼에 입력한 비밀번호(화면 메모리에만 있다). 코드 확인 요청에만 실어 보내 확인 뒤 비밀번호 로그인 세션을 만든다
   * (리뷰 F1). 새로고침 뒤처럼 없으면 확인을 마친 뒤 로그인 화면으로 간다.
   */
  password: string | null;
  /** 새로 연 화면에서 이 탭에 기억한 이메일로 복원한 단계다(재발송 없이 받은 코드 입력). */
  restored: boolean;
  /** 가입 제출이 남긴 오류(예: 다시 받기 한도). 코드는 이미 받은 메일로 입력할 수 있어 단계는 연다. */
  sentError?: string;
  sentMessage?: string;
  signInHref: string;
}) {
  const [verifyState, verifyAction, verifyPending] = useActionState(verifySignupCodeAction, emptyState);
  const [resendState, resendAction, resendPending] = useActionState(resendSignupCodeAction, emptyState);
  const formError = verifyState.errors?.form ?? resendState.errors?.form ?? (resendState.message ? undefined : sentError);
  const status = resendState.message ?? sentMessage;

  /* 비밀번호는 DOM에 그리지 않고 제출 순간에만 폼 데이터에 붙인다. 확인에 성공하면 화면이 이동하므로 이 탭의
     기억(받은 코드 입력하기)은 보내기 전에 지우고, 실패해 단계에 남으면 아래 효과가 다시 기억한다. */
  function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verifyPending) return;
    const payload = new FormData(event.currentTarget);
    if (password) payload.set('password', password);
    savePendingSignupEmail(null);
    startTransition(() => verifyAction(payload));
  }

  useEffect(() => {
    const failedEmail = verifyState.pendingSignupEmail ?? resendState.pendingSignupEmail;
    if (failedEmail) savePendingSignupEmail(failedEmail);
  }, [verifyState, resendState]);

  return (
    <div className="wc-auth__form" data-signup-code-step={restored ? 'restored' : 'sent'}>
      {restored ? (
        <p className="wc-auth__lede">
          <strong>{email}</strong>로 보낸 확인 코드를 입력해주세요.
          <br />
          코드는 다시 보내지 않았어요. 가장 최근 메일의 6자리를 입력해주세요.
        </p>
      ) : (
        <p className="wc-auth__lede">
          <strong>{email}</strong>로 확인 메일을 보냈어요.
          <br />
          메일에 적힌 6자리 확인 코드를 입력하면 이 화면에서 바로 가입이 이어져요.
        </p>
      )}
      <form action={verifyAction} className="wc-auth__form" onSubmit={handleVerify}>
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <Field
          autoComplete="one-time-code"
          error={verifyState.errors?.code}
          inputMode="numeric"
          label="확인 코드"
          maxLength={6}
          name="code"
          placeholder="확인 코드 6자리"
        />
        {formError && (
          <div className="wc-auth__alert" role="alert">
            {formError}
          </div>
        )}
        {!formError && status && (
          <div aria-live="polite" className="wc-auth__status" role="status">
            {status}
          </div>
        )}
        <WcButton disabled={!isConfigured || verifyPending} type="submit" variant="primary">
          {verifyPending ? '확인 중' : '확인하고 계속하기'}
        </WcButton>
        {password ? null : (
          <p className="wc-auth__legal">확인을 마치면 로그인 화면으로 이동해요. 가입한 이메일과 비밀번호로 로그인해주세요.</p>
        )}
      </form>
      <form action={resendAction} className="wc-auth__switch">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <button className="wc-auth__picks-skip" disabled={!isConfigured || resendPending} type="submit">
          {resendPending ? '보내는 중…' : '코드 다시 받기'}
        </button>
        <button className="wc-auth__picks-skip" onClick={onChangeEmail} type="button">
          다른 이메일로 가입하기
        </button>
      </form>
      <p className="wc-auth__legal">
        메일의 확인 버튼을 눌러도 가입을 마칠 수 있어요. 이미 가입한 이메일이라면 <Link href={signInHref}>로그인</Link>해주세요.
      </p>
    </div>
  );
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
  const restoredPendingEmail = useSyncExternalStore(subscribePendingSignup, readPendingSignupEmail, () => null);
  const [rememberChoice, setRememberChoice] = useState<boolean | null>(null);
  /* '로그인 상태 유지'(SHEET-005) — 기본은 체크(지금처럼 유지)다. 끄고 로그인하면 브라우저를 닫을 때 로그아웃된다(세션 쿠키). */
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  /* 가입 폼의 비밀번호 — 코드 확인 뒤 비밀번호 로그인 세션을 만들 때만 쓴다. 화면 메모리 밖에는 남기지 않는다. */
  const [signupPassword, setSignupPassword] = useState<string | null>(null);
  const rememberEmail = rememberChoice ?? Boolean(savedEmail);
  const rememberOnSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (isSignUp) {
      const password = new FormData(event.currentTarget).get('password');
      setSignupPassword(typeof password === 'string' && password ? password : null);
      return;
    }
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
  /* 확인 메일을 보낸 가입 결과마다 코드 입력 단계를 연다. [다른 이메일로 가입하기]는 그 결과 하나만 접고,
     다음 가입 제출의 새 결과는 다시 단계를 연다. */
  const [dismissedSignUpState, setDismissedSignUpState] = useState<AuthActionState | null>(null);
  /* 새로고침·메일 앱 왕복 뒤에는 이 탭에 기억한 이메일로 [받은 코드 입력하기]를 눌러 같은 단계를 다시 연다(F5). */
  const [reopenedSignupEmail, setReopenedSignupEmail] = useState<string | null>(null);
  const freshPendingEmail = isSignUp && dismissedSignUpState !== signUpState ? signUpState.pendingSignupEmail : undefined;
  const pendingSignupEmail = freshPendingEmail ?? (isSignUp ? reopenedSignupEmail ?? undefined : undefined);
  const resumableSignupEmail = isSignUp && !pendingSignupEmail ? restoredPendingEmail : null;

  /* 확인 메일을 보낸 이메일을 이 탭에 기억한다 — 가입 결과가 바뀔 때만 쓴다. */
  useEffect(() => {
    if (signUpState.pendingSignupEmail) savePendingSignupEmail(signUpState.pendingSignupEmail);
  }, [signUpState]);

  function changeSignupEmail() {
    setDismissedSignUpState(signUpState);
    setReopenedSignupEmail(null);
    setSignupPassword(null);
    savePendingSignupEmail(null);
  }

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
        {isSignUp && !pendingSignupEmail ? (
          <p className="wc-auth__lede">가입하면 입력한 이메일로 6자리 확인 코드를 보내 드려요.</p>
        ) : null}
        {resumableSignupEmail ? (
          <div className="wc-auth__switch" data-signup-code-resume>
            <span>
              <strong>{resumableSignupEmail}</strong>로 받은 확인 코드가 있나요?
            </span>
            <button className="wc-auth__picks-skip" onClick={() => setReopenedSignupEmail(resumableSignupEmail)} type="button">
              받은 코드 입력하기
            </button>
          </div>
        ) : null}

        {pendingSignupEmail ? (
          <SignupCodeStep
            email={pendingSignupEmail}
            isConfigured={isConfigured}
            next={next}
            onChangeEmail={changeSignupEmail}
            password={freshPendingEmail ? signupPassword : null}
            restored={!freshPendingEmail}
            sentError={freshPendingEmail ? signUpState.errors?.form : undefined}
            sentMessage={freshPendingEmail ? signUpState.message : undefined}
            signInHref={signInHref}
          />
        ) : (
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
                  <input checked={keepSignedIn} name="keepSignedIn" onChange={(event) => setKeepSignedIn(event.target.checked)} type="checkbox" value="1" />
                  <span>로그인 상태 유지</span>
                </label>
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
        )}

        {isSignUp && !pendingSignupEmail && (
          <p className="wc-auth__switch">
            이미 계정이 있나요? <Link href={signInHref}>로그인</Link>
          </p>
        )}
        {isReset && (
          <p className="wc-auth__switch">
            <Link href={signInHref}>로그인으로 돌아가기</Link>
          </p>
        )}

        {!isReset && !pendingSignupEmail && (
          <div className="wc-auth__social">
            <h2 className="wc-auth__social-title">SNS 계정으로 {isSignUp ? '시작' : '로그인'}</h2>
            <p className="wc-auth__social-sub">처음이라면 소셜 계정으로 바로 가입돼요.</p>
            <form action={socialAction} className="wc-auth__social-row">
              <input type="hidden" name="next" value={next} />
              {/* '로그인 상태 유지'(SHEET-005)는 소셜 로그인에도 적용한다 — 위 이메일 폼의 체크 상태를 함께 보낸다(가입 화면은 체크 칸이 없어 기본값 유지). */}
              <input type="hidden" name="keepSignedIn" value={socialKeepSignedInValue(isSignUp, keepSignedIn)} />
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
