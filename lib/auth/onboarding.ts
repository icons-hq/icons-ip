export interface OnboardingConsents {
  terms?: boolean | null;
  privacy?: boolean | null;
  marketing?: boolean | null;
}

export interface ProfileForOnboarding {
  email?: string | null;
  nickname?: string | null;
  birth_date?: string | null;
  avatar_path?: string | null;
  consents?: OnboardingConsents | null;
  onboarded_at?: string | null;
  role?: 'user' | 'staff' | 'admin' | null;
  suspended_at?: string | null;
  /**
   * 휴대폰 번호 인증 스위치가 켜졌을 때만 서버가 채운다: 다른 계정이 같은 번호를 인증해 이 계정의 인증이 해제됐다.
   * 다시 인증할 때까지 온보딩 미완료로 보고 보호 액션(주문·결제 준비 등) 전에 인증 단계로 보낸다.
   */
  phone_reverification_required?: boolean;
}

interface AuthErrorLike {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}

export const AUTH_CALLBACK_PATH = '/auth/callback';
export const AUTH_RECOVERY_CALLBACK_PATH = '/auth/recovery/callback';
export const ACCOUNT_SUSPENDED_PATH = '/account-suspended';
export const ACCOUNT_DELETION_PATH = '/settings/delete-account';
export const AUTH_NEXT_COOKIE_NAME = 'icons_auth_next';
export const AUTH_RECOVERY_NEXT_COOKIE_NAME = 'icons_auth_recovery_next';
export const AUTH_RECOVERY_PROOF_COOKIE_NAME = 'icons_auth_recovery_proof';
export const UPDATE_PASSWORD_PATH = '/update-password';
export const AUTH_NEXT_COOKIE_MAX_AGE_SECONDS = 10 * 60;

const GENERIC_AUTH_ERROR_MESSAGE = '인증을 완료하지 못했습니다. 다시 시도하거나 새 확인 메일을 요청해주세요.';
const GENERIC_SIGNUP_ERROR_MESSAGE = '가입 요청을 처리하지 못했습니다. 이메일 형식과 비밀번호를 확인한 뒤 다시 시도해주세요.';
const GENERIC_PASSWORD_RESET_ERROR_MESSAGE = '비밀번호 재설정을 완료하지 못했습니다. 로그인 화면에서 새 재설정 메일을 요청해주세요.';
const GENERIC_PASSWORD_UPDATE_ERROR_MESSAGE = '비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.';
export const PASSWORD_RECOVERY_REQUIRED_MESSAGE = '비밀번호는 재설정 메일의 링크를 연 뒤에만 바꿀 수 있습니다. 새 재설정 메일을 받아주세요.';
export const PASSWORD_UNAVAILABLE_FOR_SOCIAL_ACCOUNT_MESSAGE = 'SNS로 가입한 계정은 비밀번호를 설정할 수 없습니다. 가입한 SNS 계정으로 로그인해주세요.';

export function isAccountSuspended(
  profile: Pick<ProfileForOnboarding, 'suspended_at'> | null | undefined,
): boolean {
  return Boolean(profile?.suspended_at);
}

export function isOnboarded(profile: ProfileForOnboarding | null | undefined, authEmail?: string | null): boolean {
  if (!profile) return false;
  if (!(profile.email ?? authEmail)?.trim()) return false;
  if (!profile.nickname?.trim()) return false;
  if (!profile.birth_date) return false;
  if (!profile.onboarded_at) return false;
  if (profile.consents?.terms !== true) return false;
  if (profile.consents?.privacy !== true) return false;
  if (profile.phone_reverification_required === true) return false;

  const birthDate = new Date(`${profile.birth_date}T00:00:00.000Z`);
  if (Number.isNaN(birthDate.getTime())) return false;

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return birthDate <= todayUtc;
}

