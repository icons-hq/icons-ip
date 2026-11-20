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
    if (!await requireAdminActionAccess(LOYALTY_POLICY_PATH, { adminOnly: true })) return { error: '회원등급 설정은 최고 관리자만 조회할 수 있습니다.' };
    return { data: await loadAdminLoyaltyPolicy() };
  } catch (error) {
    unstable_rethrow(error);
    return { error: '최신 회원등급 설정을 불러오지 못했습니다. 작성한 입력은 그대로 있습니다. 잠시 뒤 다시 눌러주세요.' };
  }
}

export async function saveLoyaltyPolicyAction(input: unknown, expectedRevision: number, operationId: string): Promise<LoyaltyPolicySaveResult> {
  try {
    if (!await requireAdminActionAccess(LOYALTY_POLICY_PATH, { adminOnly: true })) return { error: '회원등급 설정은 최고 관리자만 저장할 수 있습니다.' };
    const tiers = parseLoyaltyCriteria(input);
    if (!tiers || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !isUuid(operationId)) return { error: '저장하지 않았습니다. 사용할 등급은 SILVER부터 순서대로 켜고, 금액 또는 상품 주문 항목 수를 하나 이상 넣어주세요. 위 등급의 조건은 아래 등급보다 커야 합니다.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_loyalty_policy', {
      p_tiers: tiers, p_expected_revision: expectedRevision, p_operation_id: operationId,
    });
    if (error) {
      if (error.message?.includes('operation_conflict')) return { error: '저장됐는지 확인하지 못했습니다. 입력은 그대로 있습니다. ‘같은 요청으로 저장 결과 확인’을 눌러주세요. 이미 저장됐다면 두 번 저장되지 않고 결과만 보여 줍니다.', uncertain: true };
      if (error.code === 'PT409' || /loyalty.*(changed|conflict)/.test(error.message ?? '')) return { error: '다른 관리자가 먼저 등급 설정을 바꿔서 저장하지 않았습니다. 작성한 입력은 그대로 있습니다. ‘최신 정책과 비교’를 눌러 바뀐 내용을 확인한 뒤 다시 저장해주세요.', conflict: true };
      if (['22023', '23514', '42501', 'P0002'].includes(error.code ?? '')) return { error: '등급 설정을 저장하지 않았습니다. 최고 관리자 계정인지, 위 등급의 조건이 아래 등급보다 큰지 확인한 뒤 다시 저장해주세요.' };
      return { error: '저장됐는지 확인하지 못했습니다. 입력은 그대로 있습니다. ‘같은 요청으로 저장 결과 확인’을 눌러주세요. 이미 저장됐다면 두 번 저장되지 않고 결과만 보여 줍니다.', uncertain: true };
    }
    if (!data || typeof data !== 'object' || !Number.isSafeInteger(data.revision) || data.revision < 1
      || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) return { error: '저장됐는지 확인하지 못했습니다. 입력은 그대로 있습니다. ‘같은 요청으로 저장 결과 확인’을 눌러주세요. 이미 저장됐다면 두 번 저장되지 않고 결과만 보여 줍니다.', uncertain: true };
    revalidatePath(LOYALTY_POLICY_PATH);
    revalidatePath('/my');
    revalidatePath('/admin/sales/coupons');
    return { receipt: { revision: data.revision, updatedAt: data.updatedAt } };
  } catch (error) {
    unstable_rethrow(error);
    return { error: '저장됐는지 확인하지 못했습니다. 입력은 그대로 있습니다. ‘같은 요청으로 저장 결과 확인’을 눌러주세요. 이미 저장됐다면 두 번 저장되지 않고 결과만 보여 줍니다.', uncertain: true };
  }
}
