import 'server-only';

import { isGradeBenefitCadence } from '@/lib/loyalty';
import {
  CONFIGURABLE_GRADES, parseLoyaltyPolicy, parseMonthlyGradeCouponRuns, type GradeBenefitCoupon, type LoyaltyPolicyData,
} from '@/lib/loyalty-policy';
import { createClient } from '@/lib/supabase/server';

export function parseAdminLoyaltyPolicy(value: unknown): LoyaltyPolicyData | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const policy = parseLoyaltyPolicy(row.policy);
  const monthlyRuns = parseMonthlyGradeCouponRuns(row.monthlyRuns);
  if (!policy || !Array.isArray(row.coupons) || !monthlyRuns) return null;
  const codes = new Set<string>();
  const coupons: GradeBenefitCoupon[] = [];
  for (const coupon of row.coupons) {
    if (!coupon || typeof coupon !== 'object' || typeof coupon.code !== 'string' || !coupon.code.trim()
      || typeof coupon.name !== 'string' || !coupon.name.trim()
      || !CONFIGURABLE_GRADES.includes(coupon.grade) || !['active', 'paused', 'archived'].includes(coupon.status)
      /* 지급 방식이 없으면 도입 전 응답(승급 시 1회), 알 수 없는 값이면 계약 위반이다. */
      || !(coupon.cadence === undefined || isGradeBenefitCadence(coupon.cadence))
      || codes.has(coupon.code)) return null;
    codes.add(coupon.code);
    coupons.push({ code: coupon.code, name: coupon.name, grade: coupon.grade, status: coupon.status, cadence: coupon.cadence ?? 'upgrade' });
  }
  return { policy, coupons, monthlyRuns };
}

export async function loadAdminLoyaltyPolicy(): Promise<LoyaltyPolicyData> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_get_loyalty_policy');
  const parsed = parseAdminLoyaltyPolicy(data);
  if (error || !parsed) throw new Error('회원등급 설정을 불러오지 못했습니다. 잠시 후 다시 조회해주세요.');
  return parsed;
}
