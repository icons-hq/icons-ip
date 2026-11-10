'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { GOODS_RELATIONS_PATH, goodsRelationError, parseGoodsRelationInput, type GoodsRelation, type GoodsRelationCandidates } from '@/lib/admin/goods-relations';
import { loadGoodsRelation, searchGoodsForRelation } from '@/lib/admin/goods-relations.server';
import { isUuid } from '@/lib/uuid';

export async function saveGoodsRelationAction(input: unknown): Promise<{ saved: GoodsRelation } | { error: string; savedId?: string; retrySameOperation?: boolean }> {
  if (!await requireAdminActionAccess(GOODS_RELATIONS_PATH)) return { error: '관리자 권한이 필요합니다.' };
  const parsed = parseGoodsRelationInput(input);
  if (!parsed.ok) return { error: parsed.error };
  const suppliedOperation = (input as { operationId?: unknown }).operationId;
  if (suppliedOperation !== undefined && !isUuid(suppliedOperation)) return { error: '저장 요청을 다시 확인해주세요.' };
  const operationId = typeof suppliedOperation === 'string' ? suppliedOperation : randomUUID();
  let savedId: string | undefined;
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_save_goods_relation_composition', {
      p_id: parsed.id, p_expected_revision: parsed.revision, p_operation_id: operationId, p_values: { ...parsed.values, visual: parsed.values.visual ?? null },
    });
    if (error) return { error: goodsRelationError(error.message), ...(!error.code && suppliedOperation ? { retrySameOperation: true } : {}) };
    savedId = parsed.id;
    revalidatePath(GOODS_RELATIONS_PATH); revalidatePath('/shop/[goodId]', 'page');
    if (!data || data.id !== parsed.id || !Number.isSafeInteger(data.revision)) return { error: '저장 결과를 확인하지 못했습니다. 편성을 다시 열어 최신 내용을 확인해주세요.', savedId };
    const saved = await loadGoodsRelation(parsed.id);
    if (!saved || saved.revision !== data.revision) return { error: '저장은 반영됐지만 최신 내용을 확인해야 합니다. 편성을 다시 열어주세요.', savedId };
    return { saved };
  } catch (error) {
    unstable_rethrow(error);
    return { error: savedId ? '저장 후 다시 읽지 못했습니다. 편성을 다시 열어 저장 여부를 확인해주세요.' : '저장 결과를 확인하지 못했습니다. 입력은 유지됩니다. 같은 요청으로 결과를 확인해주세요.', savedId, ...(!savedId && suppliedOperation ? { retrySameOperation: true } : {}) };
  }
}
export async function findGoodsForRelationAction(query: string, page: number): Promise<{ data: GoodsRelationCandidates } | { error: string }> {
  if (!await requireAdminActionAccess(GOODS_RELATIONS_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 100000) return { error: '검색 조건을 확인해주세요.' };
  try { return { data: await searchGoodsForRelation(query.trim(), page) }; }
  catch (error) { unstable_rethrow(error); return { error: '상품을 불러오지 못했습니다. 다시 검색해주세요.' }; }
}