export function postAuthenticationPath(
  profile: ProfileForOnboarding | null | undefined,
  authEmail: string | null | undefined,
  next: string,
): string {
  const safeNext = safeNextPath(next);
  if (safeNext === ACCOUNT_DELETION_PATH) return safeNext;
  return isOnboarded(profile, authEmail) ? safeNext : onboardingPath(safeNext);
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
  let url: URL;
  try {
    url = new URL(decoded, sameOrigin);
  } catch {
    return '/';
  }
  if (url.origin !== sameOrigin) return '/';

  // 점 조각(`/..//x`, `/.//x`, `%2e`)을 접고 탭·줄바꿈을 지우는 일은 파서 안에서 일어나서,
  // 원문 검사를 통과한 값도 정규화 뒤에는 `//evil.example`(스킴 상대 URL)이 될 수 있다.
  if (url.pathname.startsWith('//') || url.pathname.includes('\\')) return '/';

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

export function authRecoveryCallbackUrl(origin: string): string {
  return new URL(AUTH_RECOVERY_CALLBACK_PATH, origin).toString();
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
      /* 확인 코드로 가입을 마친 뒤 같은 메일의 링크를 열어도 여기로 온다 — 토큰은 한 번만 쓸 수 있다(1014-004). */
      return '인증 링크가 만료되었거나 이미 사용되었습니다. 확인 코드로 이미 가입을 마쳤다면 로그인해주세요. 아니라면 최신 확인 메일의 링크를 열거나 회원가입을 다시 시도해주세요.';
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

/*
 * 가입 확인 6자리 코드 검증 실패(1014-004). GoTrue는 틀린 코드와 만료된 코드를 같은 otp_expired로 돌려주므로
 * 두 경우를 한 문장으로 말한다. 자세한 실패 사유는 이용자에게 보이지 않는다.
 */
export function signupCodeErrorMessage(error: AuthErrorLike | null | undefined): string {
  switch (normalizeAuthCode(error?.code)) {
    case 'otp_expired':
      return '확인 코드가 맞지 않거나 만료됐어요. 가장 최근 메일의 코드를 확인하거나 코드를 다시 받아주세요.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return '확인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.';
    case 'email_address_invalid':
    case 'validation_failed':
      return '이메일 주소 형식을 확인해주세요. 예: you@icons.gg';
    default:
      return '확인 코드를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.';
  }
}

/** 가입 확인 코드로 이메일 확인을 마쳤지만 비밀번호 로그인 세션으로 바꾸지 못했을 때(새로고침 등) 가는 로그인 화면. */
export const SIGNUP_CONFIRMED_MESSAGE = '가입 확인을 마쳤어요. 가입한 이메일과 비밀번호로 로그인해주세요.';

export function signupConfirmedLoginPath(next: string = '/') {
  const url = new URL('/login', 'https://icons.local');
  url.searchParams.set('mode', 'signin');
  url.searchParams.set('signup_confirmed', '1');
  const safeNext = safeNextPath(next);
  if (safeNext !== '/') url.searchParams.set('next', safeNext);
  return `${url.pathname}${url.search}`;
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
    case 'link_expired_or_used':
      return '비밀번호 재설정 링크가 만료되었거나 이미 사용되었습니다. 로그인 화면에서 새 재설정 메일을 요청해주세요.';
    case 'flow_state_expired':
    case 'flow_state_not_found':
    case 'bad_code_verifier':
    case 'bad_oauth_callback':
    case 'exchange_failed':
    case 'pkce_code_verifier_not_found':
    case 'browser_mismatch':
      return '이 브라우저에서 비밀번호 재설정을 완료할 수 없습니다. 재설정 메일을 요청한 브라우저에서 최신 링크를 열거나 새 메일을 요청해주세요.';
    case 'missing_code':
      return '비밀번호 재설정 링크가 올바르게 열리지 않았습니다. 로그인 화면에서 새 재설정 메일을 요청해주세요.';
    case 'session_expired':
    case 'session_not_found':
    case 'reauthentication_needed':
      return '비밀번호 재설정 세션이 만료되었습니다. 로그인 화면에서 새 재설정 메일을 요청해주세요.';
    case 'recovery_unavailable':
      return '현재 비밀번호 재설정을 완료할 수 없습니다. 잠시 후 새 재설정 메일을 요청해주세요.';
    default:
      return GENERIC_PASSWORD_RESET_ERROR_MESSAGE;
  }
}

export function publicPasswordRecoveryErrorCode(code: string | null | undefined) {
  switch (normalizeAuthCode(code)) {
    case 'pkce_code_verifier_not_found':
    case 'bad_code_verifier':
    case 'flow_state_expired':
    case 'flow_state_not_found':
      return 'browser_mismatch';
    case 'otp_expired':
      return 'link_expired_or_used';
    default:
      return 'unknown_recovery_error';
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
  const url = new URL(UPDATE_PASSWORD_PATH, 'https://icons.local');
  const safeNext = safeNextPath(next);
  if (safeNext !== '/') url.searchParams.set('next', safeNext);
  return `${url.pathname}${url.search}`;
}

export function updatePasswordSessionReadyPath(next: string = '/') {
  const url = new URL(UPDATE_PASSWORD_PATH, 'https://icons.local');
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
    /* 운영 Auth 가드가 recovery 세션이 아닌 비밀번호 변경을 거절한 경우 — 재설정 메일로만 바꿀 수 있다. */
    case 'current_password_required':
    case 'current_password_invalid':
      return '비밀번호 재설정 세션이 만료되었습니다. 로그인 화면에서 새 재설정 메일을 요청해주세요.';
    default:
      return GENERIC_PASSWORD_UPDATE_ERROR_MESSAGE;
  }
}
