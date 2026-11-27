'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { SHIPPING_COLLECT_INVALID_MESSAGE, SHIPPING_COLLECT_UNKNOWN_MESSAGE, parseShippingCollectDocument, parseShippingCollectReceipt, parseShippingCollectRequest, sameShippingCollectDocument, shippingCollectError,
  shippingCollectReceiptMatches, validShippingCollectContext, type ShippingCollectContext, type ShippingCollectDocument, type ShippingCollectReceipt,
  type ShippingCollectRequest, type ShippingCollectResult } from '@/lib/admin/shipping-collect-contract';
import { SAVE_CHECK_LABEL } from '@/lib/admin/goods-template-save';
/* 저장됐는지 모를 때 다시 누르라고 할 버튼. 화면(ShippingCollectContractPanel)의 버튼 이름과 같다. */
const CHECK_AGAIN = `잠시 뒤 [${SAVE_CHECK_LABEL}]을 다시 눌러 주세요.`;
const denied = (): ShippingCollectResult<never> => ({ ok: false, error: '로그인이 끝났거나 착불 조건을 바꿀 권한이 없습니다. 최고 관리자 계정으로 다시 로그인한 뒤 이 화면을 열어 주세요.' });
async function authorize(context: ShippingCollectContext) {
  const auth = await requireAdminActionAccess('/admin/settings/origins', { capability: 'platform.manage', adminOnly: true });
  return auth && auth.user.id === context.expectedActorId.toLowerCase();
}
export async function readShippingCollectContractAction(context: ShippingCollectContext): Promise<ShippingCollectResult<ShippingCollectDocument>> {
  if (!validShippingCollectContext(context)) return { ok: false, error: '출고지를 찾지 못했습니다. 화면을 새로고침한 뒤 출고지를 다시 골라 주세요.' };
  if (!await authorize(context)) return denied();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_get_shipping_collect_contract', { p_origin_id: context.originId });
    const document = error ? null : parseShippingCollectDocument(data);
    return document?.originId === context.originId ? { ok: true, value: document } : { ok: false, error: '착불 조건을 불러오지 못했습니다. 잠시 뒤 다시 불러와 주세요.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '착불 조건을 불러오지 못했습니다. 잠시 뒤 다시 불러와 주세요.' }; }
}
export async function readShippingCollectOperationAction(context: ShippingCollectContext & { operationId: string }): Promise<ShippingCollectResult<{ receipt: ShippingCollectReceipt | null; latest: ShippingCollectDocument | null }>> {
  if (!validShippingCollectContext(context) || typeof context.operationId !== 'string' || !isUuid(context.operationId)) return { ok: false, error: `앞서 누른 저장을 찾을 수 없습니다. 화면을 새로고침한 뒤 [${SAVE_CHECK_LABEL}]을 다시 눌러 주세요.` };
  if (!await authorize(context)) return denied();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_get_shipping_collect_operation', { p_operation_id: context.operationId, p_expected_actor_id: context.expectedActorId });
    if (error) return { ok: false, error: `저장됐는지 확인하지 못했습니다. ${CHECK_AGAIN}` };
    const receipt = data === null ? null : parseShippingCollectReceipt(data);
    if (data !== null && (!receipt || receipt.originId !== context.originId || receipt.operationId !== context.operationId)) return { ok: false, error: `불러온 내용이 앞서 누른 저장과 맞지 않습니다. ${CHECK_AGAIN}` };
    const latest = await readShippingCollectContractAction(context);
    return { ok: true, value: { receipt, latest: latest.ok ? latest.value : null } };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: `저장됐는지 확인하지 못했습니다. 적은 내용은 그대로 두고 ${CHECK_AGAIN}` }; }
}
export async function saveShippingCollectContractAction(raw: ShippingCollectRequest): Promise<ShippingCollectResult<ShippingCollectDocument>> {
  const request = parseShippingCollectRequest(raw); if (!request) return { ok: false, error: `${SHIPPING_COLLECT_INVALID_MESSAGE} '사용'으로 저장하려면 네 칸을 모두 적어 주세요.` };
  if (!await authorize(request)) return denied();
  let response;
  try {
    const client = await createClient(); response = await client.rpc('admin_save_shipping_collect_contract', { p_origin_id: request.originId, p_expected_revision: request.expectedRevision,
      p_status: request.status, p_values: request.values, p_operation_id: request.operationId, p_expected_actor_id: request.expectedActorId });
  } catch (error) { unstable_rethrow(error); return { ok: false, uncertain: true, error: SHIPPING_COLLECT_UNKNOWN_MESSAGE }; }
  if (response.error) {
    const { code, message } = response.error, rejected = ['22023', '42501', '28000', '23514', '23503', 'P0002', 'PT409', '23505'].includes(code ?? '');
    return { ok: false, uncertain: !rejected, conflict: code === 'PT409' || code === '23505', error: rejected ? shippingCollectError(message) : SHIPPING_COLLECT_UNKNOWN_MESSAGE };
  }
  const receipt = parseShippingCollectReceipt(response.data);
  if (!receipt || !shippingCollectReceiptMatches(receipt, request)) return { ok: false, uncertain: true, error: SHIPPING_COLLECT_UNKNOWN_MESSAGE };
  const latest = await readShippingCollectContractAction(request);
  try { revalidatePath('/admin/settings/origins'); revalidateGoodsSurfaces(); } catch (error) { unstable_rethrow(error); }
  if (!latest.ok || !sameShippingCollectDocument(latest.value, receipt)) return { ok: false, committed: receipt,
    ...(latest.ok ? { latest: latest.value, conflict: true } : {}), error: '저장했습니다. 다만 그 뒤에 다른 사람이 다시 바꿨거나 저장된 내용을 불러오지 못했습니다. [지금 저장된 내용 보기]로 확인해 주세요.' };
  return latest;
}
