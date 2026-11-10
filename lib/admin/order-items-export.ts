import { goodsCustomInputSummary } from '@/lib/goods-custom-inputs';
import { ORDER_CLAIM_STAGE_LABELS, ORDER_CLAIM_TYPE_LABELS } from '@/lib/orders/claims';
import { ADMIN_ORDER_STATUS_LABELS } from './orders';
import type { AdminOrderItemFilters, AdminOrderItemRow } from './order-items';
import { kstDateTimeText, type AdminListExportSheet } from './list-export';

export function orderItemsExportSheet(rows: AdminOrderItemRow[], filters: AdminOrderItemFilters, fingerprint: string): AdminListExportSheet {
  return {
    screen: 'orders', title: '상품주문별 조회', recordCount: rows.length,
    columns: [
      { header: '상품주문번호', kind: 'code', width: 38 }, { header: '주문번호', kind: 'code', width: 38 },
      { header: '주문상태', kind: 'text', width: 12 }, { header: '주문일시 (KST)', kind: 'text', width: 20 },
      { header: '상품 ID', kind: 'code', width: 28 }, { header: '상품명 (주문 당시)', kind: 'text', width: 36 },
      { header: '옵션', kind: 'text', width: 20 }, { header: '옵션코드', kind: 'code', width: 18 },
      { header: '직접 입력 옵션', kind: 'text', width: 36 }, { header: '수량', kind: 'count', width: 8 },
      { header: '단가', kind: 'amount', width: 12 }, { header: '상품금액 (혜택·배송비 배분 전)', kind: 'amount', width: 24 },
      { header: '복수구매 할인 (품목 배분)', kind: 'amount', width: 22 }, { header: '쿠폰 할인 (품목 배분)', kind: 'amount', width: 20 },
      { header: '적립금 사용 (품목 배분)', kind: 'amount', width: 20 }, { header: '배분 후 금액 (배송비 제외)', kind: 'amount', width: 24 },
      { header: '구매자명', kind: 'text', width: 14 }, { header: '수취인명', kind: 'text', width: 14 },
      { header: '출고지', kind: 'text', width: 20 }, { header: '배송상태', kind: 'text', width: 12 },
      { header: '택배사', kind: 'text', width: 14 }, { header: '송장번호', kind: 'code', width: 24 },
      { header: '취소·반품·교환', kind: 'text', width: 20 },
    ],
    rows: rows.map(row => [row.productOrderNumber ?? row.id, row.orderNumber ?? row.orderId, ADMIN_ORDER_STATUS_LABELS[row.status], kstDateTimeText(row.createdAt), row.goodId,
      row.goodName, row.variantName, row.variantCode, goodsCustomInputSummary(row.customInputs), row.qty, row.unitPrice, row.itemAmount,
      row.allocation?.volumeDiscount ?? null, row.allocation?.couponDiscount ?? null, row.allocation?.storeCreditDiscount ?? null, row.allocation?.paidGoodsTotal ?? null,
      row.buyerName, row.recipientName, row.originName,
      ({ ready: '발송대기', shipping: '배송중', delivered: '배송완료', canceled: '취소' } as Record<string, string>)[row.shipmentStatus ?? ''] ?? null,
      row.carrierLabel, row.trackingNumber, row.claim ? `${ORDER_CLAIM_TYPE_LABELS[row.claim.type]} · ${ORDER_CLAIM_STAGE_LABELS[row.claim.stage]}` : null]),
    conditions: [['조회 단위', '상품주문별'], ['검색 대상', filters.field], ['검색어', filters.query || '전체'], ['주문상태', filters.status === 'all' ? '전체' : ADMIN_ORDER_STATUS_LABELS[filters.status]],
      ['날짜 기준', filters.dateField ?? 'ordered'], ['시작일', filters.from ?? '제한 없음'], ['종료일', filters.to ?? '제한 없음'],
      ['정렬', filters.sort ?? 'newest'], ['결제수단', filters.paymentMethod ?? '전체'], ['중복 제외 주문 수', String(new Set(rows.map(row => row.orderId)).size)]],
    notes: ['한 행은 상품주문 한 개입니다. 상품명·옵션·단가는 주문 당시 기록입니다.',
      '상품금액은 단가 × 수량입니다. 품목 배분 열은 주문의 복수구매·쿠폰·적립금을 거래확정 엑셀과 같은 규칙으로 품목에 나눈 값이며 배송비는 포함하지 않습니다. 주문 당시 기록이 없어 나눌 수 없으면 빈칸입니다.',
      '취소·반품·환급 및 발주확인의 처리 단위는 주문 전체입니다.'],
    filters: { view: 'items', field: filters.field, query: filters.query || null, status: filters.status, from: filters.from, to: filters.to,
      dateField: filters.dateField ?? 'ordered', paymentMethod: filters.paymentMethod ?? null, sort: filters.sort ?? 'newest', fingerprint },
  };
}
