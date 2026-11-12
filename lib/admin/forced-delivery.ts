import { isCommerceNumber } from '@/lib/commerce-number';
import { FULFILLMENT_METHODS, type FulfillmentMethod } from '@/lib/goods-fulfillment';
import { isUuid } from '@/lib/uuid';

/*
 * 운영 강제 배송완료 — 1014-083(2026-11-11 결정 묶음 3 "운영 전체 주문 허용"). DB 계약은
 * admin_force_order_delivery_preview·admin_force_order_delivered(20261112130100)다. 확인창은 미리보기로
 * 대상(구매자·배송 건·합포장 동반 주문·출고지시 전달 여부)과 막는 사유를 보이고, 실행은 사유 필수·같은 요청 번호
 * 재전송으로 감사에 남는다. 택배는 운송장 없이, 택배 외 방식은 '강제 배송완료' 증거로 옮긴다. 디지털 파일은 제외한다.
 */
export const FORCED_DELIVERY_REASON_MAX_LENGTH = 500;
export const FORCED_DELIVERY_BLOCKERS = ['requires_confirmed', 'nothing_to_deliver', 'claim_in_progress', 'digital_access_only', 'preorder_allocation_required', 'production_incomplete'] as const;
export type ForcedDeliveryBlocker = typeof FORCED_DELIVERY_BLOCKERS[number];

export interface ForcedDeliveryPreview {
  orderId: string; orderNumber: string; status: string; createdAt: string; buyerName: string; itemCount: number; firstItemName: string | null; orderCount: number;
  /** 함께 옮길 배송 건(합포장 포함)과 제외되는 이 주문의 디지털 파일 배송 건. */
  shipments: { id: string; shipmentNumber: string | null; orderNumber: string | null; originName: string; status: 'ready' | 'shipping'; method: FulfillmentMethod; carrier: string | null; trackingNumber: string | null; exportedAt: string | null }[];
  blockers: ForcedDeliveryBlocker[];
}
export interface ForcedDeliveryReceipt { orderId: string; orderNumber: string; status: string; deliveredShipments: number; orderCount: number; deliveredAt: string }

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** 입력한 주문번호를 숫자만 남겨 맞춘다. 주문번호 형식 판정은 주문번호 모듈(isCommerceNumber)을 따른다. */
export function normalizeForcedDeliveryOrderNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[\s-]/g, '');
  return isCommerceNumber(digits, 'order') ? digits : null;
}

export function parseForcedDeliveryPreview(value: unknown): ForcedDeliveryPreview | null {
  if (!record(value) || !isUuid(value.orderId) || !text(value.orderNumber) || !text(value.status) || !instant(value.createdAt) || typeof value.buyerName !== 'string'
    || !count(value.itemCount) || !(value.firstItemName === null || typeof value.firstItemName === 'string') || !count(value.orderCount)
    || !Array.isArray(value.shipments) || !Array.isArray(value.blockers)
    || value.blockers.some(blocker => !FORCED_DELIVERY_BLOCKERS.includes(blocker as ForcedDeliveryBlocker))) return null;
  const shipments: ForcedDeliveryPreview['shipments'] = [];
  for (const row of value.shipments) {
    if (!record(row) || !isUuid(row.id) || typeof row.originName !== 'string' || !['ready', 'shipping'].includes(String(row.status))
      || !FULFILLMENT_METHODS.includes(row.method as FulfillmentMethod) || [row.shipmentNumber, row.orderNumber, row.carrier, row.trackingNumber].some(field => field !== null && typeof field !== 'string')
      || !(row.exportedAt === null || instant(row.exportedAt))) return null;
    shipments.push({ id: row.id, shipmentNumber: row.shipmentNumber as string | null, orderNumber: row.orderNumber as string | null, originName: row.originName,
      status: row.status as 'ready' | 'shipping', method: row.method as FulfillmentMethod, carrier: row.carrier as string | null, trackingNumber: row.trackingNumber as string | null,
      exportedAt: row.exportedAt as string | null });
  }
  return { orderId: value.orderId, orderNumber: value.orderNumber, status: value.status, createdAt: value.createdAt, buyerName: value.buyerName, itemCount: value.itemCount,
    firstItemName: value.firstItemName as string | null, orderCount: value.orderCount, shipments, blockers: value.blockers as ForcedDeliveryBlocker[] };
}

