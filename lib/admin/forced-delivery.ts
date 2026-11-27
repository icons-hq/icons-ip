import { isCommerceNumber } from '@/lib/commerce-number';
import { FULFILLMENT_METHOD_LABELS, FULFILLMENT_METHODS, type FulfillmentMethod } from '@/lib/goods-fulfillment';
import { isUuid } from '@/lib/uuid';
import { ADMIN_SALES_ACCESS_DENIED } from './vocabulary';

/*
 * 운영 강제 배송완료 — 1014-083(2026-11-11 결정 묶음 3 "운영 전체 주문 허용"). DB 계약은
 * admin_force_order_delivery_preview·admin_force_order_delivered(20261112130100)다. 화면은 주문을 고르고 [강제 배송완료]를 누르면
 * 미리보기로 대상(구매자·배송 건·합포장 동반 주문·출고지시 전달 여부)과 막는 사유를 읽고, 막는 사유가 없으면 대상·결과를 말하는
 * 확인창에서 사유(필수)를 받아 실행한다. 실행은 같은 요청 번호 재전송으로 감사에 남는다(사유는 audit_log에 남고, 택배 외 방식은 배송 방식·인계
 * 이력에도 남는다). 택배는 운송장 없이, 택배 외 방식은 '강제 배송완료' 증거로 옮긴다. 디지털 파일은 제외한다.
 */
export const FORCED_DELIVERY_REASON_MAX_LENGTH = 500;
/** 확인창의 사유 칸 이름·예시 글. 사유는 DB 함수가 필수로 받는 감사 기록이다. */
export const FORCED_DELIVERY_REASON_LABEL = '사유 (필수) · 감사 기록에 남습니다';
export const FORCED_DELIVERY_REASON_PLACEHOLDER = '예: 거래확정·리뷰 확인용 시험 주문';
/** 발주·발송 화면의 강제 배송완료 카드 앵커와, 주문번호를 미리 채워 여는 주소 검색어(QA1 S-T04-05). */
export const FORCED_DELIVERY_ANCHOR = 'forced-delivery';
export const FORCED_DELIVERY_ORDER_PARAM = 'forceDelivery';

/** 주문 상세(전용 화면·목록 위 팝업)에서 그 주문으로 강제 배송완료 카드를 연다. 사유·확인창·감사 규칙은 그대로다. */
export function forcedDeliveryHref(orderNumber: string): string {
  return `/admin/sales/dispatch?${FORCED_DELIVERY_ORDER_PARAM}=${encodeURIComponent(orderNumber)}#${FORCED_DELIVERY_ANCHOR}`;
}
export const FORCED_DELIVERY_BLOCKERS = ['requires_confirmed', 'nothing_to_deliver', 'claim_in_progress', 'digital_access_only', 'preorder_allocation_required', 'production_incomplete', 'fulfillment_hold'] as const;
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
    requires_confirmed: '발주확인 뒤 발송 전이거나 배송 중인 주문만 강제 배송완료할 수 있습니다. 신규주문은 먼저 발주확인해주세요.',
    nothing_to_deliver: '배송완료로 옮길 배송 건이 없습니다. 이미 배송완료됐거나 취소된 주문입니다.',
    claim_in_progress: '이 주문이나 함께 묶인 주문에 취소·반품·교환 요청이 있습니다. 취소·반품·교환 관리에서 먼저 처리해주세요.',
    digital_access_only: '디지털 파일 배송 건만 남았습니다. 디지털 파일은 구매자가 내려받는 순간부터 청약철회가 제한되므로 강제로 배송완료하지 않습니다. 시험 주문이면 구매자 계정으로 파일을 내려받아 주세요.',
    preorder_allocation_required: '예약 품목의 입고 확인이 아직 끝나지 않았습니다. 실물이 없는 배송 건은 배송완료로 기록할 수 없습니다. 상품 편집의 예약판매에서 이 주문을 골라 [선택한 예약 주문 입고 확인]을 먼저 눌러주세요.',
    production_incomplete: '주문제작 품목의 제작이 끝나지 않았습니다. 실물이 없는 배송 건은 배송완료로 기록할 수 없습니다. 제작 완료를 먼저 확인해주세요.',
    fulfillment_hold: '출고 보류(결제 확인 필요) 중인 주문에 아직 나가지 않은 배송 건이 있습니다. 주문 상세의 출고 보류 안내를 먼저 확인해주세요. 이미 발송된 배송 건만 남은 주문은 막지 않습니다.',
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

const SHIPMENT_STATUS_LABELS = { ready: '발송 대기', shipping: '배송중' } as const;

