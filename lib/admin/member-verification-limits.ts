import type { OverseasRequest } from '@/lib/identity/overseas-adult';

export const VERIFICATION_LIMIT_LABELS = {
  overseas_adult: '해외 신분증 성인 인증',
  domestic_adult: '국내 휴대폰 성인 인증',
  phone_code: '휴대폰 인증문자 발송',
  email_change: '이메일 변경 인증메일 발송',
} as const;
export type VerificationLimitKind = keyof typeof VERIFICATION_LIMIT_LABELS;

type OverseasState = Exclude<OverseasRequest['state'], 'closed'> | 'verified';
export const OVERSEAS_PROGRESS: Record<OverseasState, string> = {
  draft: '신청 작성 중', uploading: '사진 제출 중', pending: '심사 대기 중',
  reviewing: '심사 중', purging: '사진 파기 중', verified: '성인 인증 완료',
};

export interface MemberVerificationLimit {
  kind: VerificationLimitKind;
  hourLimit: number | null;
  dayLimit: number;
  hourUsed: number;
  dayUsed: number;
  retryAt: string | null;
  revision: string | null;
}

export interface MemberVerificationLimits {
  checkedAt: string;
  canReset: boolean;
  overseasState: OverseasState | null;
  limits: MemberVerificationLimit[];
}

export function isVerificationLimitKind(value: unknown): value is VerificationLimitKind {
  return typeof value === 'string' && Object.hasOwn(VERIFICATION_LIMIT_LABELS, value);
}

const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const isLimitRevision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

function isLimit(row: unknown): row is MemberVerificationLimit {
  if (!row || typeof row !== 'object') return false;
  const r = row as Partial<MemberVerificationLimit>;
  return isVerificationLimitKind(r.kind) && isCount(r.hourUsed) && isCount(r.dayUsed)
    && r.hourUsed <= r.dayUsed && (r.hourLimit === null || isCount(r.hourLimit) && r.hourLimit > 0)
    && isCount(r.dayLimit) && r.dayLimit > 0 && (r.retryAt === null || isTime(r.retryAt))
    && (r.dayUsed === 0 ? r.revision === null : isLimitRevision(r.revision));
}

export function parseMemberVerificationLimits(data: unknown): MemberVerificationLimits | null {
  if (!data || typeof data !== 'object') return null;
  const s = data as Partial<MemberVerificationLimits>;
  if (!isTime(s.checkedAt) || typeof s.canReset !== 'boolean'
    || (s.overseasState !== null && (typeof s.overseasState !== 'string' || !Object.hasOwn(OVERSEAS_PROGRESS, s.overseasState)))
    || !Array.isArray(s.limits) || s.limits.length !== Object.keys(VERIFICATION_LIMIT_LABELS).length
    || !s.limits.every(isLimit) || new Set(s.limits.map(row => row.kind)).size !== s.limits.length) return null;
  return { checkedAt: s.checkedAt, canReset: s.canReset, overseasState: s.overseasState, limits: s.limits };
}
