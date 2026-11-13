import { LOYALTY_GRADES, type GradeBenefitCadence, type LoyaltyGrade } from './loyalty';

export const LOYALTY_POLICY_PATH = '/admin/marketing/customer-grades';
export const CONFIGURABLE_GRADES = ['silver', 'gold', 'platinum'] as const;
export type ConfigurableGrade = typeof CONFIGURABLE_GRADES[number];
export type LoyaltyCriterion = { grade: ConfigurableGrade; enabled: boolean; amount: number | null; itemCount: number | null };
export type LoyaltyPolicy = { tiers: LoyaltyCriterion[]; revision: number; updatedAt: string };
/** cadence 가 없으면 '승급 시 1회'로 읽는다(지급 방식 도입 전 응답). */
export type GradeBenefitCoupon = { code: string; name: string; grade: ConfigurableGrade; status: string; cadence?: GradeBenefitCadence };
/** 매월 등급 혜택 지급 한 달치 기록(private.loyalty_monthly_coupon_runs + 그 달 보유 쿠폰 원장). */
export const MONTHLY_GRADE_COUPON_FINISH_REASONS = ['completed', 'no_monthly_coupons', 'coupons_closed', 'month_ended'] as const;
export type MonthlyGradeCouponFinishReason = typeof MONTHLY_GRADE_COUPON_FINISH_REASONS[number];
export type MonthlyGradeCouponRun = {
  grantMonth: string;
  startedAt: string;
  finishedAt: string | null;
  finishReason: MonthlyGradeCouponFinishReason | null;
  members: number;
  recipients: number;
  granted: number;
  /** 등급 재산정이 실패해 그달 지급에서 뺀 회원 수(없던 응답은 0). */
  skipped: number;
  coupons: { code: string; name: string; granted: number }[];
};
export type LoyaltyPolicyData = { policy: LoyaltyPolicy; coupons: GradeBenefitCoupon[]; monthlyRuns?: MonthlyGradeCouponRun[] };

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** admin_get_loyalty_policy 의 monthlyRuns 검증. 없으면(도입 전 응답) 빈 기록, 하나라도 어긋나면 null. */
export function parseMonthlyGradeCouponRuns(value: unknown): MonthlyGradeCouponRun[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const runs: MonthlyGradeCouponRun[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const run = item as Record<string, unknown>;
    if (typeof run.grantMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(run.grantMonth) || !instant(run.startedAt)
      || !(run.finishedAt === null || instant(run.finishedAt))
      || !(run.finishReason === null || (MONTHLY_GRADE_COUPON_FINISH_REASONS as readonly unknown[]).includes(run.finishReason))
      || (run.finishedAt === null) !== (run.finishReason === null)
      || !count(run.members) || !count(run.recipients) || !count(run.granted)
      || !(run.skipped === undefined || count(run.skipped)) || !Array.isArray(run.coupons)) return null;
    const coupons: MonthlyGradeCouponRun['coupons'] = [];
    for (const coupon of run.coupons) {
      if (!coupon || typeof coupon !== 'object') return null;
      const entry = coupon as Record<string, unknown>;
      if (typeof entry.code !== 'string' || !entry.code || typeof entry.name !== 'string' || !entry.name || !count(entry.granted)) return null;
      coupons.push({ code: entry.code, name: entry.name, granted: entry.granted });
    }
    runs.push({
      grantMonth: run.grantMonth, startedAt: run.startedAt as string, finishedAt: run.finishedAt as string | null,
      finishReason: run.finishReason as MonthlyGradeCouponFinishReason | null,
      members: run.members as number, recipients: run.recipients as number, granted: run.granted as number,
      skipped: (run.skipped as number | undefined) ?? 0, coupons,
    });
  }
  return runs;
}

export function parseLoyaltyCriteria(value: unknown): LoyaltyCriterion[] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  let disabled = false; let lastAmount = 0; let lastCount = 0;
  const validNumber = (v: unknown, max: number) => v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= max);
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Object.keys(item).sort().join(',') !== 'amount,enabled,grade,itemCount'
      || item.grade !== CONFIGURABLE_GRADES[index] || typeof item.enabled !== 'boolean'
      || !validNumber(item.amount, 1_000_000_000_000) || !validNumber(item.itemCount, 1_000_000)) return null;
    if (!item.enabled) { disabled = true; continue; }
    if (disabled || (item.amount === null && item.itemCount === null)
      || (item.amount !== null && item.amount <= lastAmount) || (item.itemCount !== null && item.itemCount <= lastCount)) return null;
    if (item.amount !== null) lastAmount = item.amount;
    if (item.itemCount !== null) lastCount = item.itemCount;
  }
  return value as LoyaltyCriterion[];
}

export function parseLoyaltyPolicy(value: unknown): LoyaltyPolicy | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>; const tiers = parseLoyaltyCriteria(row.tiers);
  return tiers && typeof row.revision === 'number' && Number.isSafeInteger(row.revision) && row.revision > 0
    && typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt))
    ? { tiers, revision: row.revision, updatedAt: row.updatedAt } : null;
}

export function loyaltyProgressNote(current: LoyaltyGrade, spend: number, count: number, tiers: LoyaltyCriterion[]): string | null {
  const candidates = tiers.filter(tier => tier.enabled && LOYALTY_GRADES.indexOf(tier.grade) > LOYALTY_GRADES.indexOf(current));
  const satisfied = candidates.findLast(tier => (tier.amount !== null && spend >= tier.amount) || (tier.itemCount !== null && count >= tier.itemCount));
  if (satisfied) return `${satisfied.grade.toUpperCase()} 조건 충족 · 다음 재산정 시 반영`;
  const next = candidates[0];
  if (!next) return null;
  const amountRemaining = next.amount === null ? null : Math.max(0, next.amount - spend);
  const countRemaining = next.itemCount === null ? null : Math.max(0, next.itemCount - count);
  if (amountRemaining === 0 || countRemaining === 0) return `${next.grade.toUpperCase()} 조건 충족 · 다음 재산정 시 반영`;
  const conditions = [amountRemaining === null ? null : `${amountRemaining.toLocaleString('ko-KR')}원`, countRemaining === null ? null : `굿즈 주문 항목 ${countRemaining.toLocaleString('ko-KR')}건`].filter(Boolean);
  return `${next.grade.toUpperCase()}까지 ${conditions.join(' 또는 ')}`;
}
