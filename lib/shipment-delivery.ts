import { isGoodsShipDate } from './goods-preorders';

export type DeliveryMethod = 'parcel' | 'quick' | 'pickup';
export type DeliveryPolicyState = 'draft' | 'active' | 'stopped';
export type DeliveryOperation = 'quick_handoff' | 'quick_receive' | 'pickup_receive';
export type DeliveryPolicyInput = {
  state: DeliveryPolicyState; contactName: string | null; contactPhone: string | null;
  handoffLocation: string | null; handoffInstructions: string | null; appointmentInstructions: string | null;
  allowDelegate: boolean | null; completionInstructions: string | null; cancellationInstructions: string | null;
  approvalReference: string | null;
};
export type AdminDeliveryPolicy = DeliveryPolicyInput & {
  id: string; originId: string; method: Exclude<DeliveryMethod, 'parcel'>; revision: number;
  createdAt: string; activatedAt: string | null; stoppedAt: string | null;
};
export type DeliveryPolicySnapshot = Omit<DeliveryPolicyInput, 'state' | 'approvalReference'> & {
  version: 1; policyId: string; revision: number; feeRule: 'order_fee_unchanged';
  confirmationRule: 'recipient_code';
};
export type ShipmentDeliverySummary = {
  method: DeliveryMethod; policy: DeliveryPolicySnapshot | null; providerName: string | null; canIssueReceipt: boolean;
};
export type DeliveryEvidence = {
  occurredAt: string; operatorName: string; providerName?: string; providerPhone?: string;
  handoffReference?: string; receiptReference?: string; recipientKind?: 'self' | 'delegate';
};
export type DeliveryHistory = {
  id: string; kind: 'method_selected' | DeliveryOperation; evidence: Record<string, unknown>;
  actorName: string | null; recordedAt: string;
};
export type AdminShipmentDelivery = {
  shipmentId: string; orderId: string; originId: string; status: 'ready' | 'shipping' | 'delivered' | 'canceled';
  orderStatus: string; updatedAt: string; shippingFee: number; exportedAt: string | null; canSelect: boolean;
  canTransition: boolean; preorderReady: boolean; summary: ShipmentDeliverySummary; policies: AdminDeliveryPolicy[]; history: DeliveryHistory[];
};

export const DELIVERY_POLICY_TEXT_FIELDS = ['contactName', 'contactPhone', 'handoffLocation', 'handoffInstructions',
  'appointmentInstructions', 'completionInstructions', 'cancellationInstructions', 'approvalReference'] as const;
export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = { parcel: '택배', quick: '퀵', pickup: '방문수령' };
export function deliveryUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function deliveryObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function deliveryTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && isGoodsShipDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60
    && Number(value.slice(17, 19)) < 60 && Number.isFinite(Date.parse(value));
}
function text(value: unknown, maximum = 2000): string | null | false {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return false;
  return value.trim() || null;
}
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647; }
function timestampOrNull(value: unknown): boolean { return value === null || deliveryTimestamp(value); }

export function parseDeliveryPolicyInput(value: unknown): DeliveryPolicyInput | null {
  if (!deliveryObject(value) || !['draft', 'active', 'stopped'].includes(String(value.state))
    || Object.keys(value).some((key) => !['state', 'allowDelegate', ...DELIVERY_POLICY_TEXT_FIELDS].includes(key))) return null;
  const fields: Record<string, string | null> = {};
  for (const key of DELIVERY_POLICY_TEXT_FIELDS) {
    const parsed = text(value[key], key === 'contactName' ? 100 : key === 'contactPhone' ? 40 : 2000);
    if (parsed === false) return null;
    fields[key] = parsed;
  }
  const allowDelegate = value.allowDelegate === '' || value.allowDelegate == null ? null
    : typeof value.allowDelegate === 'boolean' ? value.allowDelegate : null;
  if (value.allowDelegate !== '' && value.allowDelegate != null && typeof value.allowDelegate !== 'boolean') return null;
  if (value.state === 'active' && (allowDelegate === null || Object.values(fields).some((field) => field === null))) return null;
  return { state: value.state as DeliveryPolicyState, ...fields, allowDelegate } as DeliveryPolicyInput;
}

