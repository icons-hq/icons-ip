import 'server-only';

import { CONFIGURABLE_GRADES, parseLoyaltyPolicy, type LoyaltyPolicyData } from '@/lib/loyalty-policy';
import { createClient } from '@/lib/supabase/server';

export function parseAdminLoyaltyPolicy(value: unknown): LoyaltyPolicyData | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const policy = parseLoyaltyPolicy(row.policy);
  if (!policy || !Array.isArray(row.coupons)) return null;
  const codes = new Set<string>();
  for (const coupon of row.coupons) {
    if (!coupon || typeof coupon !== 'object' || typeof coupon.code !== 'string' || !coupon.code.trim()
      || typeof coupon.name !== 'string' || !coupon.name.trim()
      || !CONFIGURABLE_GRADES.includes(coupon.grade) || !['active', 'paused', 'archived'].includes(coupon.status)
      || codes.has(coupon.code)) return null;
    codes.add(coupon.code);
  }
  return { policy, coupons: row.coupons };
}

export async function loadAdminLoyaltyPolicy(): Promise<LoyaltyPolicyData> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_get_loyalty_policy');
  const parsed = parseAdminLoyaltyPolicy(data);
  if (error || !parsed) throw new Error('회원등급 설정을 불러오지 못했습니다. 잠시 후 다시 조회해주세요.');
  return parsed;
}
