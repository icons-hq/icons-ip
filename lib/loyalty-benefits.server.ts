import 'server-only';

import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import {
  parseLoyaltyGradeBenefits,
  parseLoyaltyStanding,
  type LoyaltyGradeBenefits,
  type MyLoyaltyStanding,
} from './loyalty-benefits';

/* 회원 등급 혜택 화면 로더 (LFS 패리티 2차 L6 · MY-05).
 *
 * 두 읽기는 서로를 기다릴 이유가 없어 함께 부른다:
 *   - get_my_loyalty_status(): 내 등급·최근 실적·등급 조건(정책 tiers) — 프로필 스트립과 같은 정본.
 *   - get_loyalty_grade_benefits(): 등급별 혜택(지급 중인 등급 혜택 쿠폰·적립률).
 * 절대 던지지 않는다. 한쪽을 못 읽으면 그쪽만 null 로 접어 화면이 "확인하지 못했어요"를 그 자리에 쓴다 —
 * 등급 안내 하나 때문에 마이페이지가 500 이 되면 안 된다. */

export interface LoyaltyBenefitsPageData {
  standing: MyLoyaltyStanding | null;
  benefits: LoyaltyGradeBenefits | null;
}

export async function loadLoyaltyBenefitsPage(): Promise<LoyaltyBenefitsPageData> {
  if (!getSupabaseConfig().isConfigured) return { standing: null, benefits: null };

  try {
    const supabase = await createClient();
    const [statusResult, benefitsResult] = await Promise.all([
      supabase.rpc('get_my_loyalty_status'),
      supabase.rpc('get_loyalty_grade_benefits'),
    ]);
    return {
      standing: statusResult.error ? null : parseLoyaltyStanding(statusResult.data),
      benefits: benefitsResult.error ? null : parseLoyaltyGradeBenefits(benefitsResult.data),
    };
  } catch {
    return { standing: null, benefits: null };
  }
}
