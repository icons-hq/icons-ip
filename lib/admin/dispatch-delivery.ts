import { productionError } from '@/lib/order-production';
import { FULFILLMENT_METHOD_LABELS, FULFILLMENT_METHODS, type FulfillmentMethod } from '@/lib/goods-fulfillment';
import { isUuid } from '@/lib/uuid';

/*
 * 발송처리 화면의 배송 방법 적용·택배 외 일괄 발송(인계) — S36-072·S36-X04(2026-11-11 결정 묶음 4).
 * DB 계약은 admin_dispatch_delivery_options·admin_dispatch_apply_delivery(20261112130000)다. 이 모듈은
 * 서버 응답을 좁히고, 팝업이 무엇을 할지(방법 변경·인계·제외)와 사유가 필요한지를 같은 규칙으로 계산한다.
 * 최종 판정은 DB가 잠근 뒤 다시 한다 — 여기 계산은 화면 안내와 보낼 대상 고르기용이다.
 */

export type DispatchMethod = 'parcel' | 'quick' | 'pickup' | 'direct' | 'freight';
export const DISPATCH_METHODS: readonly DispatchMethod[] = ['parcel', 'quick', 'pickup', 'direct', 'freight'];
/** 실제 인계 근거를 남기면 배송 중이 되는 방법. 방문수령은 고객의 일회 수령 확인값으로 끝나므로 적용만 한다. */
export const DISPATCH_HANDOFF_METHODS: readonly DispatchMethod[] = ['quick', 'direct', 'freight'];
export const DISPATCH_TARGET_LIMIT = 100;
export const DISPATCH_REASON_MAX_LENGTH = 1000;

