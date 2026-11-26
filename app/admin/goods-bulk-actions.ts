'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { isUuid } from '@/lib/uuid';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { parseGoodsGroupIdentity, type GoodsGroupIdentity, type GoodsGroupResult } from '@/lib/admin/goods-groups';
import { GOODS_BULK_UNCERTAIN, goodsBulkError, parseGoodsBulkPreview, parseGoodsBulkReceipt, parseGoodsBulkRequest, type GoodsBulkCommand, type GoodsBulkPreview, type GoodsBulkReceipt } from '@/lib/admin/goods-bulk';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';
import { RANDOM_OPTION_PROBLEMS } from '@/lib/goods-option-sale-mode';
import { goodsOptionSaleModeErrorMessage } from '@/lib/admin/goods-option-sale-mode-messages';

async function access(value: unknown) {
  const identity = transactionRecord(value) && transactionExactKeys(value, ['actorId', 'sessionId']) ? parseGoodsGroupIdentity(value) : null;
  if (!identity) return null;
  const auth = await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' });
  return auth?.user.id === identity.actorId ? identity : null;
}
const args = (id: string, identity: GoodsGroupIdentity) => ({ p_id: id, p_actor: identity.actorId, p_session: identity.sessionId });
/** `command`: 미리보기는 어떤 명령인지 안다 — 바꿀 수 있는 상품이 없을 때 그 명령의 이유로 말한다(기간 할인 걸기·중지). */
function failure(message: string, code?: string, uncertain = false, command?: GoodsBulkCommand) {
  /* D5② 랜덤 판매 상품의 조건을 깨는 변경은 커밋에서 random_option_*로 거절된다(일괄 변경·목록 바로 수정 공통). */
  const randomOption = RANDOM_OPTION_PROBLEMS.some((problem) => message.includes(problem));
  const error = randomOption ? goodsOptionSaleModeErrorMessage(message) : goodsBulkError(message, command);
  /* 커밋 시점 지연 제약 거절은 트랜잭션 전체(영수증 포함)가 롤백된 확정 실패라 '저장됐는지 확인'으로 보내지 않는다. */
  return { error, authChanged: code === '42501', uncertain: uncertain && !randomOption };
}
function refresh() {
  try { revalidateGoodsSurfaces(); revalidatePath('/admin/catalog/groups'); }
  catch (error) { unstable_rethrow(error); /* A stored receipt is authoritative even if cache invalidation fails. */ }
}
export async function previewGoodsBulkAction(id: unknown, input: unknown, rawIdentity: unknown): Promise<GoodsGroupResult<GoodsBulkPreview>> {
  const request = parseGoodsBulkRequest(input);
  if (!isUuid(id) || !request) return { error: '바꿀 내용의 형식이 맞지 않습니다. 새로고침한 뒤 상품을 다시 골라주세요.' };
  const identity = await access(rawIdentity); if (!identity) return failure('operator_capability_required', '42501');
  try {
    const { data, error } = await (await createClient()).rpc('admin_preview_goods_bulk', { ...args(id, identity), p_request: request });
    if (error) return failure(error.message, error.code, false, request.command);
    const preview = parseGoodsBulkPreview(data, id, request);
    return preview ? { value: preview } : { error: '받은 변경 내용이 고른 상품과 맞지 않습니다. 새로고침한 뒤 다시 해주세요.' };
  } catch (error) { unstable_rethrow(error); return { error: '변경 내용을 불러오지 못했습니다. 잠시 뒤 다시 해주세요.' }; }
}
async function receipt(id: unknown, rawIdentity: unknown, mode: 'commit' | 'read', seal = false): Promise<GoodsGroupResult<GoodsBulkReceipt>> {
  if (!isUuid(id) || typeof seal !== 'boolean') return { error: '저장할 변경을 찾지 못했습니다. 새로고침한 뒤 처음부터 다시 해주세요.', uncertain: true };
  const identity = await access(rawIdentity); if (!identity) return failure('operator_capability_required', '42501', true);
  try {
    const { data, error } = await (await createClient()).rpc(mode === 'commit' ? 'admin_commit_goods_bulk' : 'admin_read_goods_bulk', { ...args(id, identity), ...(mode === 'read' ? { p_seal: seal } : {}) });
    if (error) return failure(error.message, error.code, true);
    const result = parseGoodsBulkReceipt(data, id);
    if (!result) return { error: GOODS_BULK_UNCERTAIN, uncertain: true };
    if (result.state === 'completed') refresh();
    return { value: result };
  } catch (error) { unstable_rethrow(error); return { error: GOODS_BULK_UNCERTAIN, uncertain: true }; }
}
export async function commitGoodsBulkAction(id: unknown, identity: unknown) { return receipt(id, identity, 'commit'); }
export async function readGoodsBulkAction(id: unknown, identity: unknown, seal = false) { return receipt(id, identity, 'read', seal); }
