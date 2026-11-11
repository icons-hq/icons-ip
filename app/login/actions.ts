'use server';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  AUTH_CALLBACK_PATH,
  AUTH_RECOVERY_CALLBACK_PATH,
  AUTH_RECOVERY_NEXT_COOKIE_NAME,
  AUTH_NEXT_COOKIE_NAME,
  ACCOUNT_SUSPENDED_PATH,
  ACCOUNT_DELETION_PATH,
  authCallbackUrl,
  authRecoveryCallbackUrl,
  authSignUpErrorMessage,
  isAccountSuspended,
  onboardingPath,
  postAuthenticationPath,
  safeNextPath,
  signupCodeErrorMessage,
  signupConfirmedLoginPath,
} from '@/lib/auth/onboarding';
import {
  AUTH_NEXT_RECOVERY_MAX_AGE_SECONDS,
  AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS,
  AUTH_PASSWORD_RESET_COOKIE_MAX_AGE_SECONDS,
  AUTH_PASSWORD_RESET_COOKIE_NAME,
  authCookieSecret,
  consumePasswordResetAttempt,
  signedAuthNextCookieValue,
  type AuthNextPurpose,
} from '@/lib/auth/recovery.server';
import { getProfileForUser } from '@/lib/auth/server';
import { isPasswordSessionAccessToken } from '@/lib/auth/session-amr';
import { KAKAO_CHANNEL_LOGIN_SCOPE, kakaoChannelConfig } from '@/lib/kakao/channel-config.server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { CANONICAL_AUTH_ORIGIN, trustedAuthOrigin } from '@/lib/auth/trusted-origin';

export interface AuthActionState {
  message?: string;
  errors?: {
    email?: string;
    password?: string;
    code?: string;
    form?: string;
  };
  /**
   * 가입 확인 메일을 보낸 이메일(정규화된 값). 화면은 이 값이 있으면 같은 자리에서 6자리 확인 코드 입력 단계를
   * 연다(10/14 회의 1014-004). 메일의 확인 링크도 그대로 동작한다.
   */
  pendingSignupEmail?: string;
}

export interface SignOutActionState {
  errors?: {
    form?: string;
  };
}

export type SocialAuthProvider = 'google' | 'apple' | 'kakao';

interface Credentials {
  email: string;
  password: string;
  next: string;
}

interface SignupResendState {
  emailHash: string;
  resendCount: number;
  windowStartedAt: number;
}

interface AuthErrorLike {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}

const AUTH_SIGNUP_RESEND_COOKIE_NAME = 'icons_auth_signup_resend';
const AUTH_SIGNUP_RESEND_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;
const AUTH_SIGNUP_RESEND_STATE_MAX_AGE_MS = AUTH_SIGNUP_RESEND_COOKIE_MAX_AGE_SECONDS * 1000;
const AUTH_SIGNUP_RESEND_WINDOW_MS = 10 * 60 * 1000;
const AUTH_SIGNUP_RESEND_MAX_ATTEMPTS = 3;
/* 확인 메일에는 6자리 확인 코드와 확인 링크가 함께 있다(supabase/templates/confirmation.html). 화면은 코드 입력을
   먼저 안내하고, 링크도 계속 동작한다. */
const SIGNUP_CONFIRMATION_SENT_MESSAGE = '가입 확인 메일을 보냈습니다. 메일에 적힌 6자리 확인 코드를 아래에 입력해주세요. 메일이 보이지 않으면 스팸함을 확인해주세요. 이미 가입한 이메일이라면 로그인도 시도할 수 있습니다.';
const SIGNUP_CONFIRMATION_RESENT_MESSAGE = '새 확인 메일을 보냈습니다. 가장 최근에 받은 메일의 6자리 확인 코드를 입력해주세요.';
const SIGNUP_CODE_FORMAT_MESSAGE = '메일로 받은 6자리 숫자를 입력해주세요.';
const SIGNUP_CODE_EMAIL_MISSING_MESSAGE = '확인할 이메일을 찾지 못했습니다. 회원가입을 다시 시작해주세요.';
const SIGNUP_CODE_RESTART_MESSAGE = '코드를 다시 받으려면 [다른 이메일로 가입하기]를 눌러 같은 이메일로 회원가입을 다시 제출해주세요.';
const PASSWORD_RESET_SENT_MESSAGE = '해당 이메일로 가입한 계정이 있다면 재설정 메일을 보냈습니다. 요청한 브라우저에서 최신 링크를 열어주세요.';
const SOCIAL_AUTH_PROVIDERS = new Set<SocialAuthProvider>(['google', 'apple', 'kakao']);
const SOCIAL_AUTH_UNAVAILABLE_MESSAGE = '현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.';

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function socialAuthProvider(value: FormDataEntryValue | null): SocialAuthProvider | null {
  return typeof value === 'string' && SOCIAL_AUTH_PROVIDERS.has(value as SocialAuthProvider)
    ? value as SocialAuthProvider
    : null;
}

