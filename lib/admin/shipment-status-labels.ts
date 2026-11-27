import type { ShipmentStatus } from '@/lib/orders/shipments';
import { DELIVERY_METHOD_LABELS, deliveryStatusLabel, type DeliveryMethod } from '@/lib/shipment-delivery';

/*
 * 어드민에서 부르는 배송 건 상태 이름(화면 규칙 4 — 같은 것은 이름 하나).
 * 발주·발송 탭과 주문 상태가 쓰는 말(발송 대기 · 배송중 · 배송완료)과 같다.
 * 고객 화면은 '배송 준비 · 배송 중 · 배송 완료'(lib/orders/shipments.ts, lib/shipment-delivery.ts)를 그대로 쓴다 — 그 이름표는 바꾸지 않는다.
 */
export const ADMIN_SHIPMENT_STATUS_LABELS: Readonly<Record<ShipmentStatus, string>> = {
  ready: '발송 대기', shipping: '배송중', delivered: '배송완료', canceled: '취소',
};

export function adminShipmentStatusLabel(status: ShipmentStatus): string {
  return ADMIN_SHIPMENT_STATUS_LABELS[status];
}

/** 목록·엑셀이 문자열로 받은 상태 값의 이름. 값이 없거나 모르는 값이면 null이다(영문 값을 그대로 보이지 않는다). */
export function adminShipmentStatusLabelOf(status: string | null | undefined): string | null {
  return status && Object.hasOwn(ADMIN_SHIPMENT_STATUS_LABELS, status) ? ADMIN_SHIPMENT_STATUS_LABELS[status as ShipmentStatus] : null;
}

/**
 * 택배 외 배송 건의 상태 이름. 퀵·직접배송·화물배송은 '퀵 배송중'처럼 방식 이름을 앞에 붙이고,
 * 방문수령·배송없음·디지털 파일은 단계가 달라 고객 화면과 같은 이름(방문수령 준비·완료 등)을 쓴다.
 */
export function adminDeliveryStatusLabel(method: DeliveryMethod, status: ShipmentStatus): string {
  if (status === 'canceled' || method === 'digital' || method === 'none' || method === 'pickup') return deliveryStatusLabel(method, status);
  const label = ADMIN_SHIPMENT_STATUS_LABELS[status];
  return method === 'parcel' ? label : `${DELIVERY_METHOD_LABELS[method]} ${label}`;
}
