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
const denied = (): ShippingCollectResult<never> => ({ ok: false, error: '로그인이 끝났거나 착불 운영 조건을 바꿀 권한이 없습니다. 최고 관리자 계정으로 다시 로그인해 이 화면을 열어주세요.' });
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
    return document?.originId === context.originId ? { ok: true, value: document } : { ok: false, error: '착불 운영 조건을 불러오지 못했습니다. 잠시 뒤 [착불 운영 조건 다시 읽기]를 눌러주세요.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '착불 운영 조건을 불러오지 못했습니다. 현재 입력은 유지됩니다.' }; }
}
export async function readShippingCollectOperationAction(context: ShippingCollectContext & { operationId: string }): Promise<ShippingCollectResult<{ receipt: ShippingCollectReceipt | null; latest: ShippingCollectDocument | null }>> {
  if (!validShippingCollectContext(context) || typeof context.operationId !== 'string' || !isUuid(context.operationId)) return { ok: false, error: '확인할 저장 요청 정보가 맞지 않습니다. 화면을 새로고침한 뒤 다시 확인해주세요.' };
  if (!await authorize(context)) return denied();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_get_shipping_collect_operation', { p_operation_id: context.operationId, p_expected_actor_id: context.expectedActorId });
    if (error) return { ok: false, error: '이전 저장 결과를 불러오지 못했습니다. 잠시 뒤 [이전 저장 결과 확인]을 다시 눌러주세요.' };
    const receipt = data === null ? null : parseShippingCollectReceipt(data);
    if (data !== null && (!receipt || receipt.originId !== context.originId || receipt.operationId !== context.operationId)) return { ok: false, error: '불러온 저장 결과가 이 요청과 맞지 않습니다. 잠시 뒤 [이전 저장 결과 확인]을 다시 눌러주세요.' };
    const latest = await readShippingCollectContractAction(context);
    return { ok: true, value: { receipt, latest: latest.ok ? latest.value : null } };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '이전 저장 결과를 확인하지 못했습니다. 입력을 바꾸지 말고 잠시 뒤 [이전 저장 결과 확인]을 다시 눌러주세요.' }; }
}
export async function saveShippingCollectContractAction(raw: ShippingCollectRequest): Promise<ShippingCollectResult<ShippingCollectDocument>> {
  const request = parseShippingCollectRequest(raw); if (!request) return { ok: false, error: '칸 앞뒤의 공백과 줄바꿈을 지우고 글자 수를 확인해주세요. "실제 운영 근거 확인 · 사용"으로 저장하려면 모든 칸을 채워야 합니다.' };
  if (!await authorize(request)) return denied();
  let response;
  try {
    const client = await createClient(); response = await client.rpc('admin_save_shipping_collect_contract', { p_origin_id: request.originId, p_expected_revision: request.expectedRevision,
      p_status: request.status, p_values: request.values, p_operation_id: request.operationId, p_expected_actor_id: request.expectedActorId });
  } catch (error) { unstable_rethrow(error); return { ok: false, uncertain: true, error: '저장됐는지 확인하지 못했습니다. [이전 저장 결과 확인]을 눌러 결과를 먼저 확인해주세요.' }; }
  if (response.error) {
    const { code, message } = response.error, rejected = ['22023', '42501', '28000', '23514', '23503', 'P0002', 'PT409', '23505'].includes(code ?? '');
    return { ok: false, uncertain: !rejected, conflict: code === 'PT409' || code === '23505', error: rejected ? shippingCollectError(message) : '저장됐는지 확인하지 못했습니다. [이전 저장 결과 확인]을 눌러 결과를 먼저 확인해주세요.' };
  }
  const receipt = parseShippingCollectReceipt(response.data);
  if (!receipt || !shippingCollectReceiptMatches(receipt, request)) return { ok: false, uncertain: true, error: '저장됐는지 확인하지 못했습니다. [이전 저장 결과 확인]을 눌러 결과를 먼저 확인해주세요.' };
  const latest = await readShippingCollectContractAction(request);
  try { revalidatePath('/admin/settings/origins'); revalidateGoodsSurfaces(); } catch (error) { unstable_rethrow(error); }
  if (!latest.ok || !sameShippingCollectDocument(latest.value, receipt)) return { ok: false, committed: receipt,
    ...(latest.ok ? { latest: latest.value, conflict: true } : {}), error: '저장은 됐지만 그 뒤 내용이 바뀌었거나 다시 불러오지 못했습니다. [입력과 최신 저장본 비교]에서 확인해주세요.' };
  return latest;
}
