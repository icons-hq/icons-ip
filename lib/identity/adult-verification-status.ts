/*
 * 내 성인 인증 상태(표시용). DB get_my_adult_verification의 응답을 화면이 쓰는 형태로
 * 좁힌다. 노출·구매 경계는 이 값이 아니라 DB 함수 안의 판정이 지킨다.
 */

export type AdultVerificationRevokedReason = 'superseded' | 'subject_moved' | 'underage_result' | 'operator';

export type AdultVerificationStatus =
  | { readonly status: 'verified'; readonly verifiedAt: string; readonly expiresAt: string }
  | { readonly status: 'expired'; readonly verifiedAt: string; readonly expiresAt: string }
  | { readonly status: 'revoked'; readonly reason: AdultVerificationRevokedReason; readonly revokedAt: string }
  | { readonly status: 'none' };

const REVOKED_REASONS = new Set<AdultVerificationRevokedReason>(['superseded', 'subject_moved', 'underage_result', 'operator']);

function isoString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function parseAdultVerificationStatus(value: unknown): AdultVerificationStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'none' };
  const row = value as Record<string, unknown>;
  if ((row.status === 'verified' || row.status === 'expired') && isoString(row.verifiedAt) && isoString(row.expiresAt)) {
    return { status: row.status, verifiedAt: row.verifiedAt, expiresAt: row.expiresAt };
  }
  if (
    row.status === 'revoked'
    && typeof row.reason === 'string'
    && REVOKED_REASONS.has(row.reason as AdultVerificationRevokedReason)
    && isoString(row.revokedAt)
  ) {
    return { status: 'revoked', reason: row.reason as AdultVerificationRevokedReason, revokedAt: row.revokedAt };
  }
  return { status: 'none' };
}

const KST_DATE = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 마이페이지 날짜 서식(YYYY.MM.DD, KST). */
export function formatAdultVerificationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = KST_DATE.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}.${get('month')}.${get('day')}`;
}
