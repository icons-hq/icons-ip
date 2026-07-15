export interface OnboardingConsents {
  terms?: boolean | null;
  privacy?: boolean | null;
  marketing?: boolean | null;
}

export interface ProfileForOnboarding {
  email?: string | null;
  nickname?: string | null;
  birth_date?: string | null;
  consents?: OnboardingConsents | null;
  onboarded_at?: string | null;
  role?: 'user' | 'staff' | 'admin' | null;
}

interface AuthErrorLike {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}

export const AUTH_CALLBACK_PATH = '/auth/callback';
export const AUTH_NEXT_COOKIE_NAME = 'icons_auth_next';
export const AUTH_NEXT_COOKIE_MAX_AGE_SECONDS = 10 * 60;

const GENERIC_AUTH_ERROR_MESSAGE = '인증을 완료하지 못했습니다. 다시 시도하거나 새 확인 메일을 요청해주세요.';
const GENERIC_SIGNUP_ERROR_MESSAGE = '가입 요청을 처리하지 못했습니다. 이메일 형식과 비밀번호를 확인한 뒤 다시 시도해주세요.';
const GENERIC_PASSWORD_RESET_ERROR_MESSAGE = '비밀번호 재설정을 완료하지 못했습니다. 로그인 화면에서 새 재설정 메일을 요청해주세요.';
const GENERIC_PASSWORD_UPDATE_ERROR_MESSAGE = '비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.';

export function isOnboarded(profile: ProfileForOnboarding | null | undefined, authEmail?: string | null): boolean {
  if (!profile) return false;
  if (!(profile.email ?? authEmail)?.trim()) return false;
  if (!profile.nickname?.trim()) return false;
  if (!profile.birth_date) return false;
  if (!profile.onboarded_at) return false;
  if (profile.consents?.terms !== true) return false;
  if (profile.consents?.privacy !== true) return false;

  const birthDate = new Date(`${profile.birth_date}T00:00:00.000Z`);
  if (Number.isNaN(birthDate.getTime())) return false;

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return birthDate <= todayUtc;
}

export function safeNextPath(value: FormDataEntryValue | string | null | undefined): string {
  if (typeof value !== 'string') return '/';

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return '/';
  }

  if (decoded.includes('\\')) return '/';
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return '/';

  const sameOrigin = 'https://icons.local';
  const url = new URL(decoded, sameOrigin);
  if (url.origin !== sameOrigin) return '/';

  return `${url.pathname}${url.search}${url.hash}`;
}

