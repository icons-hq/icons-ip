'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { isUuid } from '@/lib/uuid';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { parseGoodsGroupIdentity, type GoodsGroupResult } from '@/lib/admin/goods-groups';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';
import { RANDOM_OPTION_PROBLEMS } from '@/lib/goods-option-sale-mode';
import { goodsOptionSaleModeErrorMessage } from '@/lib/admin/goods-option-sale-mode-messages';
import {
  DISCOUNT_PROMOTIONS_PATH,
  discountPromotionError,
  parseDiscountPromotionPreview,
  parseDiscountPromotionReceipt,
  parseDiscountPromotionRequest,
  parseDiscountPromotionStopReceipt,
  type DiscountPromotionPreview,
  type DiscountPromotionReceipt,
  type DiscountPromotionStopReceipt,
} from '@/lib/admin/discount-promotions';

/* 일괄 변경(goods-bulk-actions)과 같은 계약: 로그인 계정·세션을 결속하고, 불명확한 응답은 같은 요청번호의 결과 조회로만 확인한다. */
async function access(value: unknown) {
  const identity = transactionRecord(value) && transactionExactKeys(value, ['actorId', 'sessionId']) ? parseGoodsGroupIdentity(value) : null;
  if (!identity) return null;
  const auth = await requireAdminActionAccess(DISCOUNT_PROMOTIONS_PATH, { capability: 'catalog.manage' });
  return auth?.user.id === identity.actorId ? identity : null;
}
function failure(message: string, code?: string, uncertain = false) {
  /* 랜덤 판매 상품의 조건을 깨는 기간 할인은 커밋에서 random_option_*로 거절된다(트랜잭션 전체가 되돌아간 확정 실패). */
  const randomOption = RANDOM_OPTION_PROBLEMS.some(problem => message.includes(problem));
  return { error: randomOption ? goodsOptionSaleModeErrorMessage(message) : discountPromotionError(message), authChanged: code === '42501', uncertain: uncertain && !randomOption };
}
function refresh() {
  try { revalidateGoodsSurfaces(); revalidatePath(DISCOUNT_PROMOTIONS_PATH, 'layout'); }
  catch (error) { unstable_rethrow(error); /* 저장된 영수증이 진실원이다. 캐시 무효화 실패는 결과를 바꾸지 않는다. */ }
}

export async function previewDiscountPromotionAction(id: unknown, input: unknown, rawIdentity: unknown): Promise<GoodsGroupResult<DiscountPromotionPreview>> {
  const request = parseDiscountPromotionRequest(input);
  if (!isUuid(id) || !request) return { error: '프로모션 이름·기간·대상·할인 값을 확인해주세요.' };
  const identity = await access(rawIdentity); if (!identity) return failure('operator_capability_required', '42501');
  try {
    const { data, error } = await (await createClient()).rpc('admin_preview_discount_promotion', { p_id: id, p_request: request, p_actor: identity.actorId, p_session: identity.sessionId });
    if (error) return failure(error.message, error.code);
    const preview = parseDiscountPromotionPreview(data, id, request);
    return preview ? { value: preview } : { error: '입력과 비교 결과가 일치하지 않습니다. 다시 확인해주세요.' };
  } catch (error) { unstable_rethrow(error); return { error: '대상 상품을 불러오지 못했습니다. 입력을 확인하고 다시 시도해주세요.' }; }
}

async function receipt(id: unknown, rawIdentity: unknown, mode: 'commit' | 'read', seal = false): Promise<GoodsGroupResult<DiscountPromotionReceipt>> {
  if (!isUuid(id) || typeof seal !== 'boolean') return { error: '요청번호를 확인하지 못했습니다.', uncertain: true };
  const identity = await access(rawIdentity); if (!identity) return failure('operator_capability_required', '42501', true);
  try {
    const args = { p_id: id, p_actor: identity.actorId, p_session: identity.sessionId };
    const { data, error } = await (await createClient()).rpc(mode === 'commit' ? 'admin_commit_discount_promotion' : 'admin_read_discount_promotion_operation',
      mode === 'read' ? { ...args, p_seal: seal } : args);
    if (error) return failure(error.message, error.code, true);
    const result = parseDiscountPromotionReceipt(data, id);
    if (!result) return { error: '처리 결과를 확인하지 못했습니다. 같은 요청의 결과를 조회해주세요.', uncertain: true };
    if (result.state === 'completed') refresh();
    return { value: result };
  } catch (error) { unstable_rethrow(error); return { error: '처리 결과가 불명확합니다. 같은 요청의 결과를 조회해주세요.', uncertain: true }; }
}
export async function commitDiscountPromotionAction(id: unknown, identity: unknown) { return receipt(id, identity, 'commit'); }
export async function readDiscountPromotionAction(id: unknown, identity: unknown, seal = false) { return receipt(id, identity, 'read', seal); }

/** 같은 요청번호로 다시 부르면 저장된 중지 영수증을 돌려준다(응답이 끊겨도 같은 번호로 다시 누르면 된다). */
export async function stopDiscountPromotionAction(promotionId: unknown, operationId: unknown, rawIdentity: unknown): Promise<GoodsGroupResult<DiscountPromotionStopReceipt>> {
  if (!isUuid(promotionId) || !isUuid(operationId)) return { error: '중지할 프로모션을 확인하지 못했습니다.' };
  const identity = await access(rawIdentity); if (!identity) return failure('operator_capability_required', '42501');
  try {
    const { data, error } = await (await createClient()).rpc('admin_stop_discount_promotion', {
      p_promotion_id: promotionId, p_operation_id: operationId, p_actor: identity.actorId, p_session: identity.sessionId,
    });
    if (error) return failure(error.message, error.code, true);
    const result = parseDiscountPromotionStopReceipt(data, { promotionId, operationId });
    if (!result) return { error: '중지 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
    refresh();
    return { value: result };
  } catch (error) { unstable_rethrow(error); return { error: '중지 결과가 불명확합니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
}
