'use server';

import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { createClient } from '@/lib/supabase/server';
import { goodsSubscriptionPolicyError, goodsSubscriptionReceiptMatches, parseGoodsSubscriptionPolicy, parseGoodsSubscriptionPolicyReceipt,
  parseGoodsSubscriptionPolicyRequest, sameGoodsSubscriptionPolicy, validGoodsSubscriptionContext,
  type GoodsSubscriptionContext, type GoodsSubscriptionPolicy, type GoodsSubscriptionPolicyRequest, type GoodsSubscriptionPolicyResult } from '@/lib/admin/goods-subscription-policy';

async function authorized(context: GoodsSubscriptionContext) {
  const access = await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' });
  return access?.user.id === context.expectedActorId.toLowerCase();
}
const denied = (): GoodsSubscriptionPolicyResult<never> => ({ ok: false, error: '현재 로그인 계정과 상품관리 권한을 확인해주세요.' });

export async function readGoodsSubscriptionPolicyAction(context: GoodsSubscriptionContext): Promise<GoodsSubscriptionPolicyResult<GoodsSubscriptionPolicy>> {
  if (!validGoodsSubscriptionContext(context)) return { ok: false, error: '상품을 다시 선택해주세요.' };
  if (!await authorized(context)) return denied();
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_get_goods_subscription_policy', {
      p_expected_actor_id: context.expectedActorId, p_good_id: context.goodId,
    });
    const policy = error ? null : parseGoodsSubscriptionPolicy(data);
    return policy?.goodId === context.goodId ? { ok: true, value: policy }
      : { ok: false, error: '정기배송 저장값을 확인하지 못했습니다. 다시 불러와주세요.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '정기배송 설정을 불러오지 못했습니다. 현재 입력은 유지됩니다.' }; }
}

export async function saveGoodsSubscriptionPolicyAction(raw: GoodsSubscriptionPolicyRequest): Promise<GoodsSubscriptionPolicyResult<GoodsSubscriptionPolicy>> {
  const request = parseGoodsSubscriptionPolicyRequest(raw);
  if (!request) return { ok: false, error: '상품·저장 기준·정기배송 주기와 안내 문구를 확인해주세요.' };
  if (!await authorized(request)) return denied();
  let response;
  try {
    const client = await createClient();
    response = await client.rpc('admin_save_goods_subscription_policy', { p_expected_actor_id: request.expectedActorId,
      p_good_id: request.goodId, p_expected_revision: request.expectedRevision, p_expected_good_updated_at: request.expectedGoodUpdatedAt,
      p_operation_id: request.operationId, p_enabled: request.enabled, p_intervals: request.intervals, p_message: request.message });
  } catch (error) {
    unstable_rethrow(error); return { ok: false, uncertain: true, error: '저장 결과가 불명확합니다. 같은 요청으로 결과를 확인해주세요.' };
  }
  if (response.error) {
    const { code, message } = response.error;
    const rejected = ['22023', '42501', '28000', '23514', '23503', 'P0002', 'PT409', '23505'].includes(code ?? '');
    return { ok: false, uncertain: !rejected, conflict: code === 'PT409' || code === '23505',
      error: rejected ? goodsSubscriptionPolicyError(message) : '저장 결과가 불명확합니다. 같은 요청으로 다시 확인해주세요.' };
  }
  const receipt = parseGoodsSubscriptionPolicyReceipt(response.data);
  if (!receipt || !goodsSubscriptionReceiptMatches(receipt, request)) return { ok: false, uncertain: true, error: '저장 응답을 대조하지 못했습니다. 같은 요청으로 다시 확인해주세요.' };
  const saved: GoodsSubscriptionPolicy = { goodId: receipt.goodId, revision: receipt.revision, goodUpdatedAt: receipt.goodUpdatedAt,
    enabled: receipt.enabled, intervals: receipt.intervals, message: receipt.message };
  const latest = await readGoodsSubscriptionPolicyAction(request);
  try { revalidateGoodsSurfaces(); } catch (error) { unstable_rethrow(error); }
  if (!latest.ok || !sameGoodsSubscriptionPolicy(saved, latest.value)) return { ok: false, committed: receipt,
    ...(latest.ok ? { latest: latest.value, conflict: true } : {}), error: latest.ok
      ? '요청은 저장됐고 이후 변경도 있습니다. 최신 저장본과 입력을 비교해주세요.'
      : '저장은 처리됐지만 최신 상태를 읽지 못했습니다. 최신 저장본을 다시 확인해주세요.' };
  return latest;
}
