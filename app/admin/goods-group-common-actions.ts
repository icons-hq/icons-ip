'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { normalizeGoodsGroupCommonForm } from '@/lib/admin/goods-group-common';
import { GOODS_GROUPS_PATH, goodsGroupError, parseGoodsGroupReceipt, parseGoodsGroupRecovery, type GoodsGroupReceipt, type GoodsGroupResult } from '@/lib/admin/goods-groups';

export async function saveGoodsGroupCommonAction(input: unknown, form: FormData): Promise<GoodsGroupResult<GoodsGroupReceipt>> {
  const recovery = parseGoodsGroupRecovery(input);
  if (!recovery || recovery.command !== 'common' || !(form instanceof FormData)) return goodsGroupError('22023');
  const normalized = normalizeGoodsGroupCommonForm(form);
  if (!normalized.ok) return { error: Object.values(normalized.errors).join(' ') };
  const auth = await requireAdminActionAccess(GOODS_GROUPS_PATH, { capability: 'catalog.manage' });
  if (!auth || auth.user.id !== recovery.actorId) return goodsGroupError('42501', undefined, true);
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_group_common', { p_group_id: recovery.groupId, p_expected_revision: recovery.expectedRevision,
      p_values: normalized.values, p_operation_id: recovery.operationId, p_expected_actor_id: recovery.actorId, p_expected_session_id: recovery.sessionId });
    if (error) return goodsGroupError(error.code, error.message, true);
    const receipt = parseGoodsGroupReceipt(data, recovery);
    if (!receipt || receipt.state === 'unresolved') return { error: '저장 결과를 확인하지 못했습니다. 같은 진행 내역을 조회해주세요.', uncertain: true };
    if (receipt.state === 'completed') { try { revalidateGoodsSurfaces(); revalidatePath(GOODS_GROUPS_PATH); } catch (error) { unstable_rethrow(error); } }
    return { value: receipt };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과가 불명확합니다. 진행 내역을 확인해주세요.', uncertain: true }; }
}
