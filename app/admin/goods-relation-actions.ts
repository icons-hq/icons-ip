'use server';
import { revalidatePath } from 'next/cache';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { unstable_rethrow } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { GOODS_RELATIONS_PATH, RELATION_SAVE_UNKNOWN, goodsRelationConflict, goodsRelationError, parseGoodsRelationInput, type GoodsRelation, type GoodsRelationCandidates } from '@/lib/admin/goods-relations';
import { loadGoodsRelation, searchGoodsForRelation } from '@/lib/admin/goods-relations.server';
import { isUuid } from '@/lib/uuid';

/**
 * 연관상품 저장. 실패하면 화면이 다음 행동을 고를 수 있게 까닭을 나눠 돌려준다.
 *   conflict — 다른 사람이 먼저 바꿨다. 화면이 [최신 내용 다시 열기]를 보인다(문구가 아니라 이 값으로 판단한다).
 *   retrySameOperation — 저장됐는지 모른다. 화면이 입력을 잠그고 같은 저장을 다시 보내게 한다.
 *   savedId — 저장은 됐지만 다시 읽지 못했다.
 */
export async function saveGoodsRelationAction(input: unknown): Promise<{ saved: GoodsRelation } | { error: string; savedId?: string; retrySameOperation?: boolean; conflict?: boolean }> {
  if (!await requireAdminActionAccess(GOODS_RELATIONS_PATH)) return { error: '관리자 권한이 필요합니다.' };
  const parsed = parseGoodsRelationInput(input);
  if (!parsed.ok) return { error: parsed.error };
  const suppliedOperation = (input as { operationId?: unknown }).operationId;
  if (suppliedOperation !== undefined && !isUuid(suppliedOperation)) return { error: '저장할 내용을 읽지 못했습니다. 화면을 새로고침한 뒤 다시 저장해 주세요.' };
  const operationId = typeof suppliedOperation === 'string' ? suppliedOperation : randomUUID();
  let savedId: string | undefined;
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_save_goods_relation_composition', {
      p_id: parsed.id, p_expected_revision: parsed.revision, p_operation_id: operationId, p_values: { ...parsed.values, visual: parsed.values.visual ?? null },
    });
    if (error) {
      if (goodsRelationConflict(error.message)) return { error: goodsRelationError(error.message), conflict: true };
      // 오류 코드가 없으면 저장 함수까지 닿았는지 알 수 없다(연결 끊김). 같은 저장을 다시 보내 결과를 확인하게 한다.
      return !error.code && suppliedOperation ? { error: RELATION_SAVE_UNKNOWN, retrySameOperation: true } : { error: goodsRelationError(error.message) };
    }
    savedId = parsed.id;
    revalidatePath(GOODS_RELATIONS_PATH); revalidateGoodsSurfaces();
    if (!data || data.id !== parsed.id || !Number.isSafeInteger(data.revision)) return { error: '저장됐는지 확인하지 못했습니다. [최신 내용 다시 열기]로 지금 저장된 내용을 확인해 주세요.', savedId };
    const saved = await loadGoodsRelation(parsed.id);
    if (!saved || saved.revision !== data.revision) return { error: '저장했습니다. 화면의 내용이 저장된 내용과 다를 수 있으니 [최신 내용 다시 열기]로 확인해 주세요.', savedId };
    return { saved };
  } catch (error) {
    unstable_rethrow(error);
    if (savedId) return { error: '저장한 뒤 내용을 다시 읽지 못했습니다. [최신 내용 다시 열기]로 지금 저장된 내용을 확인해 주세요.', savedId };
    return suppliedOperation ? { error: RELATION_SAVE_UNKNOWN, retrySameOperation: true }
      : { error: '저장됐는지 확인하지 못했습니다. 목록에서 저장됐는지 본 뒤, 없으면 다시 저장해 주세요.' };
  }
}
export async function findGoodsForRelationAction(query: string, page: number): Promise<{ data: GoodsRelationCandidates } | { error: string }> {
  if (!await requireAdminActionAccess(GOODS_RELATIONS_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 100000) return { error: '검색어는 100자까지 넣을 수 있습니다. 줄여서 다시 찾아 주세요.' };
  try { return { data: await searchGoodsForRelation(query.trim(), page) }; }
  catch (error) { unstable_rethrow(error); return { error: '상품 목록을 불러오지 못했습니다. 잠시 뒤 다시 검색해 주세요.' }; }
}
