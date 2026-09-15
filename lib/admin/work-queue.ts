import { adminOrdersHref, normalizeAdminOrderFilters, ADMIN_ORDER_STATUS_LABELS } from './orders';
import { adminInquiryHref, normalizeAdminInquiryFilters } from './inquiries';
import { normalizeShipmentFilters, shipmentConsoleHref } from './shipment-dispatch';
import { goodsListHref, normalizeGoodsListFilters } from './goods-list';
import type { GoodsReadinessReasonCode } from './goods-readiness';

export const ADMIN_WORK_QUEUES = [
  { id: 'orders', label: ADMIN_ORDER_STATUS_LABELS.paid, unit: '주문', description: '발주확인 대기 · 전체 기간', href: adminOrdersHref(normalizeAdminOrderFilters({ status: 'paid' })) },
  { id: 'ready', label: '발송 대기', unit: '배송 건', description: '발주확인 후 발송 전 · 전체 기간', href: shipmentConsoleHref('dispatch', normalizeShipmentFilters({ tab: 'ready' }, 'dispatch')) },
  { id: 'delayed', label: '발송 지연', unit: '배송 건', description: '발주·발송 목록의 기존 지연 기준', href: shipmentConsoleHref('dispatch', normalizeShipmentFilters({ tab: 'delayed' }, 'dispatch')) },
  { id: 'inquiries', label: '미응답 문의', unit: '문의', description: '미답변 상태 · 전체 기간', href: adminInquiryHref(normalizeAdminInquiryFilters({ status: 'open' })) },
  { id: 'goods', label: '상품 검토 대기', unit: '상품', description: '확인할 상품 전체 · 보관 제외', href: goodsListHref(normalizeGoodsListFilters({ readiness: 'review_required' })) },
] as const;
export type AdminWorkQueueId = typeof ADMIN_WORK_QUEUES[number]['id'];
export type AdminWorkQueueCount = { state: 'ready'; count: number } | { state: 'error'; count: null };
export interface AdminWorkQueueData {
  checkedAt: string;
  counts: Record<AdminWorkQueueId, AdminWorkQueueCount>;
  goodsReasons: { code: GoodsReadinessReasonCode; count: number; href: string }[];
}
