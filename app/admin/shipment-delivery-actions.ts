'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { adminOrderActionHref } from '@/lib/admin/orders';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { ADMIN_SALES_ACCESS_DENIED } from '@/lib/admin/vocabulary';
import {
  DELIVERY_POLICY_TEXT_FIELDS, deliveryIsHandoff, deliveryErrorMessage, deliveryObject, deliveryTimestamp, deliveryUuid,
  parseAdminDeliveryPolicies, parseAdminShipmentDelivery, parseDeliveryEvidence, parseDeliveryPolicyInput,
  type AdminDeliveryPolicy, type AdminShipmentDelivery,
} from '@/lib/shipment-delivery';

type Failure = { ok: false; error: string };
type Saved = { ok: true; message: string };
function nullableUuid(value: unknown): string | null | false { return value === '' || value == null ? null : deliveryUuid(value) ? value : false; }
function revision(value: unknown): number | null | false {
  if (value === '' || value == null) return null;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) return false;
  return Number(value);
}
function refreshDelivery() {
  for (const path of ['/admin/sales/orders', '/admin/sales/dispatch', '/admin/sales/shipping', '/orders']) revalidatePath(path);
  revalidatePath('/orders/[orderId]', 'page'); revalidatePath('/admin/sales/orders/[orderId]', 'page');
}
export async function readDeliveryPoliciesAction(originId: unknown): Promise<{ ok: true; policies: AdminDeliveryPolicy[] } | Failure> {
  if (!await requireAdminActionAccess('/admin/settings/origins', { capability: 'catalog.read' })) return { ok: false, error: '운영자만 운영 조건을 볼 수 있습니다. 로그인이 끝났으면 다시 로그인해주세요.' };
  if (!deliveryUuid(originId)) return { ok: false, error: '출고지를 다시 골라주세요.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_list_delivery_policies', { p_origin_id: originId });
    const policies = error ? null : parseAdminDeliveryPolicies(data);
    return policies ? { ok: true, policies } : { ok: false, error: '운영 조건을 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '운영 조건을 불러오지 못했습니다.' }; }
}
export async function saveDeliveryPolicyAction(form: FormData): Promise<Saved | Failure> {
  if (!await requireAdminActionAccess('/admin/settings/origins', { adminOnly: true, capability: 'platform.manage' })) return { ok: false, error: '운영 조건은 최고 관리자만 저장할 수 있습니다.' };
  const originId = form.get('originId'); const policyId = nullableUuid(form.get('policyId'));
  const expectedRevision = revision(form.get('revision')); const method = form.get('method');
  const delegate = form.get('allowDelegate');
  const input = parseDeliveryPolicyInput({ state: form.get('state'), allowDelegate: delegate === 'true' ? true : delegate === 'false' ? false : null,
    ...Object.fromEntries(DELIVERY_POLICY_TEXT_FIELDS.map((key) => [key, form.get(key)])) });
  if (!deliveryUuid(originId) || !['quick', 'pickup', 'direct', 'freight', 'none'].includes(String(method)) || policyId === false || expectedRevision === false
    || (policyId === null) !== (expectedRevision === null) || !input) return { ok: false, error: deliveryErrorMessage('delivery_policy_incomplete') };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_save_delivery_policy', {
      p_origin_id: originId, p_method: method, p_policy_id: policyId, p_expected_revision: expectedRevision, p_values: input,
    });
    if (error) return { ok: false, error: deliveryErrorMessage(error.message) };
    if (!deliveryObject(data) || !deliveryUuid(data.id) || typeof data.changed !== 'boolean') return { ok: false, error: deliveryErrorMessage() };
    revalidatePath('/admin/settings/origins');
    return { ok: true, message: input.state === 'active' ? '운영 조건을 사용으로 켰습니다.'
      : input.state === 'stopped' ? '운영 조건을 사용 안 함으로 바꿨습니다. 이미 이 방식으로 정해진 주문은 저장된 조건대로 인계합니다.' : '운영 조건을 준비 중으로 저장했습니다. 고객 주문에는 아직 쓰이지 않습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: deliveryErrorMessage() }; }
}
export async function readShipmentDeliveryAction(shipmentId: unknown, orderId?: string): Promise<{ ok: true; shipment: AdminShipmentDelivery } | Failure> {
  if (!await requireAdminActionAccess(adminOrderActionHref(orderId), { capability: 'sales.read' })) return { ok: false, error: '운영자만 배송 방식·인계 정보를 볼 수 있습니다. 로그인이 끝났으면 다시 로그인해주세요.' };
  if (!deliveryUuid(shipmentId)) return { ok: false, error: '배송 건을 다시 골라주세요.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_read_shipment_delivery', { p_shipment_id: shipmentId });
    const shipment = error ? null : parseAdminShipmentDelivery(data);
    return shipment ? { ok: true, shipment } : { ok: false, error: '배송 방식·인계 정보를 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '배송 방식·인계 정보를 불러오지 못했습니다.' }; }
}
export async function selectShipmentDeliveryMethodAction(form: FormData): Promise<Saved | Failure> {
  if (!await requireAdminActionAccess(adminOrderActionHref(form.get('orderId')), { capability: 'sales.manage' })) return { ok: false, error: ADMIN_SALES_ACCESS_DENIED };
  const shipmentId = form.get('shipmentId'); const operationId = form.get('operationId'); const method = form.get('method');
  const policyId = nullableUuid(form.get('policyId')); const updatedAt = form.get('updatedAt');
  const requestReference = String(form.get('customerRequestReference') ?? '').trim();
  const feeConsentReference = String(form.get('feeConsentReference') ?? '').trim();
  if (!deliveryUuid(shipmentId) || !deliveryUuid(operationId) || !deliveryTimestamp(updatedAt) || !['parcel', 'quick', 'pickup', 'direct', 'freight'].includes(String(method))
    || policyId === false || (method === 'parcel') !== (policyId === null) || !requestReference || requestReference.length > 2000
    || !feeConsentReference || feeConsentReference.length > 2000 || form.get('feeUnchanged') !== 'on') {
    return { ok: false, error: "바꿀 배송 방식을 고르고 '고객이 요청한 내용'과 '배송비 유지 동의 내용'을 적어주세요." };
  }
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_select_shipment_delivery_method', {
      p_shipment_id: shipmentId, p_method: method, p_policy_id: policyId, p_customer_request_reference: requestReference,
      p_fee_consent_reference: feeConsentReference, p_fee_unchanged: true, p_expected_updated_at: updatedAt, p_operation_id: operationId,
    });
    if (error) return { ok: false, error: deliveryErrorMessage(error.message) };
    if (!deliveryObject(data) || data.ok !== true) return { ok: false, error: deliveryErrorMessage() };
    refreshDelivery(); return { ok: true, message: data.replayed ? '이미 저장된 배송 방식 변경입니다.' : '배송 방식을 바꿨습니다. 고객이 요청한 내용과 배송비 유지 동의 내용은 이력에 남았습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: deliveryErrorMessage() }; }
}
export async function recordShipmentDeliveryAction(form: FormData): Promise<Saved | Failure> {
  if (!await requireAdminActionAccess(adminOrderActionHref(form.get('orderId')), { capability: 'sales.manage' })) return { ok: false, error: ADMIN_SALES_ACCESS_DENIED };
  const shipmentId = form.get('shipmentId'); const operationId = form.get('operationId'); const kind = form.get('kind'); const updatedAt = form.get('updatedAt');
  const keys = deliveryIsHandoff(kind) ? ['operatorName', 'providerName', 'providerPhone', 'handoffReference', 'occurredAt']
    : ['operatorName', 'receiptReference', 'recipientKind', 'occurredAt'];
  const evidence = parseDeliveryEvidence(kind, Object.fromEntries(keys.map((key) => [key, form.get(key)])));
  const receiptCode = String(form.get('receiptCode') ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!deliveryUuid(shipmentId) || !deliveryUuid(operationId) || !deliveryTimestamp(updatedAt) || !evidence
    || (!deliveryIsHandoff(kind) && !/^[0-9A-F]{12}$/.test(receiptCode)) || (deliveryIsHandoff(kind) && receiptCode !== '')) {
    return { ok: false, error: '담당자·시각·확인 내용을 모두 적어주세요. 수령 기록에는 고객이 보여 준 확인값 12자리도 필요합니다.' };
  }
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_record_shipment_delivery', {
      p_shipment_id: shipmentId, p_kind: kind, p_evidence: evidence, p_receipt_code: receiptCode || null,
      p_expected_updated_at: updatedAt, p_operation_id: operationId,
    });
    if (error) return { ok: false, error: deliveryErrorMessage(error.message) };
    if (!deliveryObject(data) || data.ok !== true) return { ok: false, error: deliveryErrorMessage(deliveryObject(data) ? String(data.error) : undefined) };
    refreshDelivery(); return { ok: true, message: data.replayed ? '이미 저장된 인계·수령 기록입니다.'
      : deliveryIsHandoff(kind) ? '인계를 기록하고 배송중으로 바꿨습니다.' : '수령을 기록하고 배송완료로 바꿨습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: deliveryErrorMessage() }; }
}
