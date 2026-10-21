import { isCommerceNumber } from '@/lib/commerce-number';
import { goodsCustomInputSummary, type GoodsCustomInputSelection } from '@/lib/goods-custom-inputs';
import { DELIVERY_METHOD_LABELS } from '@/lib/shipment-delivery';
import { ADMIN_ORDER_STATUS_LABELS, type AdminOrderStatus } from './orders';
import type { AdminListExportSheet, ListExportCellKind, ListExportCellValue } from './list-export';
import format from './smartstore-delivery-format.json';

export interface SmartStoreDeliveryLine {
  shipmentId: string; itemId: string; orderId: string; shipmentUpdatedAt: string;
  orderNumber: string; productOrderNumber: string; shipmentNumber: string;
  status: AdminOrderStatus; deliveryMethod: keyof typeof DELIVERY_METHOD_LABELS;
  shippedAt: string | null; deliveredAt: string | null; paidAt: string | null;
  carrier: string | null; trackingNumber: string | null;
  buyerName: string; buyerId: string; buyerPhone: string | null;
  recipientName: string | null; phone: string | null; address: string | null; postalCode: string | null;
  goodId: string; goodCode: string | null; goodName: string; variantName: string | null;
  customInputs: GoodsCustomInputSelection | null; qty: number;
  productPrice: number | null; optionPrice: number | null;
  itemDiscount: number | null; sellerDiscount: number | null; itemTotal: number | null;
  shippingFee: number; shippingCollectFee: number; regionalShippingFee: number | null; shippingDiscount: number | null;
}

const dateHeaders = new Set(['발송처리일', '결제일', '배송완료일', '구매확정 요청일', '문제송장 등록일', '자동구매확정예정일', '구매확정연장 설정일']);
const amountHeaders = new Set(['상품가격', '옵션가격', '최종 상품별 할인액', '최초 상품별 할인액', '판매자 부담 할인액', '최종 상품별 총 주문금액', '최초 상품별 총 주문금액', '배송비 합계', '제주/도서 추가배송비', '배송비 할인액']);
const codeHeaders = new Set(['상품주문번호', '주문번호', '송장번호', '구매자ID', '상품번호', '판매자 상품코드', '판매자 내부코드1', '판매자 내부코드2', '배송비 묶음번호', '수취인연락처1', '수취인연락처2', '구매자연락처', '우편번호']);

export const SMARTSTORE_DELIVERY_COLUMNS = format.headers.map(header => ({
  header, width: format.columnWidth,
  kind: (dateHeaders.has(header) ? 'date' : amountHeaders.has(header) ? 'amount' : codeHeaders.has(header) ? 'code' : header === '수량' ? 'count' : 'text') as ListExportCellKind,
}));

/** Keep the supplied 53-column contract. Unrecorded/Naver-only facts stay blank. */
export function smartStoreDeliveryListSheet(base: AdminListExportSheet, lines: SmartStoreDeliveryLine[]): AdminListExportSheet {
  const shipments = new Set<string>(), items = new Set<string>();
  const rows = lines.map(line => {
    if (!isCommerceNumber(line.orderNumber, 'order') || !isCommerceNumber(line.productOrderNumber, 'item') || !isCommerceNumber(line.shipmentNumber, 'shipment')
      || items.has(line.itemId) || !Number.isSafeInteger(line.qty) || line.qty < 1) throw new Error('상품주문번호와 수량을 확인하지 못했습니다. 목록을 새로고침해주세요.');
    items.add(line.itemId);
    const firstShipmentLine = !shipments.has(line.shipmentId);
    shipments.add(line.shipmentId);
    for (const amount of [line.productPrice, line.optionPrice, line.itemDiscount, line.sellerDiscount, line.itemTotal, line.shippingFee, line.shippingCollectFee, line.regionalShippingFee, line.shippingDiscount]) {
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) throw new Error('상품주문 금액 정보를 확인하지 못했습니다.');
    }
    const shipping = line.shippingFee + line.shippingCollectFee;
    if (!Number.isSafeInteger(shipping)) throw new Error('배송비 정보를 확인하지 못했습니다.');
    const options = [line.variantName, goodsCustomInputSummary(line.customInputs)].filter(Boolean).join(' / ');
    const values: Record<string, ListExportCellValue> = {
      상품주문번호: line.productOrderNumber, 주문번호: line.orderNumber, 발송처리일: line.shippedAt,
      주문상태: ADMIN_ORDER_STATUS_LABELS[line.status], 배송방법: line.deliveryMethod === 'parcel' ? '택배,등기,소포' : DELIVERY_METHOD_LABELS[line.deliveryMethod],
      택배사: line.carrier, 송장번호: line.trackingNumber, 판매채널: 'ICONS', 구매자명: line.buyerName,
      구매자ID: line.buyerId, 수취인명: line.recipientName, 상품번호: line.goodId, 상품명: line.goodName,
      옵션정보: options || null, 수량: line.qty, 상품가격: line.productPrice, 옵션가격: line.optionPrice,
      '최종 상품별 할인액': line.itemDiscount, '최초 상품별 할인액': line.itemDiscount, '판매자 부담 할인액': line.sellerDiscount,
      '최종 상품별 총 주문금액': line.itemTotal, '최초 상품별 총 주문금액': line.itemTotal,
      결제일: line.paidAt, 배송완료일: line.deliveredAt, '판매자 상품코드': line.goodCode,
      '배송비 묶음번호': line.shipmentNumber,
      '배송비 형태': shipping === 0 ? '무료' : line.shippingCollectFee > 0 ? line.shippingFee > 0 ? '선결제/착불' : '착불' : '선결제',
      '배송비 합계': firstShipmentLine ? shipping : 0,
      '제주/도서 추가배송비': firstShipmentLine ? line.regionalShippingFee : 0,
      '배송비 할인액': firstShipmentLine ? line.shippingDiscount : 0,
      수취인연락처1: line.phone, 배송지: line.address, 구매자연락처: line.buyerPhone, 우편번호: line.postalCode,
    };
    return format.headers.map(header => values[header] ?? null);
  });
  if (shipments.size !== base.recordCount) throw new Error('내려받는 동안 배송 목록이 변경되었습니다. 다시 내려받아 주세요.');
  return { ...base, title: format.sheetName, layout: 'smartstore-delivery', columns: SMARTSTORE_DELIVERY_COLUMNS, rows,
    notes: ['스마트스토어 배송현황관리 53열 양식입니다. 한 행은 상품주문 한 개입니다.',
      '배송비는 배송비 묶음번호의 첫 행에 한 번만 기록합니다. 네이버 전용 정보와 기록되지 않은 금액·날짜는 빈칸입니다.'] };
}