export function parseForcedDeliveryReceipt(value: unknown): ForcedDeliveryReceipt | null {
  if (!record(value) || !isUuid(value.orderId) || !text(value.orderNumber) || !text(value.status) || !count(value.deliveredShipments, 1) || !count(value.orderCount, 1)
    || !instant(value.deliveredAt) || Object.keys(value).length !== 6) return null;
  return { orderId: value.orderId, orderNumber: value.orderNumber, status: value.status, deliveredShipments: value.deliveredShipments, orderCount: value.orderCount, deliveredAt: value.deliveredAt };
}

export function forcedDeliveryBlockerLabel(blocker: ForcedDeliveryBlocker): string {
  return {
    requires_confirmed: '발주확인 뒤 발송 전·배송 중인 주문만 강제 배송완료할 수 있습니다. 신규주문은 먼저 발주확인해주세요.',
    nothing_to_deliver: '배송완료로 옮길 배송 건이 없습니다. 이미 배송완료됐거나 취소된 주문입니다.',
    claim_in_progress: '취소·반품·교환 요청이 진행 중인 주문이 있습니다. 클레임을 먼저 정리해주세요(예외).',
    digital_access_only: '디지털 파일 배송 건만 남았습니다. 디지털 파일은 구매자가 내려받을 때 제공 시작으로 기록되고 그때부터 청약철회가 제한되므로 강제로 기록하지 않습니다(예외). 시험 주문이면 구매자 계정으로 파일을 내려받아 주세요.',
    preorder_allocation_required: '예약 품목에 실제 입고 물량이 할당되지 않았습니다. 실물이 없는 배송 건은 재고 기준상 배송완료로 기록하지 않습니다(예외). 예약 재고를 먼저 할당해주세요.',
    production_incomplete: '주문제작 품목의 제작이 끝나지 않았습니다. 실물이 없는 배송 건은 배송완료로 기록하지 않습니다(예외). 제작 완료를 먼저 확인해주세요.',
  }[blocker];
}

/** 이번에 배송완료로 옮길 배송 건(디지털 파일 제외). */
export function forcedDeliveryTargets(preview: ForcedDeliveryPreview) {
  return preview.shipments.filter(shipment => shipment.method !== 'digital');
}

/** 출고지시를 창고에 이미 전달했지만 아직 발송 전인 택배 배송 건 — 창고가 실제로 출고할 수 있다. */
export function forcedDeliveryExportedPending(preview: ForcedDeliveryPreview) {
  return forcedDeliveryTargets(preview).filter(shipment => shipment.status === 'ready' && shipment.exportedAt !== null);
}

export function forcedDeliveryError(code?: string, message?: string): string {
  if (message?.includes('operator_capability_required') || ['42501', '28000'].includes(code ?? '')) return '현재 로그인 계정과 배송 처리 권한을 확인해주세요.';
  if (message?.includes('forced_delivery_order_not_found')) return '주문번호에 해당하는 주문이 없습니다.';
  if (message?.includes('invalid_forced_delivery')) return '주문번호 전체를 확인해주세요.';
  if (message?.includes('forced_delivery_reason_required')) return `사유를 1~${FORCED_DELIVERY_REASON_MAX_LENGTH}자로 입력해주세요.`;
  if (message?.includes('forced_delivery_requires_confirmed')) return forcedDeliveryBlockerLabel('requires_confirmed');
  if (message?.includes('forced_delivery_nothing_to_deliver')) return forcedDeliveryBlockerLabel('nothing_to_deliver');
  if (message?.includes('forced_delivery_digital_access_only')) return forcedDeliveryBlockerLabel('digital_access_only');
  if (message?.includes('cancellation in progress')) return forcedDeliveryBlockerLabel('claim_in_progress');
  if (message?.includes('preorder_allocation_required')) return forcedDeliveryBlockerLabel('preorder_allocation_required');
  if (message?.includes('production_incomplete')) return forcedDeliveryBlockerLabel('production_incomplete');
  if (message?.includes('shipment_pack_changed')) return '합포장 구성이 바뀌었습니다. 대상을 다시 확인해주세요.';
  if (message?.includes('operation_conflict')) return '같은 요청 번호에 다른 내용이 기록돼 있습니다. 대상을 다시 확인한 뒤 처리해주세요.';
  return '처리 결과를 확인하지 못했습니다. 주문 상세에서 현재 상태를 확인해주세요.';
}
