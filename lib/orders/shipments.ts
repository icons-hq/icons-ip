import { orderShipment, type ShippingCarrierRegistry } from './shipment';
import { parseRegionalShippingSnapshot, type RegionalShippingSnapshot } from '../shipping-regions';
import { parseShipmentDeliverySummary, type ShipmentDeliverySummary } from '../shipment-delivery';

export type ShipmentStatus = 'ready' | 'shipping' | 'delivered' | 'canceled';
/** One frozen origin group; tracking can be absent while the parcel is being prepared. */
export interface ShipmentRecord {
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
  delivery?: ShipmentDeliverySummary | null;
}
export interface ShipmentRow {
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
}
export const SHIPMENT_SELECT = 'id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at,exported_at,original_expected_ship_date,expected_ship_date,preorder_ready:shipment_preorder_ready,delivery:shipment_delivery_summary,order_shipment_items(order_item_id)';
export function shipmentRecord(row: ShipmentRow, registry: ShippingCarrierRegistry): ShipmentRecord {
  const tracking = orderShipment(registry, row.carrier, row.tracking_number);
  return {
    id: row.id, orderId: row.order_id, originId: row.origin_id, originName: row.origin_name_snapshot,
    shippingFee: row.shipping_fee, status: row.status, carrier: row.carrier,
    carrierLabel: tracking?.carrierLabel ?? row.carrier, trackingNumber: row.tracking_number,
    trackingUrl: tracking?.trackingUrl ?? null, shippedAt: row.shipped_at, deliveredAt: row.delivered_at,
    exportedAt: row.exported_at, orderItemIds: row.order_shipment_items.map(item => item.order_item_id),
    originalExpectedShipDate: row.original_expected_ship_date ?? null,
    expectedShipDate: row.expected_ship_date ?? null,
    preorderReady: row.preorder_ready ?? true,
    regionalShipping: parseRegionalShippingSnapshot(row.shipping_fee_snapshot),
    delivery: row.delivery === undefined ? undefined : parseShipmentDeliverySummary(row.delivery),
  };
}
export function shipmentStatusLabel(status: ShipmentStatus): string {
  return { ready: '배송 준비', shipping: '배송 중', delivered: '배송 완료', canceled: '취소' }[status];
}
