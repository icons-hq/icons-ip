import { FULFILLMENT_METHOD_LABELS, FULFILLMENT_METHODS, type FulfillmentMethod } from './goods-fulfillment';
import { isUuid } from '@/lib/uuid';
import { isGoodsShipDate } from './goods-preorders';

export type DeliveryMethod = FulfillmentMethod;
export type DeliveryPolicyState = 'draft' | 'active' | 'stopped';
export const DELIVERY_OPERATIONS = ['quick_handoff', 'quick_receive', 'pickup_receive', 'direct_handoff', 'direct_receive', 'freight_handoff', 'freight_receive', 'none_receive'] as const;
export type DeliveryOperation = typeof DELIVERY_OPERATIONS[number];
export const deliveryIsHandoff = (kind: unknown) => typeof kind === 'string' && kind.endsWith('_handoff');
export type DeliveryPolicyInput = {
  state: DeliveryPolicyState; contactName: string | null; contactPhone: string | null;
  handoffLocation: string | null; handoffInstructions: string | null; appointmentInstructions: string | null;
  allowDelegate: boolean | null; completionInstructions: string | null; cancellationInstructions: string | null;
  approvalReference: string | null;
};
export type AdminDeliveryPolicy = DeliveryPolicyInput & {
  id: string; originId: string; method: Exclude<DeliveryMethod, 'parcel' | 'digital'>; revision: number;
  createdAt: string; activatedAt: string | null; stoppedAt: string | null;
};
export type DeliveryPolicySnapshot = Omit<DeliveryPolicyInput, 'state' | 'approvalReference'> & {
  version: 1 | 2; policyId: string; revision: number; feeRule: 'order_fee_unchanged' | 'checkout_prepaid';
  confirmationRule: 'recipient_code';
};
/** 마지막 배송 방식 변경의 출처. store = 발송처리 화면에서 판매자(운영자)가, customer = 주문 상세의 고객 요청 경로로 바꿨다. */
export type DeliveryChangeSource = 'store' | 'customer';
export type ShipmentDeliverySummary = {
  method: DeliveryMethod; policy: DeliveryPolicySnapshot | null; providerName: string | null; canIssueReceipt: boolean;
  /** 고객이 주문서에서 고른 방식(fulfillment_partition). 옛 응답에는 없다. 지금 방식과 다르면 주문 뒤 바뀐 건이다. */
  customerMethod?: DeliveryMethod;
  /** 마지막 방식 변경의 출처. 변경 기록이 없거나 알 수 없으면 없다(QA 라운드 1 m4). */
  changedBy?: DeliveryChangeSource;
};
export type DeliveryEvidence = {
  occurredAt: string; operatorName: string; providerName?: string; providerPhone?: string;
  handoffReference?: string; receiptReference?: string; recipientKind?: 'self' | 'delegate';
};
export type DeliveryHistory = {
  /** forced_delivered: 운영 강제 배송완료(1014-083) — 실제 인계·수령 확인값 대신 사유와 처리자를 남긴 기록. */
  id: string; kind: 'method_selected' | 'digital_access' | 'forced_delivered' | DeliveryOperation; evidence: Record<string, unknown>;
  actorName: string | null; recordedAt: string;
};
export type AdminShipmentDelivery = {
  shipmentId: string; orderId: string; originId: string; status: 'ready' | 'shipping' | 'delivered' | 'canceled';
  orderStatus: string; updatedAt: string; shippingFee: number; exportedAt: string | null; canSelect: boolean;
  canTransition: boolean; preorderReady: boolean; summary: ShipmentDeliverySummary; policies: AdminDeliveryPolicy[]; history: DeliveryHistory[];
};

export const DELIVERY_POLICY_TEXT_FIELDS = ['contactName', 'contactPhone', 'handoffLocation', 'handoffInstructions',
  'appointmentInstructions', 'completionInstructions', 'cancellationInstructions', 'approvalReference'] as const;
export const DELIVERY_METHOD_LABELS = FULFILLMENT_METHOD_LABELS;
/**
 * 배송 건 안내의 배송비 문구(고객 주문 화면·주문 상세 공용). 주문 뒤 방식을 바꾼 건(feeRule order_fee_unchanged)은 누가 바꿨는지에 맞게 쓴다 —
 * 발송처리 화면에서 판매자가 바꾼 건을 '고객 요청으로'라고 하지 않는다(QA 라운드 1 m4). 출처를 모르면 주체 없이 쓴다.
 */
