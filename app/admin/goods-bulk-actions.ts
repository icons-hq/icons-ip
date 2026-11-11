'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { isUuid } from '@/lib/uuid';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { parseGoodsGroupIdentity, type GoodsGroupIdentity, type GoodsGroupResult } from '@/lib/admin/goods-groups';
import { goodsBulkError, parseGoodsBulkPreview, parseGoodsBulkReceipt, parseGoodsBulkRequest, type GoodsBulkPreview, type GoodsBulkReceipt } from '@/lib/admin/goods-bulk';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';
import { RANDOM_OPTION_PROBLEMS, goodsOptionSaleModeErrorMessage } from '@/lib/goods-option-sale-mode';

async function access(value: unknown) {
  const identity = transactionRecord(value) && transactionExactKeys(value, ['actorId', 'sessionId']) ? parseGoodsGroupIdentity(value) : null;
  if (!identity) return null;
  const auth = await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' });
  return auth?.user.id === identity.actorId ? identity : null;
}
const args = (id: string, identity: GoodsGroupIdentity) => ({ p_id: id, p_actor: identity.actorId, p_session: identity.sessionId });
function failure(message: string, code?: string, uncertain = false) {
  /* D5② 랜덤 판매 상품의 조건을 깨는 변경은 커밋에서 random_option_*로 거절된다(일괄 변경·목록 바로 수정 공통). */
  const randomOption = RANDOM_OPTION_PROBLEMS.some((problem) => message.includes(problem));
  const error = randomOption ? goodsOptionSaleModeErrorMessage(message) : goodsBulkError(message);
  /* 커밋 시점 지연 제약 거절은 트랜잭션 전체(영수증 포함)가 롤백된 확정 실패라 '결과 조회'로 보내지 않는다. */
  return { error, authChanged: code === '42501', uncertain: uncertain && !randomOption };
}
function refresh() {
  try { revalidateGoodsSurfaces(); revalidatePath('/admin/catalog/groups'); }
  catch (error) { unstable_rethrow(error); /* A stored receipt is authoritative even if cache invalidation fails. */ }
}
export async function previewGoodsBulkAction(id: unknown, input: unknown, rawIdentity: unknown): Promise<GoodsGroupResult<GoodsBulkPreview>> {
  const request = parseGoodsBulkRequest(input);
  if (!isUuid(id) || !request) return { error: '변경 대상·금액·기간을 확인해주세요.' };
  const identity = await access(rawIdentity); if (!identity) return failure('operator_capability_required', '42501');
  try {
    const { data, error } = await (await createClient()).rpc('admin_preview_goods_bulk', { ...args(id, identity), p_request: request });
    if (error) return failure(error.message, error.code);
    const preview = parseGoodsBulkPreview(data, id, request);
    return preview ? { value: preview } : { error: '현재 선택과 비교 결과가 일치하지 않습니다. 다시 확인해주세요.' };
  } catch (error) { unstable_rethrow(error); return { error: '변경 내용을 불러오지 못했습니다. 입력을 확인하고 다시 시도해주세요.' }; }
}
async function receipt(id: unknown, rawIdentity: unknown, mode: 'commit' | 'read', seal = false): Promise<GoodsGroupResult<GoodsBulkReceipt>> {
  if (!isUuid(id) || typeof seal !== 'boolean') return { error: '요청번호를 확인하지 못했습니다.', uncertain: true };
  const identity = await access(rawIdentity); if (!identity) return failure('operator_capability_required', '42501', true);
  try {
    const { data, error } = await (await createClient()).rpc(mode === 'commit' ? 'admin_commit_goods_bulk' : 'admin_read_goods_bulk', { ...args(id, identity), ...(mode === 'read' ? { p_seal: seal } : {}) });
    if (error) return failure(error.message, error.code, true);
    const result = parseGoodsBulkReceipt(data, id);
    if (!result) return { error: '처리 결과를 확인하지 못했습니다. 같은 요청의 결과를 조회해주세요.', uncertain: true };
    if (result.state === 'completed') refresh();
    return { value: result };
  } catch (error) { unstable_rethrow(error); return { error: '처리 결과가 불명확합니다. 같은 요청의 결과를 조회해주세요.', uncertain: true }; }
}
export async function commitGoodsBulkAction(id: unknown, identity: unknown) { return receipt(id, identity, 'commit'); }
export async function readGoodsBulkAction(id: unknown, identity: unknown, seal = false) { return receipt(id, identity, 'read', seal); }
