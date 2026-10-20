import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
export const CUSTOMER_REWARDS_PATH = '/admin/settings/store-credits';
export const REWARD_GRADES = ['welcome', 'silver', 'gold', 'platinum'] as const;
export interface CustomerRewardValues {
  gradeEnabled: boolean; gradeRates: Record<typeof REWARD_GRADES[number], number | null>;
  bestEnabled: boolean; bestAmount: number | null; bestValidityDays: number | null; bestReversal: 'keep' | 'revoke' | null; evidence: string;
}
export interface CustomerRewardPolicy extends CustomerRewardValues { revision: number; updatedAt: string; baseCreditEnabled: boolean }
function validValues(value: unknown): value is CustomerRewardValues {
  if (!transactionRecord(value) || !transactionRecord(value.gradeRates)) return false;
  const rates = value.gradeRates;
  return transactionRecord(value) && typeof value.gradeEnabled === 'boolean' && typeof value.bestEnabled === 'boolean' && transactionRecord(value.gradeRates)
    && transactionExactKeys(rates, [...REWARD_GRADES]) && REWARD_GRADES.every(grade => rates[grade] === null ? !value.gradeEnabled : transactionInteger(rates[grade], 0, 10000))
    && (value.bestAmount === null ? !value.bestEnabled : transactionInteger(value.bestAmount, 1, 999_999_999_999))
    && (value.bestValidityDays === null ? !value.bestEnabled : transactionInteger(value.bestValidityDays, 1, 36500))
    && (value.bestReversal === null ? !value.bestEnabled : value.bestReversal === 'keep' || value.bestReversal === 'revoke')
    && typeof value.evidence === 'string' && [...value.evidence].length <= 2000;
}
export function parseCustomerRewardValues(value: unknown): (CustomerRewardValues & { acknowledged: true }) | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['gradeEnabled','gradeRates','bestEnabled','bestAmount','bestValidityDays','bestReversal','evidence','acknowledged'])
    || !validValues(value) || value.acknowledged !== true || !value.evidence.trim()) return null;
  return { ...value, evidence: value.evidence.trim() } as CustomerRewardValues & { acknowledged: true };
}
export function parseCustomerRewardPolicy(value: unknown): CustomerRewardPolicy | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['gradeEnabled','gradeRates','bestEnabled','bestAmount','bestValidityDays','bestReversal','evidence','revision','updatedAt','baseCreditEnabled'])
    || !validValues(value) || !transactionInteger(value.revision, 1) || !transactionInstant(value.updatedAt) || typeof value.baseCreditEnabled !== 'boolean') return null;
  return value as unknown as CustomerRewardPolicy;
}
export function rewardPercentBps(value: string): number | null {
  if (!/^(?:\d{1,2}|100)(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, decimals = ''] = value.split('.'), bps = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  return bps <= 10000 ? bps : null;
}
export interface ReviewBestReward { reviewId: string; state: 'none' | 'disabled' | 'pending' | 'paid' | 'revoked' | 'capped' | 'skipped'; amount: number; plannedAmount: number; grantedAt: string | null; expiresAt: string | null; revokedAt: string | null }
export const BEST_REWARD_LABELS: Record<ReviewBestReward['state'], string> = { none: '지급 이력 없음', disabled: '자동 보상 꺼짐', pending: '보상 처리 대기', paid: '지급 완료', revoked: '보상 회수 처리', capped: '보유 한도 적용', skipped: '지급 조건 미충족' };
export function parseReviewBestReward(value: unknown): ReviewBestReward | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['reviewId','state','amount','plannedAmount','grantedAt','expiresAt','revokedAt']) || !isUuid(value.reviewId)
    || typeof value.state !== 'string' || !Object.hasOwn(BEST_REWARD_LABELS, value.state) || !transactionInteger(value.amount, 0, 999_999_999_999)
    || !transactionInteger(value.plannedAmount, 0, 999_999_999_999) || value.amount > value.plannedAmount
    || ['grantedAt','expiresAt','revokedAt'].some(key => value[key] !== null && !transactionInstant(value[key]))) return null;
  if (['paid','capped','revoked'].includes(value.state) && (!value.grantedAt || !value.expiresAt) || value.state === 'revoked' && !value.revokedAt) return null;
  return value as unknown as ReviewBestReward;
}
