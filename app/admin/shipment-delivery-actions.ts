'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import {
  DELIVERY_POLICY_TEXT_FIELDS, deliveryErrorMessage, deliveryObject, deliveryTimestamp, deliveryUuid,
  parseAdminDeliveryPolicies, parseAdminShipmentDelivery, parseDeliveryEvidence, parseDeliveryPolicyInput,
  type AdminDeliveryPolicy, type AdminShipmentDelivery,
} from '@/lib/shipment-delivery';

type Failure = { ok: false; error: string };
type Saved = { ok: true; message: string };
async function staff(admin = false) {
  const auth = await getCurrentAdminAuthState();
  return auth.isConfigured && Boolean(auth.user) && auth.isStaff && (!admin || auth.role === 'admin');
}
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
  if (!await staff()) return { ok: false, error: '운영자만 배송 방식 정책을 확인할 수 있습니다.' };
  if (!deliveryUuid(originId)) return { ok: false, error: '출고지를 다시 선택해주세요.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_list_delivery_policies', { p_origin_id: originId });
    const policies = error ? null : parseAdminDeliveryPolicies(data);
    return policies ? { ok: true, policies } : { ok: false, error: '배송 방식 정책을 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '배송 방식 정책을 불러오지 못했습니다.' }; }
}
export async function saveDeliveryPolicyAction(form: FormData): Promise<Saved | Failure> {
  if (!await staff(true)) return { ok: false, error: '배송 방식 정책은 관리자만 저장할 수 있습니다.' };
  const originId = form.get('originId'); const policyId = nullableUuid(form.get('policyId'));
  const expectedRevision = revision(form.get('revision')); const method = form.get('method');
  const delegate = form.get('allowDelegate');
  const input = parseDeliveryPolicyInput({ state: form.get('state'), allowDelegate: delegate === 'true' ? true : delegate === 'false' ? false : null,
    ...Object.fromEntries(DELIVERY_POLICY_TEXT_FIELDS.map((key) => [key, form.get(key)])) });
  if (!deliveryUuid(originId) || !['quick', 'pickup'].includes(String(method)) || policyId === false || expectedRevision === false
    || (policyId === null) !== (expectedRevision === null) || !input) return { ok: false, error: deliveryErrorMessage('delivery_policy_incomplete') };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_save_delivery_policy', {
      p_origin_id: originId, p_method: method, p_policy_id: policyId, p_expected_revision: expectedRevision, p_values: input,
    });
    if (error) return { ok: false, error: deliveryErrorMessage(error.message) };
    if (!deliveryObject(data) || !deliveryUuid(data.id) || typeof data.changed !== 'boolean') return { ok: false, error: deliveryErrorMessage() };
    revalidatePath('/admin/settings/origins');
    return { ok: true, message: input.state === 'active' ? '운영 근거를 저장하고 배송 방식을 활성화했습니다.'
      : input.state === 'stopped' ? '새 배송 방식 선택을 중지했습니다. 이미 선택한 배송 건의 인계는 저장된 조건으로 진행합니다.' : '배송 방식 정책을 초안으로 저장했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: deliveryErrorMessage() }; }
}
export async function readShipmentDeliveryAction(shipmentId: unknown): Promise<{ ok: true; shipment: AdminShipmentDelivery } | Failure> {
  if (!await staff()) return { ok: false, error: '운영자만 배송 인계 정보를 확인할 수 있습니다.' };
  if (!deliveryUuid(shipmentId)) return { ok: false, error: '배송 건을 다시 선택해주세요.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_read_shipment_delivery', { p_shipment_id: shipmentId });
    const shipment = error ? null : parseAdminShipmentDelivery(data);
    return shipment ? { ok: true, shipment } : { ok: false, error: '배송 인계 정보를 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '배송 인계 정보를 불러오지 못했습니다.' }; }
}
export async function selectShipmentDeliveryMethodAction(form: FormData): Promise<Saved | Failure> {
  if (!await staff()) return { ok: false, error: '운영자만 배송 방식을 변경할 수 있습니다.' };
  const shipmentId = form.get('shipmentId'); const operationId = form.get('operationId'); const method = form.get('method');
  const policyId = nullableUuid(form.get('policyId')); const updatedAt = form.get('updatedAt');
  const requestReference = String(form.get('customerRequestReference') ?? '').trim();
  const feeConsentReference = String(form.get('feeConsentReference') ?? '').trim();
  if (!deliveryUuid(shipmentId) || !deliveryUuid(operationId) || !deliveryTimestamp(updatedAt) || !['parcel', 'quick', 'pickup'].includes(String(method))
    || policyId === false || (method === 'parcel') !== (policyId === null) || !requestReference || requestReference.length > 2000
    || !feeConsentReference || feeConsentReference.length > 2000 || form.get('feeUnchanged') !== 'on') {
    return { ok: false, error: '방식·운영 정책과 고객 요청, 기존 배송비 유지 동의 근거를 입력해주세요.' };
  }
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_select_shipment_delivery_method', {
      p_shipment_id: shipmentId, p_method: method, p_policy_id: policyId, p_customer_request_reference: requestReference,
      p_fee_consent_reference: feeConsentReference, p_fee_unchanged: true, p_expected_updated_at: updatedAt, p_operation_id: operationId,
    });
    if (error) return { ok: false, error: deliveryErrorMessage(error.message) };
    if (!deliveryObject(data) || data.ok !== true) return { ok: false, error: deliveryErrorMessage() };
    refreshDelivery(); return { ok: true, message: data.replayed ? '이미 기록된 배송 방식 변경을 확인했습니다.' : '고객 요청과 배송비 유지 동의를 기록하고 배송 방식을 반영했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: deliveryErrorMessage() }; }
}
export async function recordShipmentDeliveryAction(form: FormData): Promise<Saved | Failure> {
  if (!await staff()) return { ok: false, error: '운영자만 인계·수령을 확인할 수 있습니다.' };
  const shipmentId = form.get('shipmentId'); const operationId = form.get('operationId'); const kind = form.get('kind'); const updatedAt = form.get('updatedAt');
  const keys = kind === 'quick_handoff' ? ['operatorName', 'providerName', 'providerPhone', 'handoffReference', 'occurredAt']
    : ['operatorName', 'receiptReference', 'recipientKind', 'occurredAt'];
  const evidence = parseDeliveryEvidence(kind, Object.fromEntries(keys.map((key) => [key, form.get(key)])));
  const receiptCode = String(form.get('receiptCode') ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!deliveryUuid(shipmentId) || !deliveryUuid(operationId) || !deliveryTimestamp(updatedAt) || !evidence
    || (kind !== 'quick_handoff' && !/^[0-9A-F]{12}$/.test(receiptCode)) || (kind === 'quick_handoff' && receiptCode !== '')) {
    return { ok: false, error: '실제 인계·수령 근거와 시각, 필요한 일회 수령 확인값을 입력해주세요.' };
  }
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_record_shipment_delivery', {
      p_shipment_id: shipmentId, p_kind: kind, p_evidence: evidence, p_receipt_code: receiptCode || null,
      p_expected_updated_at: updatedAt, p_operation_id: operationId,
    });
    if (error) return { ok: false, error: deliveryErrorMessage(error.message) };
    if (!deliveryObject(data) || data.ok !== true) return { ok: false, error: deliveryErrorMessage(deliveryObject(data) ? String(data.error) : undefined) };
    refreshDelivery(); return { ok: true, message: data.replayed ? '이미 완료된 같은 인계·수령 기록을 확인했습니다.'
      : kind === 'quick_handoff' ? '실제 퀵 인계 근거를 기록하고 배송 중으로 반영했습니다.' : '일회 수령 확인과 인계 근거를 기록하고 수령 완료로 반영했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: deliveryErrorMessage() }; }
}