function validateCredentials(formData: FormData): { ok: true; credentials: Credentials } | { ok: false; state: AuthActionState } {
  const email = readString(formData, 'email').trim();
  const password = readString(formData, 'password');
  const next = safeNextPath(formData.get('next'));
  const errors: NonNullable<AuthActionState['errors']> = {};

  if (!email) errors.email = '이메일을 입력해주세요.';
  if (!password) errors.password = '비밀번호를 입력해주세요.';

  if (Object.keys(errors).length) return { ok: false, state: { errors } };
  return { ok: true, credentials: { email, password, next } };
}

async function requestOrigin() {
  const headersList = await headers();
  const origin = trustedAuthOrigin(headersList.get('origin'));
  if (origin) return origin;

  const host = headersList.get('x-forwarded-host') ?? headersList.get('host');
  if (!host) return CANONICAL_AUTH_ORIGIN;

  const firstHost = host.split(',')[0]?.trim();
  if (!firstHost) return CANONICAL_AUTH_ORIGIN;

  const firstProto = (headersList.get('x-forwarded-proto') ?? '').split(',')[0]?.trim();
  const proto = firstProto || (firstHost.startsWith('localhost') || firstHost.startsWith('127.') ? 'http' : 'https');

  return trustedAuthOrigin(`${proto}://${firstHost}`) ?? CANONICAL_AUTH_ORIGIN;
}

async function rememberAuthNextPath(
  origin: string,
  next: string,
  purpose: AuthNextPurpose,
  issuedAt: number,
  secret: string | null,
) {
  const cookieStore = await cookies();
  const safeNext = safeNextPath(next);
  const callbackPath = purpose === 'recovery' ? AUTH_RECOVERY_CALLBACK_PATH : AUTH_CALLBACK_PATH;
  const cookieName = purpose === 'recovery' ? AUTH_RECOVERY_NEXT_COOKIE_NAME : AUTH_NEXT_COOKIE_NAME;

  if (!secret || (purpose === 'signup' && safeNext === '/')) {
    cookieStore.set(cookieName, '', { path: callbackPath, maxAge: 0 });
    return;
  }

  cookieStore.set(cookieName, signedAuthNextCookieValue(safeNext, purpose, issuedAt, secret), {
    httpOnly: true,
    maxAge: purpose === 'recovery' ? AUTH_NEXT_RECOVERY_MAX_AGE_SECONDS : AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS,
    path: callbackPath,
    sameSite: 'lax',
    secure: origin.startsWith('https://'),
  });
}

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function signupResendSecret() {
  return process.env.AUTH_SIGNUP_RESEND_SECRET?.trim() || null;
}

function hmacDigest(secret: string, value: string) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function emailHash(email: string, secret: string) {
  return hmacDigest(secret, normalizedEmail(email));
}

function signaturesMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function encodeSignupResendState(state: SignupResendState, secret: string) {
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  return `${payload}.${hmacDigest(secret, payload)}`;
}

function signupResendStateFromCookie(value: string | null | undefined, now: number, secret: string | null): SignupResendState | null {
  if (!value) return null;
  if (!secret) return null;

  try {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    if (!signaturesMatch(signature, hmacDigest(secret, payload))) return null;

    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<SignupResendState>;
    const resendCount = parsed.resendCount;
    const windowStartedAt = parsed.windowStartedAt;
    if (typeof parsed.emailHash !== 'string' || !parsed.emailHash) return null;
    if (typeof resendCount !== 'number' || !Number.isInteger(resendCount) || resendCount < 0) return null;
    if (typeof windowStartedAt !== 'number' || !Number.isFinite(windowStartedAt)) return null;
    if (windowStartedAt > now) return null;
    if (now - windowStartedAt >= AUTH_SIGNUP_RESEND_STATE_MAX_AGE_MS) return null;

    return {
      emailHash: parsed.emailHash,
      resendCount,
      windowStartedAt,
    };
  } catch {
    return null;
  }
}

