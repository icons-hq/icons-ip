'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { parseShippingCollectDocument, parseShippingCollectReceipt, parseShippingCollectRequest, sameShippingCollectDocument, shippingCollectError,
  shippingCollectReceiptMatches, validShippingCollectContext, type ShippingCollectContext, type ShippingCollectDocument, type ShippingCollectReceipt,
  type ShippingCollectRequest, type ShippingCollectResult } from '@/lib/admin/shipping-collect-contract';
const denied = (): ShippingCollectResult<never> => ({ ok: false, error: '로그인 상태 또는 운영 설정 권한이 바뀌었습니다. 현재 계정으로 다시 열어주세요.' });
async function authorize(context: ShippingCollectContext) {
  const auth = await requireAdminActionAccess('/admin/settings/origins', { capability: 'platform.manage', adminOnly: true });
  return auth && auth.user.id === context.expectedActorId.toLowerCase();
}
export async function readShippingCollectContractAction(context: ShippingCollectContext): Promise<ShippingCollectResult<ShippingCollectDocument>> {
  if (!validShippingCollectContext(context)) return { ok: false, error: '출고지를 다시 선택해주세요.' };
  if (!await authorize(context)) return denied();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_get_shipping_collect_contract', { p_origin_id: context.originId });
    const document = error ? null : parseShippingCollectDocument(data);
    return document?.originId === context.originId ? { ok: true, value: document } : { ok: false, error: '착불 운영 조건을 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '착불 운영 조건을 불러오지 못했습니다. 현재 입력은 유지됩니다.' }; }
}
export async function readShippingCollectOperationAction(context: ShippingCollectContext & { operationId: string }): Promise<ShippingCollectResult<{ receipt: ShippingCollectReceipt | null; latest: ShippingCollectDocument | null }>> {
  if (!validShippingCollectContext(context) || typeof context.operationId !== 'string' || !isUuid(context.operationId)) return { ok: false, error: '저장 결과를 확인할 요청이 올바르지 않습니다.' };
  if (!await authorize(context)) return denied();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_get_shipping_collect_operation', { p_operation_id: context.operationId, p_expected_actor_id: context.expectedActorId });
    if (error) return { ok: false, error: '이전 요청 결과를 확인하지 못했습니다. 다시 확인해주세요.' };
    const receipt = data === null ? null : parseShippingCollectReceipt(data);
    if (data !== null && (!receipt || receipt.originId !== context.originId || receipt.operationId !== context.operationId)) return { ok: false, error: '이전 요청 응답을 대조하지 못했습니다. 다시 확인해주세요.' };
    const latest = await readShippingCollectContractAction(context);
    return { ok: true, value: { receipt, latest: latest.ok ? latest.value : null } };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '이전 저장 결과를 확인하지 못했습니다. 입력을 바꾸지 말고 다시 확인해주세요.' }; }
}
export async function saveShippingCollectContractAction(raw: ShippingCollectRequest): Promise<ShippingCollectResult<ShippingCollectDocument>> {
  const request = parseShippingCollectRequest(raw); if (!request) return { ok: false, error: '착불 운영 조건과 저장 기준을 확인해주세요.' };
  if (!await authorize(request)) return denied();
  let response;
  try {
    const client = await createClient(); response = await client.rpc('admin_save_shipping_collect_contract', { p_origin_id: request.originId, p_expected_revision: request.expectedRevision,
      p_status: request.status, p_values: request.values, p_operation_id: request.operationId, p_expected_actor_id: request.expectedActorId });
  } catch (error) { unstable_rethrow(error); return { ok: false, uncertain: true, error: '저장 결과가 불명확합니다. 같은 요청으로 결과를 확인해주세요.' }; }
  if (response.error) {
    const { code, message } = response.error, rejected = ['22023', '42501', '28000', '23514', '23503', 'P0002', 'PT409', '23505'].includes(code ?? '');
    return { ok: false, uncertain: !rejected, conflict: code === 'PT409' || code === '23505', error: rejected ? shippingCollectError(message) : '저장 결과가 불명확합니다. 같은 요청으로 확인해주세요.' };
  }
  const receipt = parseShippingCollectReceipt(response.data);
  if (!receipt || !shippingCollectReceiptMatches(receipt, request)) return { ok: false, uncertain: true, error: '저장 응답을 대조하지 못했습니다. 같은 요청으로 다시 확인해주세요.' };
  const latest = await readShippingCollectContractAction(request);
  try { revalidatePath('/admin/settings/origins'); revalidateGoodsSurfaces(); } catch (error) { unstable_rethrow(error); }
  if (!latest.ok || !sameShippingCollectDocument(latest.value, receipt)) return { ok: false, committed: receipt,
    ...(latest.ok ? { latest: latest.value, conflict: true } : {}), error: '요청 저장은 확인됐습니다. 현재 입력과 최신 저장본을 비교해주세요.' };
  return latest;
}
