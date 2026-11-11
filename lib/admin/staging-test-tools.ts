import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';

/** 스테이징 전용 테스트 도구(ADR-0025). 운영은 서버와 DB가 각각 거절한다. */
export const PRODUCTION_SUPABASE_PROJECT_REF = 'sbutbsghcxmxmxgrshwq';
export const PRODUCTION_SITE_HOST = 'iconsip.com';
export const ORDER_NUMBER_PATTERN = /^[0-9]{8}1[0-9]{7}$/;

export interface StagingTestDeliveryReceipt {
  orderId: string; orderNumber: string; status: string; deliveredShipments: number; orderCount: number; deliveredAt: string;
}

export function parseStagingTestDeliveryReceipt(value: unknown): StagingTestDeliveryReceipt | null {
  return transactionRecord(value) && transactionExactKeys(value, ['orderId', 'orderNumber', 'status', 'deliveredShipments', 'orderCount', 'deliveredAt'])
    && isUuid(value.orderId) && typeof value.orderNumber === 'string' && ORDER_NUMBER_PATTERN.test(value.orderNumber)
    && typeof value.status === 'string' && transactionInteger(value.deliveredShipments, 1) && transactionInteger(value.orderCount, 1) && transactionInstant(value.deliveredAt)
    ? value as unknown as StagingTestDeliveryReceipt : null;
}

export function stagingTestDeliveryError(code?: string, message?: string) {
  if (message?.includes('staging_test_delivery_unavailable')) return '이 환경에서는 테스트 배송완료를 사용할 수 없습니다.';
  if (message?.includes('operator_capability_required') || ['42501', '28000'].includes(code ?? '')) return '현재 로그인 계정과 주문 관리 권한을 확인해주세요.';
  if (message?.includes('order_not_found')) return '주문번호에 해당하는 주문이 없습니다.';
  if (message?.includes('requires_confirmed')) return '발주확인 뒤 발송 전·배송 중인 주문만 테스트 배송완료할 수 있습니다.';
  if (message?.includes('parcel_only')) return '택배 배송 건만 테스트 배송완료할 수 있습니다. 다른 배송 방식은 주문 상세의 인계·수령 확인을 사용합니다.';
  if (message?.includes('cancellation in progress')) return '취소 요청이 진행 중인 주문입니다. 클레임을 먼저 정리해주세요.';
  if (message?.includes('nothing_to_deliver')) return '배송완료로 옮길 배송 건이 없습니다.';
  if (message?.includes('shipment_pack_changed')) return '합포장 구성이 바뀌었습니다. 새로고침 후 다시 시도해주세요.';
  if (message?.includes('invalid_staging_test_delivery')) return '주문번호 16자리를 확인해주세요.';
  return '처리 결과를 확인하지 못했습니다. 주문 상세에서 현재 상태를 확인해주세요.';
}