function setSignupResendState(cookieStore: CookieStore, origin: string, state: SignupResendState, secret: string | null) {
  if (!secret) return;

  cookieStore.set(AUTH_SIGNUP_RESEND_COOKIE_NAME, encodeSignupResendState(state, secret), {
    httpOnly: true,
    maxAge: AUTH_SIGNUP_RESEND_COOKIE_MAX_AGE_SECONDS,
    path: '/login',
    sameSite: 'lax',
    secure: origin.startsWith('https://'),
  });
}

function isSignupResendWindowActive(state: SignupResendState, now: number) {
  return now - state.windowStartedAt < AUTH_SIGNUP_RESEND_WINDOW_MS;
}

function currentSignupResendWindow(state: SignupResendState, now: number): SignupResendState {
  if (isSignupResendWindowActive(state, now)) return state;
  return {
    emailHash: state.emailHash,
    resendCount: 0,
    windowStartedAt: now,
  };
}

function normalizeAuthCode(error: AuthErrorLike | null | undefined) {
  return error?.code?.trim() || undefined;
}

function isExistingAccountSignUpError(error: AuthErrorLike | null | undefined) {
  switch (normalizeAuthCode(error)) {
    case 'email_exists':
    case 'identity_already_exists':
    case 'user_already_exists':
      return true;
    default:
      return false;
  }
}

function isOperationalAuthEmailError(error: AuthErrorLike | null | undefined) {
  switch (normalizeAuthCode(error)) {
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
    case 'signup_disabled':
    case 'email_provider_disabled':
    case 'provider_disabled':
    case 'email_address_not_authorized':
      return true;
    default:
      return false;
  }
}

function passwordResetOperationalErrorMessage(error: AuthErrorLike | null | undefined) {
  if (!error) return undefined;

  switch (normalizeAuthCode(error)) {
    case 'user_not_found':
    case 'email_not_found':
      return undefined;
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return '비밀번호 재설정 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
    case 'email_provider_disabled':
    case 'provider_disabled':
    case 'email_address_not_authorized':
      return '현재 비밀번호 재설정 메일을 보낼 수 없습니다. 잠시 후 다시 시도해주세요.';
    default:
      return '현재 비밀번호 재설정 요청을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.';
  }
}

export async function signInWithSocialAction(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const provider = socialAuthProvider(formData.get('provider'));
  if (!provider) return { errors: { form: SOCIAL_AUTH_UNAVAILABLE_MESSAGE } };

  const { isConfigured } = getSupabaseConfig();
  const secret = authCookieSecret();
  if (!isConfigured || !secret) {
    return { errors: { form: SOCIAL_AUTH_UNAVAILABLE_MESSAGE } };
  }

  const next = safeNextPath(formData.get('next'));
  const origin = await requestOrigin();
  const supabase = await createClient();
  /* 카카오톡 채널 스위치가 켜졌을 때만 카카오 로그인에 채널 관계 동의항목(plusfriends)을 더 요청한다 — 동의 화면에
     채널 추가 항목이 보이고, 친구 추가 쿠폰을 확인할 수 있다(1014-014). 꺼져 있으면 요청은 예전과 같다. */
  const channelScope = provider === 'kakao' && kakaoChannelConfig() ? KAKAO_CHANNEL_LOGIN_SCOPE : null;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: channelScope
      ? { redirectTo: authCallbackUrl(origin), scopes: channelScope }
      : { redirectTo: authCallbackUrl(origin) },
  });

  if (error || !data.url) {
    return { errors: { form: SOCIAL_AUTH_UNAVAILABLE_MESSAGE } };
  }

  await rememberAuthNextPath(origin, next, 'oauth', Date.now(), secret);
  redirect(data.url);
}

