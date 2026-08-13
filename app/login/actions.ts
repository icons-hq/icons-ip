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
  authCallbackUrl,
  authRecoveryCallbackUrl,
  authSignUpErrorMessage,
  isAccountSuspended,
  isOnboarded,
  onboardingPath,
  safeNextPath,
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
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export interface AuthActionState {
  message?: string;
  errors?: {
    email?: string;
    password?: string;
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
const CANONICAL_AUTH_ORIGIN = 'https://iconsip.com';
const STATIC_AUTH_ORIGINS = new Set([
  CANONICAL_AUTH_ORIGIN,
  'https://www.iconsip.com',
  'https://icons-ip.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
const SIGNUP_CONFIRMATION_SENT_MESSAGE = '가입 확인 메일을 보냈습니다. 받은편지함과 스팸함에서 최신 확인 메일을 열어주세요. 이미 가입한 이메일이라면 로그인도 시도할 수 있습니다.';
const SIGNUP_CONFIRMATION_RESENT_MESSAGE = '새 확인 메일을 보냈습니다. 받은편지함과 스팸함에서 최신 확인 메일을 열어주세요.';
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

function normalizedOrigin(value: string | null) {
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function currentVercelOrigin() {
  const host = process.env.VERCEL_URL?.trim();
  if (!host || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(host)) return undefined;
  return `https://${host.toLowerCase()}`;
}

function trustedAuthOrigin(value: string | null) {
  const origin = normalizedOrigin(value);
  if (!origin) return undefined;
  if (STATIC_AUTH_ORIGINS.has(origin) || origin === currentVercelOrigin()) return origin;
  return undefined;
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
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: authCallbackUrl(origin) },
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
  if (isAccountSuspended(profile)) redirect(ACCOUNT_SUSPENDED_PATH);
  redirect(isOnboarded(profile, data.user.email) ? next : onboardingPath(next));
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
    const resendWindow = currentSignupResendWindow(signupResendState, now);
    if (isSignupResendWindowActive(signupResendState, now) && resendWindow.resendCount >= AUTH_SIGNUP_RESEND_MAX_ATTEMPTS) {
      return { errors: { form: '확인 메일 재요청이 너무 많습니다. 10분 후 다시 시도해주세요.' } };
    }

    const attemptedResendState = {
      emailHash: signupEmailHash,
      resendCount: resendWindow.resendCount + 1,
      windowStartedAt: resendWindow.windowStartedAt,
    };

    await rememberAuthNextPath(origin, next, 'signup', now, resendSecret);
    setSignupResendState(cookieStore, origin, attemptedResendState, resendSecret);

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: normalizedSignupEmail,
      options: {
        emailRedirectTo,
      },
    });

    if (error) return { errors: { form: authSignUpErrorMessage(error) } };

    return { message: SIGNUP_CONFIRMATION_RESENT_MESSAGE };
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

      return { message: SIGNUP_CONFIRMATION_SENT_MESSAGE };
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
    return { message: SIGNUP_CONFIRMATION_SENT_MESSAGE };
  }

  redirect(onboardingPath(next));
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

  cookieStore.set(AUTH_PASSWORD_RESET_COOKIE_NAME, attempt.cookieValue, {
    httpOnly: true,
    maxAge: AUTH_PASSWORD_RESET_COOKIE_MAX_AGE_SECONDS,
    path: '/login',
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

export async function signOutAction() {
  const { isConfigured } = getSupabaseConfig();
  if (isConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: 'local' });
  }

  redirect('/');
}