export function deliveryFeeRuleNote(policy: Pick<DeliveryPolicySnapshot, 'feeRule'>, changedBy?: DeliveryChangeSource): string {
  if (policy.feeRule === 'checkout_prepaid') return '주문서에서 선택한 방식과 선결제 비용을 기준으로 제공합니다.';
  if (changedBy === 'customer') return '고객 요청으로 배송 방식을 변경했으며 주문 당시 배송비를 유지합니다.';
  if (changedBy === 'store') return '판매자가 배송 방식을 변경했으며 주문 당시 배송비를 유지합니다.';
  return '주문 후 배송 방식이 변경되었으며 주문 당시 배송비를 유지합니다.';
}
export const deliveryUuid = isUuid;
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
  // '운영 승인 근거'(approvalReference)는 화면에서 걷어 냈다(migration 20261127102000) — 비어 있어도 '사용'으로 켤 수 있다. 고객에게 보이는 나머지 칸은 모두 채워야 한다.
  if (value.state === 'active' && (allowDelegate === null || Object.entries(fields).some(([key, field]) => key !== 'approvalReference' && field === null))) return null;
  return { state: value.state as DeliveryPolicyState, ...fields, allowDelegate } as DeliveryPolicyInput;
}

export function parseAdminDeliveryPolicies(value: unknown): AdminDeliveryPolicy[] | null {
  if (!Array.isArray(value)) return null;
  const output: AdminDeliveryPolicy[] = [];
  for (const row of value) {
    if (!deliveryObject(row) || !deliveryUuid(row.id) || !deliveryUuid(row.originId) || !['quick', 'pickup', 'direct', 'freight', 'none'].includes(String(row.method))
      || !positive(row.revision) || !deliveryTimestamp(row.createdAt) || !timestampOrNull(row.activatedAt) || !timestampOrNull(row.stoppedAt)) return null;
    const input = parseDeliveryPolicyInput(Object.fromEntries(['state', 'allowDelegate', ...DELIVERY_POLICY_TEXT_FIELDS].map((key) => [key, row[key]])));
    if (!input || (input.state === 'active' && row.activatedAt === null) || (input.state === 'stopped' && row.stoppedAt === null)) return null;
    output.push({ ...input, id: row.id, originId: row.originId, method: row.method as AdminDeliveryPolicy['method'], revision: row.revision,
      createdAt: row.createdAt, activatedAt: row.activatedAt as string | null, stoppedAt: row.stoppedAt as string | null });
  }
  return output;
}

/** 방식 변경 표시용 보조 값. 모르는 값은 버린다(요약 전체를 깨지 않는다). */
function deliveryChange(value: Record<string, unknown>): Pick<ShipmentDeliverySummary, 'customerMethod' | 'changedBy'> {
  return {
    ...(FULFILLMENT_METHODS.includes(value.customerMethod as FulfillmentMethod) ? { customerMethod: value.customerMethod as DeliveryMethod } : {}),
    ...(value.changedBy === 'store' || value.changedBy === 'customer' ? { changedBy: value.changedBy } : {}),
  };
}

export function parseShipmentDeliverySummary(value: unknown): ShipmentDeliverySummary | null {
  if (!deliveryObject(value) || !FULFILLMENT_METHODS.includes(value.method as FulfillmentMethod)) return null;
  if (value.method === 'parcel' || value.method === 'digital') return { method: value.method, policy: null, providerName: null, canIssueReceipt: false, ...deliveryChange(value) };
  const policy = value.policy;
  if (!deliveryObject(policy) || ![1, 2].includes(Number(policy.version)) || !deliveryUuid(policy.policyId) || !positive(policy.revision)
    || policy.feeRule !== (policy.version === 1 ? 'order_fee_unchanged' : 'checkout_prepaid') || policy.confirmationRule !== 'recipient_code'
    || typeof policy.allowDelegate !== 'boolean' || typeof value.canIssueReceipt !== 'boolean'
    || (value.providerName != null && typeof value.providerName !== 'string')) return null;
  const fields: Record<string, string> = {};
  for (const key of DELIVERY_POLICY_TEXT_FIELDS.filter((key) => key !== 'approvalReference')) {
    const parsed = text(policy[key]); if (!parsed) return null; fields[key] = parsed;
  }
  return { method: value.method as DeliveryMethod, providerName: value.providerName as string | null ?? null, canIssueReceipt: value.canIssueReceipt,
    policy: { ...fields, version: policy.version, policyId: policy.policyId, revision: policy.revision, allowDelegate: policy.allowDelegate,
      feeRule: policy.feeRule, confirmationRule: 'recipient_code' } as DeliveryPolicySnapshot, ...deliveryChange(value) };
}

