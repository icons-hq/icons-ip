import { adminOrdersHref, normalizeAdminOrderFilters, ADMIN_ORDER_STATUS_LABELS } from './orders';
import { adminInquiryHref, normalizeAdminInquiryFilters } from './inquiries';
import { normalizeShipmentFilters, shipmentConsoleHref } from './shipment-dispatch';
import { goodsListHref, normalizeGoodsListFilters } from './goods-list';
import type { GoodsReadinessReasonCode } from './goods-readiness';
import { adminUnpaidHref } from './unpaid';
import { refundTransfersHref } from './refund-transfers';

export const ADMIN_WORK_QUEUES = [
  { id: 'orders', label: ADMIN_ORDER_STATUS_LABELS.paid, unit: '주문', description: '발주확인 대기 · 전체 기간', href: adminOrdersHref(normalizeAdminOrderFilters({ status: 'paid' })) },
  { id: 'ready', label: '발송 대기', unit: '배송 건', description: '발주확인 후 발송 전 · 전체 기간', href: shipmentConsoleHref('dispatch', normalizeShipmentFilters({ tab: 'ready' }, 'dispatch')) },
  { id: 'delayed', label: '발송 지연', unit: '배송 건', description: '발주·발송 목록의 기존 지연 기준', href: shipmentConsoleHref('dispatch', normalizeShipmentFilters({ tab: 'delayed' }, 'dispatch')) },
  { id: 'inquiries', label: '미답변 문의', unit: '문의', description: '미답변 상태 · 전체 기간', href: adminInquiryHref(normalizeAdminInquiryFilters({ status: 'open' })) },
  { id: 'goods', label: '상품 검토 대기', unit: '상품', description: '확인할 상품 전체 · 보관 제외', href: goodsListHref(normalizeGoodsListFilters({ readiness: 'review_required' })) },
  /*
   * 2026-11-05 IA 재정의 D4: 홈에 없던 돈 관련 대기열 두 개. `screenId` 화면을 열 수 있는 계정에만 집계·표시한다
   * (환불 송금 대기는 관리자 전용 화면). 목록 화면과 같은 RPC의 전체 건수를 읽는다.
   */
  { id: 'unpaid', label: '무통장 입금 대기', unit: '주문', description: '입금 확인 전 무통장 주문 · 전체 기간', href: adminUnpaidHref({}), screenId: 'unpaid' },
  { id: 'refundTransfers', label: '환불 송금 대기', unit: '환불', description: '계좌로 보낼 무통장 환불 · 전체 기간', href: refundTransfersHref(), screenId: 'refund-transfers' },
] as const;
export type AdminWorkQueueId = typeof ADMIN_WORK_QUEUES[number]['id'];
/** `hidden`: 이 계정이 목적지 화면을 열 수 없어 집계하지 않았다. 화면에 칸을 만들지 않는다. */
export type AdminWorkQueueCount = { state: 'ready'; count: number } | { state: 'error'; count: null } | { state: 'hidden'; count: null };
export interface AdminWorkQueueData {
  checkedAt: string;
  counts: Record<AdminWorkQueueId, AdminWorkQueueCount>;
  goodsReasons: { code: GoodsReadinessReasonCode; count: number; href: string }[];
}

/** 권한으로 가려진 대기열을 뺀 목록. 권한이 필요한 대기열은 집계를 시도한 경우(건수 또는 오류)에만 보인다. */
export function visibleAdminWorkQueues(data?: AdminWorkQueueData) {
  return ADMIN_WORK_QUEUES.filter((queue) => {
    if (!('screenId' in queue)) return true;
    const state = data?.counts[queue.id]?.state;
    return state === 'ready' || state === 'error';
  });
}