export interface DispatchDeliveryShipment {
  id: string; orderId: string; orderNumber: string | null; shipmentNumber: string | null; originId: string; originName: string;
  status: 'ready' | 'shipping' | 'delivered' | 'canceled'; orderStatus: string;
  /** 고객이 주문서에서 고른 방법(주문 때 정해지고 바뀌지 않는다). */
  customerMethod: FulfillmentMethod;
  /** 지금 적용된 방법. */
  method: FulfillmentMethod;
  /** 동시 변경 확인용. 마이크로초까지 그대로 돌려보내야 하므로 문자열로 둔다. */
  updatedAt: string;
  exportedAt: string | null; hasTracking: boolean; packed: boolean; claimOpen: boolean; preorderReady: boolean;
  canSelect: boolean; canHandoff: boolean;
}
export interface DispatchDeliveryPolicy {
  id: string; originId: string; method: Exclude<DispatchMethod, 'parcel'>; revision: number; contactName: string; handoffLocation: string;
}
export interface DispatchDeliveryOptions { shipments: DispatchDeliveryShipment[]; policies: DispatchDeliveryPolicy[] }
export interface DispatchHandoffInput { operatorName: string; providerName: string; providerPhone: string; handoffReference: string; occurredAt: string }
export interface DispatchDeliveryRowResult { shipmentId: string; ok: boolean; methodChanged?: boolean; handedOff?: boolean; error?: string }
export interface DispatchDeliveryReceipt {
  operationId: string; method: DispatchMethod; results: DispatchDeliveryRowResult[]; changed: number; handedOff: number; failed: number; replayed: boolean;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const method = (value: unknown): value is FulfillmentMethod => FULFILLMENT_METHODS.includes(value as FulfillmentMethod);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parseDispatchDeliveryOptions(value: unknown): DispatchDeliveryOptions | null {
  if (!record(value) || !Array.isArray(value.shipments) || !Array.isArray(value.policies)) return null;
  const shipments: DispatchDeliveryShipment[] = [];
  for (const row of value.shipments) {
    if (!record(row) || !isUuid(row.id) || !isUuid(row.orderId) || !isUuid(row.originId) || typeof row.originName !== 'string'
      || !['ready', 'shipping', 'delivered', 'canceled'].includes(String(row.status)) || typeof row.orderStatus !== 'string'
      || !method(row.customerMethod) || !method(row.method) || !timestamp(row.updatedAt) || !(row.exportedAt === null || timestamp(row.exportedAt))
      || (row.orderNumber !== null && typeof row.orderNumber !== 'string') || (row.shipmentNumber !== null && typeof row.shipmentNumber !== 'string')
      || ['hasTracking', 'packed', 'claimOpen', 'preorderReady', 'canSelect', 'canHandoff'].some(key => typeof row[key] !== 'boolean')) return null;
    shipments.push({ id: row.id, orderId: row.orderId, orderNumber: (row.orderNumber as string | null) ?? null, shipmentNumber: (row.shipmentNumber as string | null) ?? null,
      originId: row.originId, originName: row.originName, status: row.status as DispatchDeliveryShipment['status'], orderStatus: row.orderStatus,
      customerMethod: row.customerMethod, method: row.method, updatedAt: row.updatedAt, exportedAt: row.exportedAt as string | null,
      hasTracking: row.hasTracking as boolean, packed: row.packed as boolean, claimOpen: row.claimOpen as boolean, preorderReady: row.preorderReady as boolean,
      canSelect: row.canSelect as boolean, canHandoff: row.canHandoff as boolean });
  }
  const policies: DispatchDeliveryPolicy[] = [];
  for (const row of value.policies) {
    if (!record(row) || !isUuid(row.id) || !isUuid(row.originId) || !['quick', 'pickup', 'direct', 'freight'].includes(String(row.method))
      || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1
      || typeof row.contactName !== 'string' || typeof row.handoffLocation !== 'string') return null;
    policies.push({ id: row.id, originId: row.originId, method: row.method as DispatchDeliveryPolicy['method'], revision: row.revision,
      contactName: row.contactName, handoffLocation: row.handoffLocation });
  }
  return { shipments, policies };
}

export function parseDispatchDeliveryReceipt(value: unknown): DispatchDeliveryReceipt | null {
  if (!record(value) || !isUuid(value.operationId) || !DISPATCH_METHODS.includes(value.method as DispatchMethod) || !Array.isArray(value.results)
    || !count(value.changed) || !count(value.handedOff) || !count(value.failed) || typeof value.replayed !== 'boolean') return null;
  const results: DispatchDeliveryRowResult[] = [];
  for (const row of value.results) {
    if (!record(row) || !isUuid(row.shipmentId) || typeof row.ok !== 'boolean') return null;
    if (row.ok && (typeof row.methodChanged !== 'boolean' || typeof row.handedOff !== 'boolean')) return null;
    if (!row.ok && typeof row.error !== 'string') return null;
    results.push(row.ok ? { shipmentId: row.shipmentId, ok: true, methodChanged: row.methodChanged as boolean, handedOff: row.handedOff as boolean }
      : { shipmentId: row.shipmentId, ok: false, error: row.error as string });
  }
  return { operationId: value.operationId, method: value.method as DispatchMethod, results, changed: value.changed, handedOff: value.handedOff,
    failed: value.failed, replayed: value.replayed };
}

/** 고른 배송 건 전부의 출고지에서 켜진 방법. 택배는 운영 조건이 필요 없다. */
export function availableDispatchMethods(options: DispatchDeliveryOptions): DispatchMethod[] {
  const origins = [...new Set(options.shipments.map(shipment => shipment.originId))];
  return DISPATCH_METHODS.filter(candidate => candidate === 'parcel'
    || origins.length > 0 && origins.every(origin => options.policies.some(policy => policy.originId === origin && policy.method === candidate)));
}

export type DispatchPlanStep =
  | { shipment: DispatchDeliveryShipment; kind: 'apply'; changeMethod: boolean; handoff: boolean; needsReason: boolean }
  | { shipment: DispatchDeliveryShipment; kind: 'skip'; reason: string };

/** 배송 건마다 이번 요청이 할 일. 바꿀 수 없거나 할 일이 없는 건은 보내지 않고 이유를 보인다. */
export function dispatchDeliveryPlan(options: DispatchDeliveryOptions, target: DispatchMethod, handoff: boolean): DispatchPlanStep[] {
  const withHandoff = handoff && DISPATCH_HANDOFF_METHODS.includes(target);
  return options.shipments.map((shipment): DispatchPlanStep => {
    const changeMethod = shipment.method !== target;
    if (changeMethod && !shipment.canSelect) return { shipment, kind: 'skip', reason: dispatchSelectBlocker(shipment) };
    if (changeMethod && target !== 'parcel' && !options.policies.some(policy => policy.originId === shipment.originId && policy.method === target)) {
      return { shipment, kind: 'skip', reason: dispatchDeliveryError('delivery_policy_unavailable') };
    }
    if (withHandoff && !shipment.canHandoff) return { shipment, kind: 'skip', reason: shipment.claimOpen ? dispatchDeliveryError('order cancellation in progress')
      : !shipment.preorderReady ? dispatchDeliveryError('preorder_allocation_required') : dispatchDeliveryError('delivery_method_evidence_required') };
    if (!changeMethod && !withHandoff) return { shipment, kind: 'skip', reason: dispatchDeliveryError('dispatch_delivery_unchanged') };
    return { shipment, kind: 'apply', changeMethod, handoff: withHandoff, needsReason: changeMethod && target !== shipment.customerMethod };
  });
}

function dispatchSelectBlocker(shipment: DispatchDeliveryShipment): string {
  if (shipment.customerMethod === 'none' || shipment.customerMethod === 'digital') return dispatchDeliveryError('delivery_method_fixed');
  if (shipment.claimOpen) return dispatchDeliveryError('order cancellation in progress');
  if (shipment.packed) return dispatchDeliveryError('shipment_pack_method_locked');
  if (shipment.exportedAt) return '출고지시를 이미 전달한 배송 건은 창고 출고와 겹치지 않게 방법을 바꾸지 않습니다.';
  if (shipment.hasTracking || shipment.status !== 'ready') return '이미 발송한 배송 건은 방법을 바꾸지 않습니다.';
  return dispatchDeliveryError('delivery_method_selection_unavailable');
}

export function dispatchMethodLabel(value: FulfillmentMethod): string {
  return FULFILLMENT_METHOD_LABELS[value];
}

/** 화면 입력 → 서버 액션 입력. 시각은 한국 시각 datetime-local 값이다. */
export function dispatchHandoffFromForm(form: Record<string, string>): DispatchHandoffInput | null {
  const operatorName = form.operatorName?.trim() ?? '', providerName = form.providerName?.trim() ?? '', providerPhone = form.providerPhone?.trim() ?? '';
  const handoffReference = form.handoffReference?.trim() ?? '', local = form.occurredAt?.trim() ?? '';
  if (!operatorName || operatorName.length > 100 || !providerName || providerName.length > 100 || !providerPhone || providerPhone.length > 40
    || !handoffReference || handoffReference.length > 2000 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(local)) return null;
  const instant = new Date(`${local}${local.length === 16 ? ':00' : ''}+09:00`);
  if (!Number.isFinite(instant.valueOf())) return null;
  return { operatorName, providerName, providerPhone, handoffReference, occurredAt: instant.toISOString() };
}

export function dispatchDeliveryError(code?: string): string {
  if (code?.startsWith('production_')) return productionError(undefined, code);
  const messages: Record<string, string> = {
    shipment_delivery_changed: '배송 건이 그 사이 바뀌었습니다. 목록을 새로고침한 뒤 다시 확인해주세요.',
    shipment_not_found: '배송 건을 찾을 수 없습니다. 목록을 새로고침해주세요.',
    delivery_method_fixed: '배송없음·디지털 상품은 구매 때 정한 제공 방식을 유지합니다.',
    delivery_method_selection_unavailable: '결제된 주문의 출고지시 전달·운송장 등록 전 배송 준비 건만 방법을 바꿀 수 있습니다.',
    'order cancellation in progress': '취소·반품·교환 처리가 진행 중입니다. 주문 상세를 먼저 확인해주세요.',
    shipment_pack_method_locked: '합포장에 묶인 배송 건은 방법을 바꿀 수 없습니다. 합포장을 먼저 해제해주세요.',
    dispatch_method_reason_required: '고객이 고른 방법과 다르면 사유를 입력해주세요.',
    delivery_policy_unavailable: '이 출고지에서 운영 조건이 켜지지 않은 방법입니다. 배송정보 관리의 운영 조건을 확인해주세요.',
    delivery_method_evidence_required: '발주확인이 끝난 배송 준비 건만 인계(발송)를 기록할 수 있습니다.',
    preorder_allocation_required: '예약 품목에 실제 입고 물량을 먼저 할당해주세요.',
    invalid_delivery_evidence: '실제 인계 담당자·업체·연락처·근거와, 발주확인 이후 지금까지의 인계 시각을 입력해주세요.',
    dispatch_delivery_unchanged: '이미 같은 방법이라 바꿀 내용이 없습니다.',
    invalid_dispatch_delivery_request: '방법·대상·사유를 확인해주세요.',
    operation_conflict: '같은 요청 번호에 다른 내용이 기록돼 있습니다. 새로고침한 뒤 다시 처리해주세요.',
    operator_capability_required: '현재 로그인 계정과 배송 처리 권한을 확인해주세요.',
  };
  return (code && messages[code]) || '처리 결과를 확인하지 못했습니다. 목록을 새로고침해 현재 상태를 확인해주세요.';
}