export function nextPathWithSearch(pathname: string, searchParams: Pick<URLSearchParams, 'toString'>): string {
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function onboardingPath(next: string) {
  return `/onboarding?next=${encodeURIComponent(safeNextPath(next))}`;
}

export function authCallbackUrl(origin: string): string {
  return new URL(AUTH_CALLBACK_PATH, origin).toString();
}

export function authNextCookieValue(next: string): string {
  return encodeURIComponent(safeNextPath(next));
}

export function authNextPathFromCookie(value: string | null | undefined): string {
  if (!value) return '/';
  return safeNextPath(value);
}

function normalizeAuthCode(code: string | null | undefined) {
  return code?.trim() || undefined;
}

export function authErrorMessage(code: string | null | undefined): string | undefined {
  switch (normalizeAuthCode(code)) {
    case undefined:
      return undefined;
    case 'otp_expired':
      return '인증 링크가 만료되었거나 이미 사용되었습니다. 최신 확인 메일의 링크를 열거나 회원가입을 다시 시도해주세요.';
    // PKCE code exchange 실패 — 이메일 확인 자체는 완료됐을 수 있다(다른 브라우저에서 링크를 열거나 중복 처리된 경우).
    case 'flow_state_expired':
    case 'flow_state_not_found':
    case 'bad_code_verifier':
    case 'bad_oauth_callback':
    case 'exchange_failed':
    case 'pkce_code_verifier_not_found':
      return '이메일 인증은 완료되었을 수 있습니다. 가입한 이메일과 비밀번호로 로그인해주세요. 로그인이 안 되면 새 확인 메일을 요청해주세요.';
    case 'missing_code':
      return '인증 링크가 올바르게 열리지 않았습니다. 확인 메일의 링크를 다시 열어주세요.';
    case 'email_address_invalid':
    case 'validation_failed':
      return '이메일 주소 형식을 확인해주세요. 예: you@icons.gg';
    case 'weak_password':
      return '비밀번호가 보안 조건을 충족하지 않습니다. 더 긴 비밀번호로 다시 시도해주세요.';
    case 'over_email_send_rate_limit':
      return '확인 메일 요청이 너무 많습니다. 잠시 후 받은편지함과 스팸함을 확인하고 다시 시도해주세요.';
    case 'over_request_rate_limit':
      return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
    case 'signup_disabled':
    case 'email_provider_disabled':
    case 'provider_disabled':
      return '현재 이메일 회원가입을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.';
    default:
      return GENERIC_AUTH_ERROR_MESSAGE;
  }
}

export function authSignUpErrorMessage(error: AuthErrorLike | null | undefined): string {
  switch (normalizeAuthCode(error?.code)) {
    case 'email_address_invalid':
    case 'validation_failed':
      return '이메일 주소 형식을 확인해주세요. 예: you@icons.gg';
    case 'weak_password':
      return '비밀번호가 보안 조건을 충족하지 않습니다. 더 긴 비밀번호로 다시 시도해주세요.';
    case 'over_email_send_rate_limit':
      return '확인 메일 요청이 너무 많습니다. 잠시 후 받은편지함과 스팸함을 확인하고 다시 시도해주세요.';
    case 'over_request_rate_limit':
      return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
    case 'signup_disabled':
    case 'email_provider_disabled':
    case 'provider_disabled':
      return '현재 이메일 회원가입을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.';
    case 'email_exists':
    case 'identity_already_exists':
    case 'user_already_exists':
      return '가입 요청을 처리하지 못했습니다. 받은편지함과 스팸함에서 최신 확인 메일을 확인하거나 로그인도 시도해보세요.';
    default:
      return GENERIC_SIGNUP_ERROR_MESSAGE;
  }
}

export function authErrorLoginPath(code: string | null | undefined, next: string = '/') {
  const url = new URL('/login', 'https://icons.local');
  url.searchParams.set('mode', 'signin');
  url.searchParams.set('auth_error', normalizeAuthCode(code) ?? 'unknown_provider_error');

  const safeNext = safeNextPath(next);
  if (safeNext !== '/') url.searchParams.set('next', safeNext);

  return `${url.pathname}${url.search}`;
}

export function passwordResetErrorMessage(code: string | null | undefined): string | undefined {
  switch (normalizeAuthCode(code)) {
    case undefined:
      return undefined;
    case 'otp_expired':
      return '비밀번호 재설정 링크가 만료되었거나 이미 사용되었습니다. 로그인 화면에서 새 재설정 메일을 요청해주세요.';
    case 'flow_state_expired':
    case 'flow_state_not_found':
    case 'bad_code_verifier':
    case 'bad_oauth_callback':
    case 'exchange_failed':
    case 'pkce_code_verifier_not_found':
      return '이 브라우저에서 비밀번호 재설정을 완료할 수 없습니다. 재설정 메일을 요청한 브라우저에서 최신 링크를 열거나 새 메일을 요청해주세요.';
    case 'missing_code':
      return '비밀번호 재설정 링크가 올바르게 열리지 않았습니다. 로그인 화면에서 새 재설정 메일을 요청해주세요.';
    case 'session_expired':
    case 'session_not_found':
    case 'reauthentication_needed':
      return '비밀번호 재설정 세션이 만료되었습니다. 로그인 화면에서 새 재설정 메일을 요청해주세요.';
    default:
      return GENERIC_PASSWORD_RESET_ERROR_MESSAGE;
  }
}

export function passwordResetErrorLoginPath(code: string | null | undefined, next: string = '/') {
  const url = new URL('/login', 'https://icons.local');
  url.searchParams.set('mode', 'reset');
  url.searchParams.set('reset_error', normalizeAuthCode(code) ?? 'unknown_recovery_error');

  const safeNext = safeNextPath(next);
  if (safeNext !== '/') url.searchParams.set('next', safeNext);

  return `${url.pathname}${url.search}`;
}

export function updatePasswordPath(next: string = '/') {
  const url = new URL('/update-password', 'https://icons.local');
  const safeNext = safeNextPath(next);
  if (safeNext !== '/') url.searchParams.set('next', safeNext);
  return `${url.pathname}${url.search}`;
}

export function updatePasswordSessionReadyPath(next: string = '/') {
  const url = new URL('/update-password', 'https://icons.local');
  url.searchParams.set('session_ready', '1');
  const safeNext = safeNextPath(next);
  if (safeNext !== '/') url.searchParams.set('next', safeNext);
  return `${url.pathname}${url.search}`;
}

export function passwordResetSuccessLoginPath(next: string = '/') {
  const url = new URL('/login', 'https://icons.local');
  url.searchParams.set('password_reset', 'success');
  const safeNext = safeNextPath(next);
  if (safeNext !== '/') url.searchParams.set('next', safeNext);
  return `${url.pathname}${url.search}`;
}

export function passwordUpdateErrorMessage(error: AuthErrorLike | null | undefined) {
  switch (normalizeAuthCode(error?.code)) {
    case 'weak_password':
      return '비밀번호가 보안 조건을 충족하지 않습니다. 더 긴 비밀번호로 다시 시도해주세요.';
    case 'same_password':
      return '현재 비밀번호와 다르게 설정해주세요.';
    case 'session_expired':
    case 'session_not_found':
    case 'reauthentication_needed':
      return '비밀번호 재설정 세션이 만료되었습니다. 로그인 화면에서 새 재설정 메일을 요청해주세요.';
    default:
      return GENERIC_PASSWORD_UPDATE_ERROR_MESSAGE;
  }
}
