'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { parseShippingCollectEventReceipt, parseShippingCollectEventRequest, parseShippingCollectObligations, shippingCollectEventError,
  shippingCollectEventReceiptMatches, validShippingCollectEventContext, type ShippingCollectEventContext, type ShippingCollectEventReceipt,
  type ShippingCollectEventRequest, type ShippingCollectEventResult, type ShippingCollectObligation } from '@/lib/admin/shipping-collect-events';
async function authorize(context: ShippingCollectEventContext, write = false) {
  const auth = await requireAdminActionAccess(`/admin/sales/orders/${context.orderId}`, { capability: write ? 'sales.manage' : 'sales.read' });
  return auth?.user.id === context.expectedActorId;
}
const denied = (): ShippingCollectEventResult<never> => ({ ok: false, error: '계정 또는 주문 처리 권한이 바뀌었습니다. 현재 계정으로 다시 열어주세요.' });
export async function readShippingCollectEventsAction(context: ShippingCollectEventContext): Promise<ShippingCollectEventResult<ShippingCollectObligation[]>> {
  if (!validShippingCollectEventContext(context)) return { ok: false, error: '주문과 현재 계정을 다시 확인해주세요.' };
  if (!await authorize(context)) return denied();
  try {
    const { data, error } = await (await createClient()).rpc('admin_get_order_shipping_collect', { p_order_id: context.orderId });
    const rows = error ? null : parseShippingCollectObligations(data, context.orderId);
    return rows ? { ok: true, value: rows } : { ok: false, error: '착불 수납 내역을 확인하지 못했습니다. 다시 불러와주세요.' };
  } catch (error) { unstable_rethrow(error);return { ok: false, error: '착불 수납 내역을 확인하지 못했습니다. 다시 불러와주세요.' }; }
}
export async function readShippingCollectEventOperationAction(context: ShippingCollectEventContext & { operationId: string }): Promise<ShippingCollectEventResult<ShippingCollectEventReceipt | null>> {
  if (!validShippingCollectEventContext(context) || typeof context.operationId !== 'string' || !isUuid(context.operationId)) return { ok: false, error: '확인할 요청 정보가 올바르지 않습니다.' };
  if (!await authorize(context, true)) return denied();
  try {
    const { data, error } = await (await createClient()).rpc('admin_get_shipping_collect_event_operation', { p_operation_id: context.operationId, p_expected_actor_id: context.expectedActorId });
    if (error) return { ok: false, error: '이전 저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.' };
    const receipt = data === null ? null : parseShippingCollectEventReceipt(data);
    return data === null || (receipt?.operationId === context.operationId && receipt.obligation.orderId === context.orderId)
      ? { ok: true, value: receipt } : { ok: false, error: '이전 저장 결과를 대조하지 못했습니다.' };
  } catch (error) { unstable_rethrow(error);return { ok: false, error: '이전 저장 결과를 확인하지 못했습니다.' }; }
}
export async function saveShippingCollectEventAction(value: ShippingCollectEventRequest): Promise<ShippingCollectEventResult<ShippingCollectEventReceipt>> {
  const request = parseShippingCollectEventRequest(value);if (!request) return { ok: false, error: '실제 금액·시각·증빙을 입력해주세요.' };
  if (!await authorize(request, true)) return denied();
  let response;
  try {
    response = await (await createClient()).rpc('admin_record_shipping_collect_event', { p_order_id: request.orderId, p_shipment_id: request.shipmentId,
      p_expected_revision: request.expectedRevision, p_operation_id: request.operationId, p_event: request.event, p_amount: request.amount,
      p_occurred_at: request.occurredAt, p_party: request.party, p_reverses_operation_id: request.reversesOperationId, p_reference: request.reference, p_note: request.note, p_expected_actor_id: request.expectedActorId });
  } catch (error) { unstable_rethrow(error);return { ok: false, uncertain: true, error: '저장 결과가 불명확합니다. 입력을 유지한 채 결과를 먼저 확인해주세요.' }; }
  if (response.error) {
    const code = response.error.code ?? '';const rejected = ['22023', '42501', '28000', '23514', '23503', 'P0002', 'PT409', '23505'].includes(code);
    return { ok: false, uncertain: !rejected, conflict: code === 'PT409' || code === '23505', error: rejected ? shippingCollectEventError(response.error.message) : '저장 결과가 불명확합니다. 결과를 먼저 확인해주세요.' };
  }
  const receipt = parseShippingCollectEventReceipt(response.data);
  if (!receipt || !shippingCollectEventReceiptMatches(receipt, request)) return { ok: false, uncertain: true, error: '저장 응답을 대조하지 못했습니다. 같은 요청의 결과를 확인해주세요.' };
  try { revalidatePath(`/admin/sales/orders/${request.orderId}`); } catch (error) { unstable_rethrow(error); }
  return { ok: true, value: receipt };
}

export async function sealShippingCollectOperationAction(context: ShippingCollectEventContext & { shipmentId: string; operationId: string }): Promise<ShippingCollectEventResult<ShippingCollectEventReceipt | null>> {
  if (!validShippingCollectEventContext(context) || !isUuid(context.shipmentId) || !isUuid(context.operationId)) return { ok: false, error: '이전 요청 정보를 다시 확인해주세요.' };
  if (!await authorize(context, true)) return denied();
  try {
    const { data, error } = await (await createClient()).rpc('admin_seal_shipping_collect_operation', { p_order_id: context.orderId,
      p_shipment_id: context.shipmentId, p_operation_id: context.operationId, p_expected_actor_id: context.expectedActorId });
    if (error) return { ok: false, uncertain: true, error: '이전 요청의 봉인 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.' };
    if (data?.state === 'sealed' && Object.keys(data).sort().join(',') === 'operationId,orderId,shipmentId,state'
      && data.operationId === context.operationId && data.orderId === context.orderId && data.shipmentId === context.shipmentId) return { ok: true, value: null };
    const receipt = data?.state === 'recorded' && Object.keys(data).sort().join(',') === 'receipt,state' ? parseShippingCollectEventReceipt(data.receipt) : null;
    if (receipt?.operationId === context.operationId && receipt.obligation.orderId === context.orderId && receipt.obligation.shipmentId === context.shipmentId) return { ok: true, value: receipt };
    return { ok: false, uncertain: true, error: '이전 요청의 처리 결과를 대조하지 못했습니다.' };
  } catch (error) { unstable_rethrow(error);return { ok: false, uncertain: true, error: '이전 요청의 처리 결과를 확인하지 못했습니다.' }; }
}
