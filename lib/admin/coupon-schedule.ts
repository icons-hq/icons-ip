import type { AdminFieldErrors } from './catalog';
import { kstDateTimeToIso } from './kst';

export interface CouponIssueSchedule {
  issueStartsAt: string | null;
  issueEndsAt: string | null;
  validDays: number | null;
}

export function readCouponIssueSchedule(form: FormData, startsAt: string | null, endsAt: string | null, errors: AdminFieldErrors): CouponIssueSchedule {
  const mode = String(form.get('validityMode') ?? 'period');
  const issueStartsAt = form.has('issueStartsAt') ? kstDateTimeToIso(form, 'issueStartsAt', errors) : startsAt;
  const issueEndsAt = form.has('issueEndsAt') ? kstDateTimeToIso(form, 'issueEndsAt', errors) : endsAt;
  if (!issueStartsAt && !errors.issueStartsAt) errors.issueStartsAt = '발급 시작일을 선택해주세요.';
  if (issueStartsAt && issueEndsAt && Date.parse(issueEndsAt) <= Date.parse(issueStartsAt)) errors.issueEndsAt = '발급 종료일은 시작일보다 뒤여야 합니다.';
  if (mode !== 'period' && mode !== 'relative') errors.validityMode = '쿠폰 유효기간 방식을 선택해주세요.';
  const validDays = mode === 'relative' ? Number(form.get('validDays')) : null;
  if (validDays !== null && (!Number.isSafeInteger(validDays) || validDays < 1 || validDays > 365)) errors.validDays = '발급일 기준 1~365일을 입력해주세요.';
  if (mode === 'period' && endsAt && issueStartsAt && Date.parse(issueStartsAt) >= Date.parse(endsAt)) errors.issueStartsAt = '사용 종료 전부터 발급할 수 있도록 설정해주세요.';
  if (mode === 'period' && endsAt && issueEndsAt && Date.parse(issueEndsAt) > Date.parse(endsAt)) errors.issueEndsAt = '발급 종료일은 사용 종료일보다 늦을 수 없습니다.';
  return { issueStartsAt, issueEndsAt, validDays };
}

export function parseCouponIssueSchedule(row: Record<string, unknown>): CouponIssueSchedule | null {
  // Older fixtures and read contracts retain their original shared period.
  const starts = row.issue_starts_at ?? null;
  const ends = row.issue_ends_at ?? null;
  const days = row.valid_days ?? null;
  if ((starts !== null && (typeof starts !== 'string' || !Number.isFinite(Date.parse(starts))))
    || (ends !== null && (typeof ends !== 'string' || !Number.isFinite(Date.parse(ends))))
    || (days !== null && (!Number.isSafeInteger(days) || Number(days) < 1 || Number(days) > 365))) return null;
  return { issueStartsAt: starts as string | null, issueEndsAt: ends as string | null, validDays: days as number | null };
}
