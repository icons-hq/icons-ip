import type { AdminOrderAddress, AdminOrderItemRecord, AdminOrderStatus } from './orders';

export const MAX_ORDER_NOTE_LENGTH = 2000;
export const isOrderDetailId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export type AdminOrderTimelineSource = 'order' | 'payment' | 'refund' | 'status' | 'shipment' | 'claim' | 'inquiry' | 'email' | 'note';
export interface AdminOrderTimelineEntry {
  id: string;
  source: AdminOrderTimelineSource;
  occurredAt: string;
  action: string;
  status?: string | null;
  amount?: number | null;
  provider?: string | null;
  actorName?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  body?: string | null;
  title?: string | null;
  relatedId?: string | null;
  claimType?: string | null;
}
/** Explicit staff projection from admin_order_detail; no provider secrets or raw ledger/audit payloads. */
export interface AdminOrderDetail {
  order: {
    id: string; userId: string; buyerName: string | null; buyerEmail: string | null;
    status: AdminOrderStatus; total: number; shippingFee: number; discountTotal: number;
    createdAt: string; shippingCarrier: string | null; trackingNumber: string | null;
    address: Partial<AdminOrderAddress>;
  };
  items: AdminOrderItemRecord[];
  timeline: AdminOrderTimelineEntry[];
}