export async function signInWithEmailAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = validateCredentials(formData);
  if (!parsed.ok) return parsed.state;
  const { email, next, password } = parsed.credentials;

  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) return { errors: { form: 'Supabase 환경변수를 설정한 뒤 로그인할 수 있습니다.' } };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { errors: { form: '이메일 또는 비밀번호를 확인해주세요.' } };
  }

  const profile = await getProfileForUser(supabase, data.user.id);
  if (isAccountSuspended(profile) && next !== ACCOUNT_DELETION_PATH) {
    redirect(ACCOUNT_SUSPENDED_PATH);
  }
  redirect(postAuthenticationPath(profile, data.user.email, next));
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/*
 * 같은 이메일로 확인 메일을 다시 보낸다. 10분에 3번까지만 보내고(서명 쿠키 창), 넘으면 Supabase를 부르지 않는다.
 * 회원가입 폼을 같은 이메일로 다시 제출한 경우와 코드 입력 단계의 [코드 다시 받기]가 같은 창을 나눠 쓴다.
 * 창 상태가 없거나 다른 이메일의 창이면 새 창을 연다. 서명 비밀값이 없으면 앱 창 없이 Supabase 한도만 적용된다.
 */
async function resendSignupConfirmation(input: {
  supabase: SupabaseServerClient;
  cookieStore: CookieStore;
  origin: string;
  email: string;
  next: string;
  now: number;
  secret: string | null;
  state: SignupResendState | null;
}): Promise<AuthActionState> {
  const { supabase, cookieStore, origin, email, next, now, secret, state } = input;
  const signupEmailHash = secret ? emailHash(email, secret) : null;

  if (signupEmailHash) {
    const window = state?.emailHash === signupEmailHash
      ? currentSignupResendWindow(state, now)
      : { emailHash: signupEmailHash, resendCount: 0, windowStartedAt: now };
    if (isSignupResendWindowActive(window, now) && window.resendCount >= AUTH_SIGNUP_RESEND_MAX_ATTEMPTS) {
      return {
        errors: { form: '확인 메일 재요청이 너무 많습니다. 10분 후 다시 시도해주세요.' },
        pendingSignupEmail: email,
      };
    }
    setSignupResendState(cookieStore, origin, {
      emailHash: signupEmailHash,
      resendCount: window.resendCount + 1,
      windowStartedAt: window.windowStartedAt,
    }, secret);
  }

  await rememberAuthNextPath(origin, next, 'signup', now, secret);
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo: authCallbackUrl(origin),
    },
  });

  if (error) return { errors: { form: authSignUpErrorMessage(error) }, pendingSignupEmail: email };

  return { message: SIGNUP_CONFIRMATION_RESENT_MESSAGE, pendingSignupEmail: email };
}

export async function signUpWithEmailAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = validateCredentials(formData);
  if (!parsed.ok) return parsed.state;
  const { email, next, password } = parsed.credentials;

  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) return { errors: { form: 'Supabase 환경변수를 설정한 뒤 가입할 수 있습니다.' } };

  const supabase = await createClient();
  const origin = await requestOrigin();
  const emailRedirectTo = authCallbackUrl(origin);
  const normalizedSignupEmail = normalizedEmail(email);
  const cookieStore = await cookies();
  const now = Date.now();
  const resendSecret = signupResendSecret();
  const signupResendState = signupResendStateFromCookie(
    cookieStore.get(AUTH_SIGNUP_RESEND_COOKIE_NAME)?.value,
    now,
    resendSecret,
  );
  const signupEmailHash = resendSecret ? emailHash(normalizedSignupEmail, resendSecret) : null;

  if (signupEmailHash && signupResendState?.emailHash === signupEmailHash) {
    return resendSignupConfirmation({
      supabase,
      cookieStore,
      origin,
      email: normalizedSignupEmail,
      next,
      now,
      secret: resendSecret,
      state: signupResendState,
    });
  }

  const { data, error } = await supabase.auth.signUp({
    email: normalizedSignupEmail,
    password,
    options: {
      emailRedirectTo,
    },
  });

  if (error) {
    if (isExistingAccountSignUpError(error)) {
      await rememberAuthNextPath(origin, next, 'signup', now, resendSecret);
      if (signupEmailHash) {
        setSignupResendState(cookieStore, origin, {
          emailHash: signupEmailHash,
          resendCount: 1,
          windowStartedAt: now,
        }, resendSecret);
      }

      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: normalizedSignupEmail,
        options: {
          emailRedirectTo,
        },
      });

      if (resendError && isOperationalAuthEmailError(resendError)) {
        return { errors: { form: authSignUpErrorMessage(resendError) } };
      }

      return { message: SIGNUP_CONFIRMATION_SENT_MESSAGE, pendingSignupEmail: normalizedSignupEmail };
    }

    return { errors: { form: authSignUpErrorMessage(error) } };
  }

  if (!data.user) {
    return { errors: { form: authSignUpErrorMessage(error) } };
  }

  if (!data.session) {
    await rememberAuthNextPath(origin, next, 'signup', now, resendSecret);
    if (signupEmailHash) {
      setSignupResendState(cookieStore, origin, {
        emailHash: signupEmailHash,
        resendCount: 0,
        windowStartedAt: now,
      }, resendSecret);
    }
    return { message: SIGNUP_CONFIRMATION_SENT_MESSAGE, pendingSignupEmail: normalizedSignupEmail };
  }

  redirect(onboardingPath(next));
}

