'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { loadAdminLoyaltyPolicy } from '@/lib/admin/loyalty-policy.server';
import { LOYALTY_POLICY_PATH, parseLoyaltyCriteria, type LoyaltyPolicyData } from '@/lib/loyalty-policy';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

type Failure = { error: string; uncertain?: boolean; conflict?: boolean };
export type LoyaltyPolicySaveResult = { receipt: { revision: number; updatedAt: string } } | Failure;

export async function readLoyaltyPolicyAction(): Promise<{ data: LoyaltyPolicyData } | Failure> {
  try {
    if (!await requireAdminActionAccess(LOYALTY_POLICY_PATH, { adminOnly: true })) return { error: '회원등급 설정은 관리자(admin)만 조회할 수 있습니다.' };
    return { data: await loadAdminLoyaltyPolicy() };
  } catch (error) {
    unstable_rethrow(error);
    return { error: '최신 회원등급 설정을 불러오지 못했습니다. 입력은 유지됩니다.' };
  }
}

export async function saveLoyaltyPolicyAction(input: unknown, expectedRevision: number, operationId: string): Promise<LoyaltyPolicySaveResult> {
  try {
    if (!await requireAdminActionAccess(LOYALTY_POLICY_PATH, { adminOnly: true })) return { error: '회원등급 설정은 관리자(admin)만 저장할 수 있습니다.' };
    const tiers = parseLoyaltyCriteria(input);
    if (!tiers || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !isUuid(operationId)) return { error: '등급별 사용 여부와 승급 조건을 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_loyalty_policy', {
      p_tiers: tiers, p_expected_revision: expectedRevision, p_operation_id: operationId,
    });
    if (error) {
      if (error.message?.includes('operation_conflict')) return { error: '이 저장 요청의 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
      if (error.code === 'PT409' || /loyalty.*(changed|conflict)/.test(error.message ?? '')) return { error: '다른 관리자가 등급 설정을 변경했습니다. 작성한 입력은 유지됩니다. 최신 정책을 조회해 비교해주세요.', conflict: true };
      if (['22023', '23514', '42501', 'P0002'].includes(error.code ?? '')) return { error: '등급 설정이 저장되지 않았습니다. 권한과 승급 조건을 확인해주세요.' };
      return { error: '저장 결과를 확인하지 못했습니다. 입력을 유지하고 같은 요청으로 다시 확인해주세요.', uncertain: true };
    }
    if (!data || typeof data !== 'object' || !Number.isSafeInteger(data.revision) || data.revision < 1
      || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) return { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
    revalidatePath(LOYALTY_POLICY_PATH);
    revalidatePath('/my');
    revalidatePath('/admin/sales/coupons');
    return { receipt: { revision: data.revision, updatedAt: data.updatedAt } };
  } catch (error) {
    unstable_rethrow(error);
    return { error: '저장 결과를 확인하지 못했습니다. 입력을 유지하고 같은 요청으로 다시 확인해주세요.', uncertain: true };
  }
}