export function parseAdminDeliveryPolicies(value: unknown): AdminDeliveryPolicy[] | null {
  if (!Array.isArray(value)) return null;
  const output: AdminDeliveryPolicy[] = [];
  for (const row of value) {
    if (!deliveryObject(row) || !deliveryUuid(row.id) || !deliveryUuid(row.originId) || !['quick', 'pickup'].includes(String(row.method))
      || !positive(row.revision) || !deliveryTimestamp(row.createdAt) || !timestampOrNull(row.activatedAt) || !timestampOrNull(row.stoppedAt)) return null;
    const input = parseDeliveryPolicyInput(Object.fromEntries(['state', 'allowDelegate', ...DELIVERY_POLICY_TEXT_FIELDS].map((key) => [key, row[key]])));
    if (!input || (input.state === 'active' && row.activatedAt === null) || (input.state === 'stopped' && row.stoppedAt === null)) return null;
    output.push({ ...input, id: row.id, originId: row.originId, method: row.method as AdminDeliveryPolicy['method'], revision: row.revision,
      createdAt: row.createdAt, activatedAt: row.activatedAt as string | null, stoppedAt: row.stoppedAt as string | null });
  }
  return output;
}

export function parseShipmentDeliverySummary(value: unknown): ShipmentDeliverySummary | null {
  if (!deliveryObject(value) || !['parcel', 'quick', 'pickup'].includes(String(value.method))) return null;
  if (value.method === 'parcel') return { method: 'parcel', policy: null, providerName: null, canIssueReceipt: false };
  const policy = value.policy;
  if (!deliveryObject(policy) || policy.version !== 1 || !deliveryUuid(policy.policyId) || !positive(policy.revision)
    || policy.feeRule !== 'order_fee_unchanged' || policy.confirmationRule !== 'recipient_code'
    || typeof policy.allowDelegate !== 'boolean' || typeof value.canIssueReceipt !== 'boolean'
    || (value.providerName != null && typeof value.providerName !== 'string')) return null;
  const fields: Record<string, string> = {};
  for (const key of DELIVERY_POLICY_TEXT_FIELDS.filter((key) => key !== 'approvalReference')) {
    const parsed = text(policy[key]); if (!parsed) return null; fields[key] = parsed;
  }
  return { method: value.method as DeliveryMethod, providerName: value.providerName as string | null ?? null, canIssueReceipt: value.canIssueReceipt,
    policy: { ...fields, version: 1, policyId: policy.policyId, revision: policy.revision, allowDelegate: policy.allowDelegate,
      feeRule: 'order_fee_unchanged', confirmationRule: 'recipient_code' } as DeliveryPolicySnapshot };
}

export function parseDeliveryEvidence(kind: unknown, value: unknown): DeliveryEvidence | null {
  if (!deliveryObject(value) || !['quick_handoff', 'quick_receive', 'pickup_receive'].includes(String(kind))) return null;
  const keys = kind === 'quick_handoff' ? ['operatorName', 'providerName', 'providerPhone', 'handoffReference', 'occurredAt']
    : ['operatorName', 'receiptReference', 'recipientKind', 'occurredAt'];
  if (Object.keys(value).some((key) => !keys.includes(key))) return null;
  let occurredAt = value.occurredAt;
  if (typeof occurredAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(occurredAt)) {
    if (!isGoodsShipDate(occurredAt.slice(0, 10)) || Number(occurredAt.slice(11, 13)) >= 24 || Number(occurredAt.slice(14, 16)) >= 60
      || (occurredAt.length > 16 && Number(occurredAt.slice(17, 19)) >= 60)) return null;
    occurredAt = new Date(`${occurredAt}${occurredAt.length === 16 ? ':00' : ''}+09:00`).toISOString();
  }
  if (!deliveryTimestamp(occurredAt)) return null;
  const fields: Record<string, string> = {};
  for (const key of keys.filter((key) => !['occurredAt', 'recipientKind'].includes(key))) {
    const parsed = text(value[key], ['operatorName', 'providerName'].includes(key) ? 100 : key === 'providerPhone' ? 40 : 2000);
    if (!parsed) return null; fields[key] = parsed;
  }
  if (kind !== 'quick_handoff' && !['self', 'delegate'].includes(String(value.recipientKind))) return null;
  return { ...fields, occurredAt, ...(kind !== 'quick_handoff' ? { recipientKind: value.recipientKind } : {}) } as DeliveryEvidence;
}

