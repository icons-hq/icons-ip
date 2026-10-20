import { describe, expect, it } from 'vitest';
import { parseCustomerRewardValues, parseCustomerRewardPolicy, rewardPercentBps, parseReviewBestReward } from './customer-rewards';
const values = { gradeEnabled: false, gradeRates: { welcome: null, silver: null, gold: null, platinum: null }, bestEnabled: false, bestAmount: null, bestValidityDays: null, bestReversal: null, evidence: 'TEST 정책 확인', acknowledged: true };
describe('고객 보상 정책 입력', () => {
  it('꺼진 기본값을 허용하고 금액·기간·회수 기준 없는 자동 지급을 거절한다', () => {
    expect(parseCustomerRewardValues(values)).not.toBeNull();
    for (const patch of [{ gradeEnabled: true }, { bestEnabled: true }, { acknowledged: false }, { bestAmount: -1 }, { bestValidityDays: 0 }, { bestReversal: 'unknown' }, { evidence: '' }, { extra: 1 }]) expect(parseCustomerRewardValues({ ...values, ...patch })).toBeNull();
    expect(parseCustomerRewardValues({ ...values, gradeEnabled: true, gradeRates: { welcome: 0, silver: 100, gold: 150, platinum: 200 }, bestEnabled: true, bestAmount: 100, bestValidityDays: 30, bestReversal: 'revoke' })).not.toBeNull();
  });
  it('소수 퍼센트를 정확한 정수 기준점으로 바꾸고 숨은 반올림을 하지 않는다', () => {
    expect(rewardPercentBps('1.25')).toBe(125); expect(rewardPercentBps('0')).toBe(0); expect(rewardPercentBps('100.00')).toBe(10000);
    for (const value of ['1.255', '-1', '100.01', '1e1', 'NaN', '', '.5']) expect(rewardPercentBps(value)).toBeNull();
  });
  it('저장본과 지급 응답의 누락·초과 금액을 거절한다', () => {
    const policy = Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'acknowledged'));
    expect(parseCustomerRewardPolicy({ ...policy, revision: 1, updatedAt: '2026-10-16T01:00:00Z', baseCreditEnabled: false })).not.toBeNull();
    expect(parseCustomerRewardPolicy({ ...policy, revision: 1, updatedAt: 'bad', baseCreditEnabled: false })).toBeNull();
    const reward = { reviewId: '93500000-0000-4000-8000-000000000001', state: 'paid', amount: 100, plannedAmount: 100, grantedAt: '2026-10-16T01:00:00Z', expiresAt: '2026-11-16T01:00:00Z', revokedAt: null };
    expect(parseReviewBestReward(reward)).not.toBeNull();
    for (const patch of [{ amount: 101 }, { grantedAt: null }, { state: 'revoked' }, { state: 'unknown' }]) expect(parseReviewBestReward({ ...reward, ...patch })).toBeNull();
  });
});