function signupEmailFromForm(formData: FormData): string | null {
  const email = normalizedEmail(readString(formData, 'email'));
  return email.length > 0 && email.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

/*
 * 코드 입력 단계의 [코드 다시 받기](1014-004). 회원가입 폼 재제출과 같은 10분 3회 창을 쓴다.
 * 이 브라우저에서 그 이메일로 가입을 시작한 창(서명 쿠키)이 있을 때만 보낸다 — 아무 이메일로나 확인 메일을 보내는
 * 통로가 되지 않게 한다. 창이 없으면(쿠키 만료·다른 브라우저) 회원가입을 다시 제출하면 된다.
 * 가입하지 않은 이메일이나 이미 확인된 이메일이어도 Supabase는 같은 응답을 주므로 결과 문장도 같다.
 */
export async function resendSignupCodeAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = signupEmailFromForm(formData);
  if (!email) return { errors: { form: SIGNUP_CODE_EMAIL_MISSING_MESSAGE } };
  const next = safeNextPath(formData.get('next'));

  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) return { errors: { form: 'Supabase 환경변수를 설정한 뒤 가입할 수 있습니다.' }, pendingSignupEmail: email };

  const cookieStore = await cookies();
  const now = Date.now();
  const secret = signupResendSecret();
  const state = signupResendStateFromCookie(cookieStore.get(AUTH_SIGNUP_RESEND_COOKIE_NAME)?.value, now, secret);
  if (secret && state?.emailHash !== emailHash(email, secret)) {
    return { errors: { form: SIGNUP_CODE_RESTART_MESSAGE }, pendingSignupEmail: email };
  }

  const supabase = await createClient();
  const origin = await requestOrigin();
  return resendSignupConfirmation({ supabase, cookieStore, origin, email, next, now, secret, state });
}

/* Supabase SSR 세션 쿠키(sb-<ref>-auth-token, 큰 세션은 .0·.1 조각). */
const SUPABASE_AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

/*
 * 가입 확인 코드로 만든 세션을 닫는다. 이 세션은 AMR이 otp라 운영 Auth의 '현재 비밀번호 요구' 가드를 면제받는다
 * (recovery·magic link와 같은 판정 — docs/runbooks/supabase-auth-password-update-guards.md). 그래서 브라우저에 주지 않는다.
 * signOut이 실패하면 auth-js가 로컬 세션을 지우지 않으므로, 이 응답이 세션 쿠키를 들고 나가지 않게 직접 지운다.
 */
async function closeSignupCodeSession(supabase: SupabaseServerClient) {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (!error) return;
  } catch {
    // 아래에서 쿠키를 직접 지운다.
  }
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (SUPABASE_AUTH_COOKIE.test(cookie.name)) cookieStore.delete(cookie.name);
  }
}

/*
 * 가입 확인 6자리 코드(1014-004). 메일 링크를 새 창에서 열지 않고 가입한 화면에서 그대로 확인을 끝낸다.
 * Supabase verifyOtp(type email)는 가입 확인 토큰을 먼저 보고(PKCE 가입의 pkce_ 토큰도 같은 코드로 통과) 이메일을
 * 확인한다. 이때 생긴 세션은 AMR otp라 현재 비밀번호 없이 비밀번호를 바꿀 수 있는 세션이므로(리뷰 F1) 바로 닫고,
 * 가입 화면에서 입력한 비밀번호로 다시 로그인해 password 세션만 브라우저에 준다. 비밀번호는 화면 메모리에서만 이
 * 요청에 실려 오고 저장하지 않는다. 비밀번호가 없거나(새로고침 등) 로그인이 안 되면 로그인 화면으로 보낸다 —
 * 이메일 확인은 이미 끝났다. 그다음은 링크 콜백과 같은 로그인 뒤 경로(온보딩·정지 계정)를 탄다.
 * 코드 대입 시도는 GoTrue의 IP별 검증 한도(token_verifications)와 코드 만료가 막는다. 코드가 틀렸는지 만료됐는지는
 * GoTrue가 구분해 주지 않는다(otp_expired 하나).
 */