/** 배송 건을 '택배 발송 대기 2건, 퀵 발송 대기 1건'처럼 방법·상태별로 센다. */
function shipmentSummary(shipments: ForcedDeliveryPreview['shipments']): string {
  const counts = new Map<string, number>();
  for (const shipment of shipments) {
    const key = `${FULFILLMENT_METHOD_LABELS[shipment.method]} ${SHIPMENT_STATUS_LABELS[shipment.status]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, total]) => `${key} ${total}건`).join(', ');
}

/**
 * [강제 배송완료]의 확인창 글(어드민 확인창이 줄바꿈을 그대로 보인다). 맨 위에서 어느 주문인지(주문번호·구매자·상품·지금 상태·배송 건)를 말하고,
 * 실행하면 무엇이 시작되는지(고객 알림·반품·거래확정 기한)와 되돌리는 길을 말한다. 사유가 남는 곳은 사유 칸 이름이 말한다.
 * 확인창은 높이를 줄이지 못하므로 짧게 쓴다. 합포장으로 함께 처리되는 주문, 디지털 파일 배송 건, 창고에 출고지시를 이미 넘긴 배송 건은 있을 때만 덧붙인다.
 */
export function forcedDeliveryConfirmMessage(preview: ForcedDeliveryPreview, orderStatusLabel: string): string {
  const targets = forcedDeliveryTargets(preview), exported = forcedDeliveryExportedPending(preview);
  const digital = preview.shipments.filter(shipment => shipment.method === 'digital');
  const others = [...new Set(targets.flatMap(shipment => shipment.orderNumber && shipment.orderNumber !== preview.orderNumber ? [shipment.orderNumber] : []))];
  const product = preview.firstItemName ? `${preview.firstItemName}${preview.itemCount > 1 ? ` 외 ${preview.itemCount - 1}건` : ''}` : '상품 기록 없음';
  const lines = [
    `주문번호: ${preview.orderNumber}`,
    `구매자: ${preview.buyerName}`,
    `상품: ${product}`,
    `주문 상태: ${orderStatusLabel}`,
    `배송 건: ${shipmentSummary(targets)}`,
    '',
    '이 주문의 남은 배송 건을 배송완료로 기록하면',
    digital.length
      ? `· 디지털 파일 배송 건 ${digital.length}건은 구매자가 내려받을 때 완료되므로 뺍니다. 그 건이 남아 주문은 배송중이 되고, "배송이 시작됐어요" 앱 알림이 갈 수 있습니다. 배송 메일은 보내지 않습니다.`
      : '· 주문이 배송완료가 되고, 고객에게 앱 알림 "배송이 완료됐어요"가 갑니다. 배송 메일은 보내지 않습니다.',
    '· 배송완료 시각부터 반품 기한과 거래확정 기한을 셉니다.',
    '· 되돌리려면 주문 상세의 [배송완료 되돌리기]를 씁니다(택배 배송 건만). 이미 간 앱 알림은 회수할 수 없습니다.',
  ];
  if (preview.orderCount > 1) lines.push('', `합포장으로 묶인 주문 ${preview.orderCount}개가 함께 배송완료됩니다${others.length ? `(다른 주문: ${others.join(', ')})` : ''}.`);
  if (exported.length) lines.push('', `출고지시를 이미 보낸 배송 건 ${exported.length}건이 있습니다. 창고 출고는 멈추지 않으니, 보내지 않을 주문이면 창고에 출고 보류를 먼저 요청해주세요.`);
  return lines.join('\n');
}

export function forcedDeliveryError(code?: string, message?: string): string {
  if (message?.includes('operator_capability_required') || ['42501', '28000'].includes(code ?? '')) return ADMIN_SALES_ACCESS_DENIED;
  if (message?.includes('forced_delivery_order_not_found')) return '선택한 주문을 찾지 못했습니다. 주문을 다시 골라주세요.';
  if (message?.includes('invalid_forced_delivery')) return '주문을 다시 골라주세요.';
  if (message?.includes('forced_delivery_reason_required')) return `사유를 1~${FORCED_DELIVERY_REASON_MAX_LENGTH}자로 입력해주세요.`;
  if (message?.includes('forced_delivery_requires_confirmed')) return forcedDeliveryBlockerLabel('requires_confirmed');
  if (message?.includes('forced_delivery_nothing_to_deliver')) return forcedDeliveryBlockerLabel('nothing_to_deliver');
  if (message?.includes('forced_delivery_digital_access_only')) return forcedDeliveryBlockerLabel('digital_access_only');
  if (message?.includes('cancellation in progress')) return forcedDeliveryBlockerLabel('claim_in_progress');
  if (message?.includes('preorder_allocation_required')) return forcedDeliveryBlockerLabel('preorder_allocation_required');
  if (message?.includes('production_incomplete')) return forcedDeliveryBlockerLabel('production_incomplete');
  if (message?.includes('order fulfillment hold')) return forcedDeliveryBlockerLabel('fulfillment_hold');
  if (message?.includes('shipment_pack_changed')) return '합포장 구성이 바뀌었습니다. [강제 배송완료]를 다시 눌러 대상을 확인해주세요.';
  if (message?.includes('operation_conflict')) return '같은 처리가 다른 내용으로 이미 기록돼 있습니다. 주문 상세에서 지금 상태를 확인한 뒤 다시 처리해주세요.';
  return '처리 결과를 확인하지 못했습니다. 주문 상세에서 현재 상태를 확인해주세요.';
}
