'use server';

import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { parseGoodsTransactionAdminReceipt, parseGoodsTransactionAdminTerms, type GoodsTransactionAdminTerms } from '@/lib/goods-transaction';
import { goodsTermsError, goodsTermsReceiptMatches, parseGoodsTermsRequest, sameGoodsTerms, validGoodsTermsContext,
  type GoodsTermsContext, type GoodsTermsRequest, type GoodsTermsResult } from '@/lib/admin/goods-transaction-terms';

const denied = (): GoodsTermsResult<never> => ({ ok: false, error: '로그인 상태나 상품관리 권한이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.' });
async function authorize(context: GoodsTermsContext) {
  const auth = await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' });
  return auth && auth.user.id === context.expectedActorId.toLowerCase();
}
export async function readGoodsTransactionTermsAction(context: GoodsTermsContext): Promise<GoodsTermsResult<GoodsTransactionAdminTerms>> {
  if (!validGoodsTermsContext(context)) return { ok: false, error: '상품을 다시 선택해주세요.' };
  if (!await authorize(context)) return denied();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_get_good_transaction_terms', { p_good_id: context.goodId });
    const terms = error ? null : parseGoodsTransactionAdminTerms(data);
    return terms?.goodId === context.goodId ? { ok: true, value: terms } : { ok: false, error: '저장된 할인·배송 설정을 확인하지 못했습니다. 다시 불러와주세요.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '할인·배송 설정을 불러오지 못했습니다. 현재 입력은 유지됩니다.' }; }
}
export async function saveGoodsTransactionTermsAction(raw: GoodsTermsRequest): Promise<GoodsTermsResult<GoodsTransactionAdminTerms>> {
  const request = parseGoodsTermsRequest(raw);
  if (!request) return { ok: false, error: '상품·저장 기준과 할인·배송 입력을 확인해주세요.' };
  if (!await authorize(request)) return denied();
  let response;
  try {
    const client = await createClient();
    response = await client.rpc('admin_save_good_transaction_terms', {
      p_good_id: request.goodId, p_expected_actor_id: request.expectedActorId, p_expected_revision: request.expectedRevision,
      p_expected_good_updated_at: request.expectedGoodUpdatedAt, p_volume: request.volume, p_delivery: request.delivery, p_operation_id: request.operationId,
    });
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, uncertain: true, error: '저장 결과가 불명확합니다. 입력을 바꾸지 말고 같은 요청으로 결과를 확인해주세요.' };
  }
  if (response.error) {
    const { code, message } = response.error;
    const rejected = ['22023', '42501', '28000', '23514', '23503', 'P0002', 'PT409', '23505'].includes(code ?? '');
    return { ok: false, uncertain: !rejected, conflict: code === 'PT409' || code === '23505', error: rejected ? goodsTermsError(message)
      : '저장 결과가 불명확합니다. 같은 요청으로 다시 확인해주세요.' };
  }
  const receipt = parseGoodsTransactionAdminReceipt(response.data);
  if (!receipt || !goodsTermsReceiptMatches(receipt, request)) return { ok: false, uncertain: true, error: '저장 응답을 대조하지 못했습니다. 같은 요청으로 다시 확인해주세요.' };
  // Read again under a fresh authorization check. A newer revision is a real
  // conflict after a successful commit, never proof that the mutation failed.
  const latest = await readGoodsTransactionTermsAction(request);
  const saved: GoodsTransactionAdminTerms = { goodId: receipt.goodId, goodUpdatedAt: receipt.goodUpdatedAt, revision: receipt.revision, volume: receipt.volume, delivery: receipt.delivery };
  try { revalidateGoodsSurfaces(); } catch (error) { unstable_rethrow(error); /* Commit/readback is the result, cache invalidation is recoverable. */ }
  if (!latest.ok || !sameGoodsTerms(latest.value, saved)) return { ok: false, committed: receipt, ...(latest.ok ? { latest: latest.value, conflict: true } : {}),
    error: latest.ok ? '요청은 저장됐고 이후 변경도 있습니다. 입력과 최신 저장본을 비교해주세요.' : '저장은 처리됐지만 최신 상태를 읽지 못했습니다. 입력을 유지하고 최신 저장본을 확인해주세요.' };
  return latest;
}