export async function verifySignupCodeAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = signupEmailFromForm(formData);
  if (!email) return { errors: { form: SIGNUP_CODE_EMAIL_MISSING_MESSAGE } };
  const code = readString(formData, 'code').replace(/\s+/g, '');
  const password = readString(formData, 'password');
  const next = safeNextPath(formData.get('next'));
  if (!/^\d{6}$/.test(code)) return { errors: { code: SIGNUP_CODE_FORMAT_MESSAGE }, pendingSignupEmail: email };

  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) return { errors: { form: 'Supabase 환경변수를 설정한 뒤 가입할 수 있습니다.' }, pendingSignupEmail: email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error || !data.user) {
    return { errors: { code: signupCodeErrorMessage(error) }, pendingSignupEmail: email };
  }

  await closeSignupCodeSession(supabase);
  if (!password) redirect(signupConfirmedLoginPath(next));

  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.user || !isPasswordSessionAccessToken(signIn.session?.access_token)) {
    if (!signInError && signIn.session) await closeSignupCodeSession(supabase);
    redirect(signupConfirmedLoginPath(next));
  }

  const profile = await getProfileForUser(supabase, signIn.user.id);
  if (isAccountSuspended(profile) && next !== ACCOUNT_DELETION_PATH) {
    redirect(ACCOUNT_SUSPENDED_PATH);
  }
  redirect(postAuthenticationPath(profile, signIn.user.email, next));
}

export async function requestPasswordResetAction(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = normalizedEmail(readString(formData, 'email'));
  const next = safeNextPath(formData.get('next'));

  if (!email) return { errors: { email: '이메일을 입력해주세요.' } };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { errors: { email: '이메일 주소 형식을 확인해주세요. 예: you@icons.gg' } };
  }

  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) {
    return { errors: { form: 'Supabase 환경변수를 설정한 뒤 비밀번호를 재설정할 수 있습니다.' } };
  }

  const secret = authCookieSecret();
  if (!secret) {
    return { errors: { form: '인증 보안 환경변수를 설정한 뒤 비밀번호를 재설정할 수 있습니다.' } };
  }

  const origin = await requestOrigin();
  const cookieStore = await cookies();
  const now = Date.now();
  const attempt = consumePasswordResetAttempt(
    cookieStore.get(AUTH_PASSWORD_RESET_COOKIE_NAME)?.value,
    email,
    now,
    secret,
  );

  if (attempt.blocked) {
    return { errors: { form: '비밀번호 재설정 요청이 너무 많습니다. 10분 후 다시 시도해주세요.' } };
  }

  // 로그인 화면과 설정 화면이 같은 action을 쓰므로 어느 쪽에서 보내도 같은 쿠키를 읽고 쓴다.
  cookieStore.set(AUTH_PASSWORD_RESET_COOKIE_NAME, attempt.cookieValue, {
    httpOnly: true,
    maxAge: AUTH_PASSWORD_RESET_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: origin.startsWith('https://'),
  });
  await rememberAuthNextPath(origin, next, 'recovery', now, secret);

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authRecoveryCallbackUrl(origin),
  });
  const operationalError = passwordResetOperationalErrorMessage(error);
  if (operationalError) return { errors: { form: operationalError } };

  return { message: PASSWORD_RESET_SENT_MESSAGE };
}

const SIGN_OUT_FAILURE_MESSAGE = '로그아웃을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.';

async function signOutLocally() {
  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) return true;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return !error;
  } catch {
    return false;
  }
}

function safeAdminReturnPath(value: FormDataEntryValue | string | null | undefined) {
  const next = safeNextPath(value);
  return next === '/admin' || next.startsWith('/admin/') ? next : '/admin';
}

export async function adminSignOutAction(
  _state: SignOutActionState,
  formData: FormData,
): Promise<SignOutActionState> {
  if (!await signOutLocally()) {
    return { errors: { form: SIGN_OUT_FAILURE_MESSAGE } };
  }

  redirect(`/login?next=${encodeURIComponent(safeAdminReturnPath(formData.get('next')))}`);
}

export async function signOutAction() {
  await signOutLocally();

  redirect('/');
}
