import { LOYALTY_GRADES, type LoyaltyGrade } from './loyalty';

export const LOYALTY_POLICY_PATH = '/admin/marketing/customer-grades';
export const CONFIGURABLE_GRADES = ['silver', 'gold', 'platinum'] as const;
export type ConfigurableGrade = typeof CONFIGURABLE_GRADES[number];
export type LoyaltyCriterion = { grade: ConfigurableGrade; enabled: boolean; amount: number | null; itemCount: number | null };
export type LoyaltyPolicy = { tiers: LoyaltyCriterion[]; revision: number; updatedAt: string };
export type GradeBenefitCoupon = { code: string; name: string; grade: ConfigurableGrade; status: string };
export type LoyaltyPolicyData = { policy: LoyaltyPolicy; coupons: GradeBenefitCoupon[] };

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
