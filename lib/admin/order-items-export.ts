import { goodsCustomInputSummary } from '@/lib/goods-custom-inputs';
import { ORDER_CLAIM_STAGE_LABELS, ORDER_CLAIM_TYPE_LABELS } from '@/lib/orders/claims';
import { shipmentStatusLabel, type ShipmentStatus } from '@/lib/orders/shipments';
import { ADMIN_ORDER_SEARCH_FIELDS, ADMIN_ORDER_STATUS_LABELS } from './orders';
import { orderItemBuyerLabel, type AdminOrderItemFilters, type AdminOrderItemRow } from './order-items';
import { kstDateTimeText, listExportPeriodLabel, type AdminListExportSheet } from './list-export';
import { listExportPaymentMethodLabel } from './list-export-sheets';
import { SALES_DATE_FIELDS, SALES_SORT_OPTIONS } from './sales-list';
import { ADMIN_VOCABULARY } from './vocabulary';


export function orderItemsExportSheet(rows: AdminOrderItemRow[], filters: AdminOrderItemFilters, fingerprint: string): AdminListExportSheet {
  // 재고 부족 부분 취소(ADR-0032)가 있는 행이 있을 때만 '취소 수량' 열을 둔다. 수량·상품 금액·실결제액은 남은 몫이다.
  const partial = rows.some(row => row.partialCancel);
  return {
    screen: 'orders', title: '상품주문별 조회', recordCount: rows.length,
    columns: [
      { header: '상품주문번호', kind: 'code', width: 22 }, { header: '주문번호', kind: 'code', width: 22 },
      { header: '주문 상태', kind: 'text', width: 12 }, { header: '주문일시', kind: 'text', width: 17 },
      { header: '상품 URL', kind: 'code', width: 28 }, { header: '상품명', kind: 'text', width: 36 },
      { header: '옵션', kind: 'text', width: 20 }, { header: '옵션코드', kind: 'code', width: 18 },
      { header: '직접 입력 옵션', kind: 'text', width: 36 }, { header: '수량', kind: 'count', width: 8 },
      ...(partial ? [{ header: '취소 수량', kind: 'count' as const, width: 10 }] : []),
      { header: '판매가', kind: 'amount', width: 12 }, { header: '상품 금액', kind: 'amount', width: 12 },
      { header: '복수구매 할인(품목)', kind: 'amount', width: 18 }, { header: '쿠폰 할인(품목)', kind: 'amount', width: 18 },
      { header: '적립금 사용(품목)', kind: 'amount', width: 18 }, { header: '품목 실결제액(배송비 제외)', kind: 'amount', width: 24 },
      { header: '구매자', kind: 'text', width: 16 }, { header: '수취인', kind: 'text', width: 12 },
      { header: '출고지', kind: 'text', width: 10 }, { header: '배송 상태', kind: 'text', width: 12 },
      { header: '택배사', kind: 'text', width: 12 }, { header: '운송장번호', kind: 'code', width: 18 },
      { header: ADMIN_VOCABULARY.claimRequest, kind: 'text', width: 20 },
    ],
    rows: rows.map(row => [row.productOrderNumber ?? row.id, row.orderNumber ?? row.orderId, ADMIN_ORDER_STATUS_LABELS[row.status], kstDateTimeText(row.createdAt), row.goodId,
      row.goodName, row.variantName, row.variantCode, goodsCustomInputSummary(row.customInputs), row.partialCancel?.activeQty ?? row.qty,
      ...(partial ? [row.partialCancel?.canceledQty ?? 0] : []), row.unitPrice, row.partialCancel?.activeItemAmount ?? row.itemAmount,
      row.allocation?.volumeDiscount ?? null, row.allocation?.couponDiscount ?? null, row.allocation?.storeCreditDiscount ?? null,
      row.allocation ? row.allocation.paidGoodsTotal - (row.partialCancel?.paidAmount ?? 0) : null,
      orderItemBuyerLabel(row), row.recipientName, row.originName,
      row.shipmentStatus ? shipmentStatusLabel(row.shipmentStatus as ShipmentStatus) ?? null : null,
      row.carrierLabel, row.trackingNumber, row.claim ? `${ORDER_CLAIM_TYPE_LABELS[row.claim.type]} · ${ORDER_CLAIM_STAGE_LABELS[row.claim.stage]}` : null]),
    conditions: [['조회 단위', '상품주문별'],
      ['검색 대상', filters.field === 'item' ? '상품주문번호' : ADMIN_ORDER_SEARCH_FIELDS.find(field => field.value === filters.field)?.label ?? '전체'],
      ['검색어', filters.query || '전체'], ['주문 상태', filters.status === 'all' ? '전체 상태' : ADMIN_ORDER_STATUS_LABELS[filters.status]],
      [SALES_DATE_FIELDS.find(option => option.value === (filters.dateField ?? 'ordered'))!.label, listExportPeriodLabel(filters.from, filters.to)],
      ['정렬', SALES_SORT_OPTIONS.find(option => option.value === (filters.sort ?? 'newest'))!.label],
      ['결제수단', filters.paymentMethod ? listExportPaymentMethodLabel(filters.paymentMethod) : '전체'],
      ['중복 제외 주문 수', String(new Set(rows.map(row => row.orderId)).size)]],
    notes: ['한 행은 상품주문 한 개입니다. 상품명·옵션·판매가는 주문 당시 기록입니다.',
      '상품 금액은 판매가 × 수량입니다. 품목 배분 열은 주문의 복수구매·쿠폰·적립금을 거래확정 엑셀과 같은 규칙으로 품목에 나눈 값이며 배송비는 포함하지 않습니다. 주문 당시 기록이 없어 나눌 수 없으면 빈칸입니다.',
      '취소·반품·환급 및 발주확인의 처리 단위는 주문 전체입니다.',
      ...(partial ? ['취소 수량은 재고 부족 부분 취소로 뺀 수량입니다. 그 행의 수량·상품 금액·품목 실결제액은 남은 몫이고, 복수구매·쿠폰·적립금 배분 열은 주문 당시 값입니다.'] : [])],
    filters: { view: 'items', field: filters.field, query: filters.query || null, status: filters.status, from: filters.from, to: filters.to,
      dateField: filters.dateField ?? 'ordered', paymentMethod: filters.paymentMethod ?? null, sort: filters.sort ?? 'newest', fingerprint },
  };
}
