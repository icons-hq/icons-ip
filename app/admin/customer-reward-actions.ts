'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { loadCustomerRewardPolicy } from '@/lib/admin/customer-rewards.server';
import { CUSTOMER_REWARDS_PATH, parseCustomerRewardPolicy, parseCustomerRewardValues, parseReviewBestReward } from '@/lib/admin/customer-rewards';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { isUuid } from '@/lib/uuid';
export async function readCustomerRewardPolicyAction() {
  if (!await requireAdminActionAccess(CUSTOMER_REWARDS_PATH, { adminOnly: true })) return { error: '적립금 정책 관리 권한이 필요합니다.' };
  try { return { policy: await loadCustomerRewardPolicy() }; }
  catch (error) { unstable_rethrow(error); return { error: '현재 저장본을 조회하지 못했습니다.' }; }
}
export async function saveCustomerRewardPolicyAction(input: unknown, revision: unknown, operationId: unknown, rawIdentity: unknown) {
  const values = parseCustomerRewardValues(input), identity = parseGoodsGroupIdentity(rawIdentity);
  if (!values || !identity || !Number.isSafeInteger(revision) || Number(revision) < 1 || !isUuid(operationId)) return { error: '보상 금액·기간·적립률과 적용 기준 확인을 완료해주세요.' };
  const auth = await requireAdminActionAccess(CUSTOMER_REWARDS_PATH, { adminOnly: true });
  if (!auth || auth.user.id !== identity.actorId) return { error: '현재 관리자 계정으로 다시 열어주세요.' };
  try {
    const { data, error } = await (await createClient()).rpc('admin_save_customer_reward_policy', { p_values: values, p_expected_revision: revision, p_operation_id: operationId,
      p_expected_actor: identity.actorId, p_expected_session: identity.sessionId });
    if (error) return { error: error.message === 'store_credit_policy_required' ? '기본 적립금 정책을 먼저 설정·활성화해주세요.' : error.code === 'PT409' ? '정책이 변경되었습니다. 현재 저장본을 조회한 뒤 다시 확인해주세요.' : '저장 결과를 확인하지 못했습니다. 현재 저장본을 조회해주세요.' };
    const policy = parseCustomerRewardPolicy(data);
    if (!policy || policy.revision !== Number(revision) + 1) return { error: '저장 응답을 확인하지 못했습니다. 현재 저장본을 조회해주세요.' };
    revalidatePath(CUSTOMER_REWARDS_PATH); revalidatePath('/admin/marketing/customer-grades'); return { policy };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과가 불명확합니다. 현재 저장본을 조회해주세요.' }; }
}
export async function readBestReviewRewardAction(reviewId: unknown, process = false) {
  if (!isUuid(reviewId) || typeof process !== 'boolean') return { error: '리뷰를 확인해주세요.' };
  if (!await requireAdminActionAccess('/admin/cs/reviews', { capability: 'cs.manage' })) return { error: '리뷰 관리 권한이 필요합니다.' };
  try {
    const { data, error } = await (await createClient()).rpc(process ? 'admin_process_review_best_reward' : 'admin_get_review_best_reward', { p_review_id: reviewId });
    const reward = error ? null : parseReviewBestReward(data);
    if (!reward || reward.reviewId !== reviewId) return { error: '리뷰 보상 상태를 확인하지 못했습니다. 선정 결과는 유지됩니다.' };
    if (process) { revalidatePath('/admin/cs/reviews'); revalidatePath('/shop/[goodId]', 'page'); }
    return { reward };
  } catch (error) { unstable_rethrow(error); return { error: '리뷰 보상 상태를 확인하지 못했습니다. 선정 결과는 유지됩니다.' }; }
}