export function parseDeliveryEvidence(kind: unknown, value: unknown): DeliveryEvidence | null {
  if (!deliveryObject(value) || !DELIVERY_OPERATIONS.includes(kind as DeliveryOperation)) return null;
  const keys = deliveryIsHandoff(kind) ? ['operatorName', 'providerName', 'providerPhone', 'handoffReference', 'occurredAt']
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
  if (!deliveryIsHandoff(kind) && !['self', 'delegate'].includes(String(value.recipientKind))) return null;
  return { ...fields, occurredAt, ...(!deliveryIsHandoff(kind) ? { recipientKind: value.recipientKind } : {}) } as DeliveryEvidence;
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
    if (!deliveryObject(row) || !deliveryUuid(row.id) || !['method_selected', 'digital_access', 'forced_delivered', ...DELIVERY_OPERATIONS].includes(String(row.kind))
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
  if (method === 'digital') return status === 'delivered' ? '파일 제공 시작' : '파일 제공 대기';
  if (method === 'none') return status === 'delivered' ? '직접전달 완료' : '직접전달 준비';
  if (method === 'pickup') return status === 'delivered' ? '방문수령 완료' : '방문수령 준비';
  const label = { ready: '배송 준비', shipping: '배송 중', delivered: '배송 완료' }[status];
  return method === 'parcel' ? label : `${DELIVERY_METHOD_LABELS[method]} ${label}`;
}

export function deliveryErrorMessage(code?: string): string {
  const messages: Record<string, string> = {
    delivery_policy_changed: '다른 사람이 먼저 바꿨습니다. [다시 불러오기]를 눌러 운영 조건을 확인한 뒤 다시 해주세요.',
    delivery_policy_already_active: "이 방식에는 이미 '사용'인 운영 조건이 있습니다. 사용 중인 조건을 [사용 안 함으로 바꾸기] 한 뒤 다시 켜주세요.",
    activated_delivery_policy_immutable: '한 번 켠 운영 조건은 고칠 수 없습니다. 내용을 바꾸려면 운영 조건을 새로 추가해주세요.',
    delivery_policy_not_found: '운영 조건을 찾지 못했습니다. [다시 불러오기]를 눌러 목록을 확인해주세요.',
    shipment_delivery_changed: '다른 사람이 먼저 바꿨습니다. 새로고침해 배송 건의 상태를 확인한 뒤 다시 해주세요.',
    delivery_operation_conflict: '같은 처리에 다른 내용이 이미 저장돼 있습니다. 새로고침해 이력을 확인해주세요.',
    delivery_policy_incomplete: "'사용'으로 저장하려면 담당자 이름·담당자 연락처·인계 장소·인계 방법 안내·예약·방문 시간 안내·받았는지 확인하는 방법·취소 안내·대리수령을 모두 채워주세요.",
    delivery_policy_unavailable: "이 출고지에서 켜져 있지 않은 배송 방식입니다. 배송정보 관리에서 운영 조건을 '사용'으로 켠 뒤 다시 해주세요.",
    delivery_method_selection_unavailable: '결제가 확인됐고 출고지시를 아직 보내지 않은 발송 대기 배송 건만 방식을 바꿀 수 있습니다.',
    delivery_method_evidence_required: "이 배송 방식은 주문 상세의 '배송 방식·인계 확인'에서 인계·수령을 기록해주세요.",
    delivery_receipt_code_invalid: '고객이 보여 준 확인값이 맞지 않습니다. 고객의 주문 화면에 보이는 값을 다시 확인해주세요.',
    delivery_receipt_code_unavailable: '확인값이 만료됐거나 이미 쓰였습니다. 고객에게 주문 화면에서 다시 발급해 달라고 안내해주세요.',
    delivery_delegate_not_allowed: '이 출고지의 운영 조건은 대리수령을 허용하지 않습니다.',
    invalid_delivery_evidence: '담당자·시각·확인 내용을 모두 적어주세요. 인계 기록에는 배송 업체·기사와 업체 연락처도 필요하고, 시각은 발주확인 뒤부터 지금까지여야 합니다.',
    preorder_allocation_required: '예약 품목의 입고 확인을 먼저 해주세요(예약판매의 [선택한 예약 주문 입고 확인]).',
    'order cancellation in progress': '취소·반품·교환 요청이 진행 중입니다. 그 요청을 먼저 처리해주세요.',
    'order fulfillment hold': '출고 보류 중인 주문입니다(결제 확인 필요). 주문 상세의 출고 보류 안내를 확인해주세요.',
  };
  return (code && messages[code]) || '저장됐는지 확인하지 못했습니다. 새로고침한 뒤 이력에서 확인해주세요.';
}
