import { orderShipment, type ShippingCarrierRegistry } from './shipment';
import { parseRegionalShippingSnapshot, type RegionalShippingSnapshot } from '../shipping-regions';
import { parseShipmentDeliverySummary, type ShipmentDeliverySummary } from '../shipment-delivery';
import { hasShippingChargeDetails, parseShippingChargeSnapshot, shippingChargeRegionalSnapshot,
  type ShippingChargeDetails, type ShippingChargeRegionalSnapshot } from '../shipping-charge-groups';

export type ShipmentStatus = 'ready' | 'shipping' | 'delivered' | 'canceled';
/**
 * 배송 건의 추가(연결) 운송장(QNA-019). 부피가 큰 상품을 여러 상자로 나눠 보낼 때 대표 운송장(`trackingNumber`) 말고
 * 붙는 상자 번호다. 등록 순서대로이고, 대표와 같은 번호는 싣지 않는다.
 */
export interface ShipmentExtraTracking {
  id: string;
  carrier: string;
  carrierLabel: string;
  trackingNumber: string;
  trackingUrl: string | null;
}
/** One frozen origin group; tracking can be absent while the parcel is being prepared. */
export interface ShipmentRecord {
  shipmentNumber?: string;
  id: string;
  orderId: string;
  originId: string;
  originName: string;
  shippingFee: number;
  status: ShipmentStatus;
  carrier: string | null;
  carrierLabel: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  exportedAt: string | null;
  orderItemIds: string[];
  originalExpectedShipDate?: string | null;
  expectedShipDate?: string | null;
  preorderReady?: boolean;
  regionalShipping?: RegionalShippingSnapshot | null;
  chargeDetails?: ShippingChargeDetails;
  chargeRegional?: ShippingChargeRegionalSnapshot;
  delivery?: ShipmentDeliverySummary | null;
  /** 추가 운송장이 있을 때만 있다. 없으면 키가 없어 기존 화면·메일이 그대로다. */
  extraTrackings?: ShipmentExtraTracking[];
}
export interface ShipmentExtraTrackingRow { id: string; carrier: string; tracking_number: string; created_at: string }
export interface ShipmentRow {
  shipment_number?: string;
  id: string;
  order_id: string;
  origin_id: string;
  origin_name_snapshot: string;
  shipping_fee: number;
  status: ShipmentStatus;
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  exported_at: string | null;
  order_shipment_items: { order_item_id: string }[];
  original_expected_ship_date?: string | null;
  expected_ship_date?: string | null;
  preorder_ready?: boolean;
  shipping_fee_snapshot?: unknown;
  delivery?: unknown;
  /** 추가 운송장(RLS: 주문 본인·주문 조회 운영자). 옛 읽기·테스트 행에는 없을 수 있다. */
  extra_trackings?: ShipmentExtraTrackingRow[] | null;
}
export const SHIPMENT_SELECT = 'id,shipment_number,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at,exported_at,original_expected_ship_date,expected_ship_date,preorder_ready:shipment_preorder_ready,delivery:shipment_delivery_summary,order_shipment_items(order_item_id),extra_trackings:order_shipment_extra_trackings(id,carrier,tracking_number,created_at)';
/**
 * 추가 운송장 행을 화면 모양으로 바꾼다. 등록 순서(같으면 id)로 놓고, 대표 운송장과 같은 번호(대표를 정정해 겹친 경우)와
 * 레지스트리에 없는 택배사·형식이 틀린 번호는 뺀다 — 조회 링크가 틀린 번호를 고객에게 보이지 않는다.
 */
export function shipmentExtraTrackings(
  rows: readonly ShipmentExtraTrackingRow[] | null | undefined, registry: ShippingCarrierRegistry,
  representative: { carrier: string | null; trackingNumber: string | null },
): ShipmentExtraTracking[] {
  return [...(rows ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).flatMap(row => {
    const tracking = orderShipment(registry, row.carrier, row.tracking_number);
    if (!tracking || (tracking.carrier === representative.carrier && tracking.trackingNumber === representative.trackingNumber)) return [];
    return [{ id: row.id, carrier: tracking.carrier, carrierLabel: tracking.carrierLabel, trackingNumber: tracking.trackingNumber, trackingUrl: tracking.trackingUrl }];
  });
}
export function shipmentRecord(row: ShipmentRow, registry: ShippingCarrierRegistry): ShipmentRecord {
  const tracking = orderShipment(registry, row.carrier, row.tracking_number);
  const extraTrackings = shipmentExtraTrackings(row.extra_trackings, registry, { carrier: row.carrier, trackingNumber: row.tracking_number });
  const grouped = hasShippingChargeDetails(row.shipping_fee_snapshot);
  const chargeSnapshot = grouped ? parseShippingChargeSnapshot(row.shipping_fee_snapshot) : null;
  if (grouped && (!chargeSnapshot || chargeSnapshot.originId !== row.origin_id || chargeSnapshot.totalFee !== row.shipping_fee
    || chargeSnapshot.originName !== row.origin_name_snapshot)) throw new Error('shipment_shipping_charge_snapshot_invalid');
  return {
    id: row.id, ...(row.shipment_number ? { shipmentNumber: row.shipment_number } : {}), orderId: row.order_id, originId: row.origin_id, originName: row.origin_name_snapshot,
    shippingFee: row.shipping_fee, status: row.status, carrier: row.carrier,
    carrierLabel: tracking?.carrierLabel ?? row.carrier, trackingNumber: row.tracking_number,
    trackingUrl: tracking?.trackingUrl ?? null, shippedAt: row.shipped_at, deliveredAt: row.delivered_at,
    exportedAt: row.exported_at, orderItemIds: row.order_shipment_items.map(item => item.order_item_id),
    originalExpectedShipDate: row.original_expected_ship_date ?? null,
    expectedShipDate: row.expected_ship_date ?? null,
    preorderReady: row.preorder_ready ?? true,
    regionalShipping: parseRegionalShippingSnapshot(row.shipping_fee_snapshot),
    ...(chargeSnapshot ? { chargeDetails: chargeSnapshot.chargeDetails, chargeRegional: shippingChargeRegionalSnapshot(chargeSnapshot.chargeDetails) } : {}),
    delivery: row.delivery === undefined ? undefined : parseShipmentDeliverySummary(row.delivery),
    ...(extraTrackings.length ? { extraTrackings } : {}),
  };
}
export function shipmentStatusLabel(status: ShipmentStatus): string {
  return { ready: '배송 준비', shipping: '배송 중', delivered: '배송 완료', canceled: '취소' }[status];
}
