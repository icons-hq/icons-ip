import type { ShipmentRecord } from '@/lib/orders/shipments';
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
  shipmentId?: string | null;
  originName?: string | null;
  body?: string | null;
  title?: string | null;
  relatedId?: string | null;
  claimType?: string | null;
  /** 시스템이 남긴 감사 기록의 출처(예: 자동 발주확인 'auto_order_confirmation'). 운영자 처리는 비어 있다. */
  trigger?: string | null;
}
export interface AdminShipmentEmailJob {
  shipmentId: string;
  status: 'pending' | 'processing' | 'completed' | 'review';
  attempts: number;
  lastErrorCode: string | null;
  updatedAt: string;
}
/** Explicit staff projection from admin_order_detail; no provider secrets or raw ledger/audit payloads. */
export interface AdminOrderDetail {
  emailJobs: AdminShipmentEmailJob[];
  order: {
    orderNumber?: string;
    isGift?: boolean;
    transaction?: import('@/lib/goods-transaction').GoodsTransactionDisplay;
    id: string; userId: string; buyerName: string | null; buyerEmail: string | null;
    status: AdminOrderStatus; total: number; shippingFee: number; discountTotal: number; storeCreditTotal: number;
    createdAt: string;
    address: Partial<AdminOrderAddress>;
    addressNeedsReview?: boolean;
  };
  shipments: ShipmentRecord[];
  items: AdminOrderItemRecord[];
  /** 품목 id별 쿠폰·적립금·복수구매 배분(`lib/admin/item-allocation`). 나눌 수 없는 주문은 비어 있다. */
  itemAllocations?: Record<string, import('./item-allocation').OrderItemAllocation>;
  /** 배분 조회 자체가 실패했다. 나눌 수 없는 주문(빈 itemAllocations)과 구분해 '불러오지 못했다'고 안내한다. */
  itemAllocationsUnavailable?: true;
  timeline: AdminOrderTimelineEntry[];
}
