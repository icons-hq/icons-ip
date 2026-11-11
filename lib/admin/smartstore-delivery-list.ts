import { isCommerceNumber } from '@/lib/commerce-number';
import { goodsCustomInputSummary, type GoodsCustomInputSelection } from '@/lib/goods-custom-inputs';
import { DELIVERY_METHOD_LABELS } from '@/lib/shipment-delivery';
import { ADMIN_ORDER_STATUS_LABELS, type AdminOrderStatus } from './orders';
import type { AdminListExportSheet, ListExportCellValue } from './list-export';
import { listExportPaymentMethodLabel, type ListExportContact } from './list-export-sheets';
import type { ShipmentConsoleRow } from './shipment-dispatch';
import { ICONS_DELAY_COLUMNS, ICONS_DELIVERY_LIST_COLUMNS, iconsStandardBuyerName, iconsStandardDateText, shippingChargeLabel } from './smartstore-shipment-workbook';

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

export type DeliveryListSheetBase = Omit<AdminListExportSheet, 'columns' | 'rows'>;
type DeliveryListShipment = Pick<ShipmentConsoleRow, 'id' | 'orderId' | 'originName' | 'createdAt' | 'confirmedAt' | 'paymentMethod' | 'expectedShipDate' | 'delayReason'>;

/** 배송 건의 상품 한 줄이 한 행인 ICONS 표준 양식 목록. 품목 값은 조회 RPC, 출고지·일시·결제수단은 화면 행, 배송메시지는 주문 배송지에서 읽는다. */
export function smartStoreDeliveryListSheet(
  base: DeliveryListSheetBase,
  lines: SmartStoreDeliveryLine[],
  source: { shipments: readonly DeliveryListShipment[]; contacts: ReadonlyMap<string, ListExportContact | null> },
): AdminListExportSheet {
  const columns = base.filters.tab === 'delayed' ? [...ICONS_DELIVERY_LIST_COLUMNS, ...ICONS_DELAY_COLUMNS] : [...ICONS_DELIVERY_LIST_COLUMNS];
  const shipmentsById = new Map(source.shipments.map(shipment => [shipment.id, shipment]));
  const shipments = new Set<string>(), items = new Set<string>();
  const rows = lines.map(line => {
    if (!isCommerceNumber(line.orderNumber, 'order') || !isCommerceNumber(line.productOrderNumber, 'item') || !isCommerceNumber(line.shipmentNumber, 'shipment')
      || items.has(line.itemId) || !Number.isSafeInteger(line.qty) || line.qty < 1) throw new Error('상품주문번호와 수량을 확인하지 못했습니다. 목록을 새로고침해주세요.');
    items.add(line.itemId);
    const shipment = shipmentsById.get(line.shipmentId);
    if (!shipment) throw new Error('내려받는 동안 배송 목록이 변경되었습니다. 다시 내려받아 주세요.');
    const firstShipmentLine = !shipments.has(line.shipmentId);
    shipments.add(line.shipmentId);
    for (const amount of [line.itemDiscount, line.itemTotal, line.shippingFee, line.shippingCollectFee, line.regionalShippingFee, line.shippingDiscount]) {
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) throw new Error('상품주문 금액 정보를 확인하지 못했습니다.');
    }
    const shipping = line.shippingFee + line.shippingCollectFee;
    if (!Number.isSafeInteger(shipping)) throw new Error('배송비 정보를 확인하지 못했습니다.');
    const options = [line.variantName, goodsCustomInputSummary(line.customInputs)].filter(Boolean).join(' / ');
    const values: Record<string, ListExportCellValue> = {
      주문번호: line.orderNumber, 상품주문번호: line.productOrderNumber, 배송건번호: line.shipmentNumber,
      구매자: iconsStandardBuyerName(line.buyerName, line.buyerId), 수취인: line.recipientName, 연락처: line.phone, 우편번호: line.postalCode, 주소: line.address,
      배송메시지: source.contacts.get(line.orderId)?.deliveryNote || null,
      출고지: shipment.originName, '배송 방식': DELIVERY_METHOD_LABELS[line.deliveryMethod] ?? null, 택배사: line.carrier, 운송장번호: line.trackingNumber,
      상품번호: line.goodId, 상품코드: line.goodCode, 상품명: line.goodName, 옵션: options || null, 수량: line.qty,
      '상품별 할인액': line.itemDiscount, '품목 실결제액(배송비 제외)': line.itemTotal,
      결제일: iconsStandardDateText(line.paidAt), 결제수단: listExportPaymentMethodLabel(shipment.paymentMethod) || null,
      주문일시: iconsStandardDateText(shipment.createdAt), 발주확인일: iconsStandardDateText(shipment.confirmedAt), '발송 예정일': iconsStandardDateText(shipment.expectedShipDate),
      발송처리일: iconsStandardDateText(line.shippedAt), 배송완료일: iconsStandardDateText(line.deliveredAt),
      '주문 상태': ADMIN_ORDER_STATUS_LABELS[line.status],
      '배송비 형태': shippingChargeLabel(line.shippingFee, line.shippingCollectFee),
      '배송비 합계': firstShipmentLine ? shipping : 0,
      '제주/도서 추가배송비': firstShipmentLine ? line.regionalShippingFee : 0,
      '배송비 할인액': firstShipmentLine ? line.shippingDiscount : 0,
      '지연 메모': shipment.delayReason,
    };
    return columns.map(column => values[column.header] ?? null);
  });
  if (shipments.size !== base.recordCount) throw new Error('내려받는 동안 배송 목록이 변경되었습니다. 다시 내려받아 주세요.');
  return { ...base, columns, rows };
}
