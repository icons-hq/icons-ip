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
  catch (error) { unstable_rethrow(error); return { error: '현재 저장본을 불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.' }; }
}
export async function saveCustomerRewardPolicyAction(input: unknown, revision: unknown, operationId: unknown, rawIdentity: unknown) {
  const values = parseCustomerRewardValues(input), identity = parseGoodsGroupIdentity(rawIdentity);
  if (!values || !identity || !Number.isSafeInteger(revision) || Number(revision) < 1 || !isUuid(operationId)) return { error: '저장하지 않았습니다. 리뷰 1건당 적립금·보상 유효기간·등급별 적립률 값과 확인 칸 체크를 확인해주세요. ‘현재 저장본 다시 불러오기’를 누른 뒤 다시 입력해 저장합니다.' };
  const auth = await requireAdminActionAccess(CUSTOMER_REWARDS_PATH, { adminOnly: true });
  if (!auth || auth.user.id !== identity.actorId) return { error: '로그인 계정이 바뀌었습니다. 지금 로그인한 관리자 계정으로 화면을 새로고침해주세요.' };
  try {
    const { data, error } = await (await createClient()).rpc('admin_save_customer_reward_policy', { p_values: values, p_expected_revision: revision, p_operation_id: operationId,
      p_expected_actor: identity.actorId, p_expected_session: identity.sessionId });
    if (error) return { error: error.message === 'store_credit_policy_required' ? '기본 적립금 정책이 꺼져 있어 저장하지 않았습니다. 이 화면 위쪽의 적립금 정책을 켜고 저장한 뒤 다시 시도해주세요.' : error.code === 'PT409' ? '다른 관리자가 먼저 보상 정책을 바꿔 저장하지 않았습니다. ‘현재 저장본 다시 불러오기’로 바뀐 내용을 확인한 뒤 다시 저장해주세요.' : '저장됐는지 확인하지 못했습니다. ‘현재 저장본 다시 불러오기’를 눌러 저장됐는지 확인해주세요.' };
    const policy = parseCustomerRewardPolicy(data);
    if (!policy || policy.revision !== Number(revision) + 1) return { error: '저장됐는지 확인하지 못했습니다. ‘현재 저장본 다시 불러오기’를 눌러 저장됐는지 확인해주세요.' };
    revalidatePath(CUSTOMER_REWARDS_PATH); revalidatePath('/admin/marketing/customer-grades'); return { policy };
  } catch (error) { unstable_rethrow(error); return { error: '저장됐는지 확인하지 못했습니다. ‘현재 저장본 다시 불러오기’를 눌러 저장됐는지 확인해주세요.' }; }
}
export async function readBestReviewRewardAction(reviewId: unknown, process = false) {
  if (!isUuid(reviewId) || typeof process !== 'boolean') return { error: '리뷰를 찾지 못했습니다. 화면을 새로고침해주세요.' };
  if (!await requireAdminActionAccess('/admin/cs/reviews', { capability: 'cs.manage' })) return { error: '리뷰 관리 권한이 필요합니다.' };
  try {
    const { data, error } = await (await createClient()).rpc(process ? 'admin_process_review_best_reward' : 'admin_get_review_best_reward', { p_review_id: reviewId });
    const reward = error ? null : parseReviewBestReward(data);
    if (!reward || reward.reviewId !== reviewId) return { error: '리뷰 보상 상태를 확인하지 못했습니다. BEST 선정은 그대로 유지됩니다. 잠시 뒤 다시 확인해주세요.' };
    if (process) { revalidatePath('/admin/cs/reviews'); revalidatePath('/shop/[goodId]', 'page'); }
    return { reward };
  } catch (error) { unstable_rethrow(error); return { error: '리뷰 보상 상태를 확인하지 못했습니다. BEST 선정은 그대로 유지됩니다. 잠시 뒤 다시 확인해주세요.' }; }
}