export function parseAdminShipmentDelivery(value: unknown): AdminShipmentDelivery | null {
  if (!deliveryObject(value) || !deliveryUuid(value.shipmentId) || !deliveryUuid(value.orderId) || !deliveryUuid(value.originId)
    || !deliveryTimestamp(value.updatedAt) || !['ready', 'shipping', 'delivered', 'canceled'].includes(String(value.status))
    || !['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'].includes(String(value.orderStatus))
    || typeof value.shippingFee !== 'number' || !Number.isSafeInteger(value.shippingFee) || value.shippingFee < 0
    || !timestampOrNull(value.exportedAt) || typeof value.canSelect !== 'boolean' || typeof value.canTransition !== 'boolean'
    || typeof value.preorderReady !== 'boolean' || !Array.isArray(value.history)) return null;
  const summary = parseShipmentDeliverySummary(value.summary); const policies = parseAdminDeliveryPolicies(value.policies);
  if (!summary || !policies) return null;
  const history: DeliveryHistory[] = [];
  for (const row of value.history) {
    if (!deliveryObject(row) || !deliveryUuid(row.id) || !['method_selected', 'quick_handoff', 'quick_receive', 'pickup_receive'].includes(String(row.kind))
      || !deliveryObject(row.evidence) || !deliveryTimestamp(row.recordedAt) || (row.actorName !== null && typeof row.actorName !== 'string')) return null;
    history.push({ id: row.id, kind: row.kind as DeliveryHistory['kind'], evidence: row.evidence,
      actorName: row.actorName as string | null, recordedAt: row.recordedAt });
  }
  return { shipmentId: value.shipmentId, orderId: value.orderId, originId: value.originId, status: value.status as AdminShipmentDelivery['status'],
    orderStatus: value.orderStatus as string, updatedAt: value.updatedAt, shippingFee: value.shippingFee, exportedAt: value.exportedAt as string | null,
    canSelect: value.canSelect, canTransition: value.canTransition, preorderReady: value.preorderReady, summary, policies, history };
}

export function deliveryStatusLabel(method: DeliveryMethod, status: 'ready' | 'shipping' | 'delivered' | 'canceled'): string {
  if (status === 'canceled') return '취소';
  if (method === 'pickup') return status === 'delivered' ? '방문수령 완료' : '방문수령 준비';
  const label = { ready: '배송 준비', shipping: '배송 중', delivered: '배송 완료' }[status];
  return method === 'quick' ? `퀵 ${label}` : label;
}

export function deliveryErrorMessage(code?: string): string {
  const messages: Record<string, string> = {
    delivery_policy_changed: '운영 정책이 변경되었습니다. 새로고침한 뒤 다시 확인해주세요.',
    shipment_delivery_changed: '배송 건이 변경되었습니다. 새로고침한 뒤 다시 확인해주세요.',
    delivery_operation_conflict: '같은 요청 번호에 다른 내용이 있습니다. 처리 결과를 새로고침해주세요.',
    delivery_policy_incomplete: '실제 연락처·인계 안내·완료 기준·취소 안내·승인 근거를 모두 입력해주세요.',
    delivery_policy_unavailable: '선택할 수 있는 활성 운영 정책이 없습니다.',
    delivery_method_selection_unavailable: '결제된 주문의 아직 발주 전달하지 않은 배송 준비 건만 방식을 바꿀 수 있습니다.',
    delivery_method_evidence_required: '이 배송 방식의 인계·수령 확인 절차를 이용해주세요.',
    delivery_receipt_code_invalid: '수령 확인값이 일치하지 않습니다. 주문자가 표시한 값을 다시 확인해주세요.',
    delivery_receipt_code_unavailable: '수령 확인값이 만료되었거나 이미 사용되었습니다. 주문 화면에서 다시 발급해주세요.',
    delivery_delegate_not_allowed: '이 출고지의 현재 인계 조건에서는 대리수령을 허용하지 않습니다.',
    invalid_delivery_evidence: '실제 인계 담당자·시각과 방식에 맞는 근거를 모두 입력해주세요.',
    preorder_allocation_required: '예약 품목에 실제 입고 물량을 먼저 할당해주세요.',
    'order cancellation in progress': '진행 중인 취소·클레임을 먼저 확인해주세요.',
  };
  return (code && messages[code]) || '배송 방식 처리 결과를 확인하지 못했습니다. 새로고침한 뒤 기록을 확인해주세요.';
}
