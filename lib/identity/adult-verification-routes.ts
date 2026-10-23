/*
 * 성인 인증 화면·콜백 경로. 서버·클라이언트가 같은 문자열을 쓰도록 한곳에 둔다.
 * KCP 인증결과URL에 등록되는 것은 도메인이고, 아래 콜백 경로는 그 도메인 아래에서
 * 거래등록 때 Ret_URL로 통째로 보낸다.
 */

export const ADULT_VERIFICATION_PATH = '/my/adult-verification';
export const ADULT_VERIFICATION_RESULT_PATH = '/my/adult-verification/result';

export type AdultVerificationResultStatus =
  | 'verified'
  | 'underage'
  | 'failed'
  | 'expired'
  | 'pending'
  | 'invalid'
  | 'login_required'
  | 'error';

export const ADULT_VERIFICATION_RESULT_STATUSES: readonly AdultVerificationResultStatus[] = [
  'verified', 'underage', 'failed', 'expired', 'pending', 'invalid', 'login_required', 'error',
];

export function adultVerificationHref(next?: string | null) {
  return next ? `${ADULT_VERIFICATION_PATH}?next=${encodeURIComponent(next)}` : ADULT_VERIFICATION_PATH;
}

export function adultVerificationResultHref(input: {
  readonly status: AdultVerificationResultStatus;
  readonly mode?: 'popup' | 'page';
  readonly next?: string | null;
}) {
  const params = new URLSearchParams({ status: input.status });
  if (input.mode) params.set('mode', input.mode);
  if (input.next) params.set('next', input.next);
  return `${ADULT_VERIFICATION_RESULT_PATH}?${params.toString()}`;
}

/** 팝업 결과 화면이 원래 창에 알리는 메시지 타입. 같은 origin 메시지만 받는다. */
export const ADULT_VERIFICATION_MESSAGE_TYPE = 'icons:adult-verification';
export const ADULT_VERIFICATION_CHANNEL = 'icons-adult-verification';
