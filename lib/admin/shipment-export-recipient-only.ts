import type { ShipmentExportData } from './shipment-dispatch';
import type { SmartStoreShipmentDetail } from './smartstore-shipment-workbook';

/*
 * 사용자 결정(2026-11-11, 1014-084) "수령인 정보만": 주문 조회 권한(sales.read)이 없는 출고 전용 운영자가 내려받는
 * ICONS 표준 출고지시 파일은 구매자·결제·금액 칸을 모든 줄에서 비운다(일부 줄만 비우지 않는다).
 * DB(`private.shipment_export_detail_for_reader`)가 줄의 구매자·결제·품목 금액을 이미 비워 보내고, 여기서 배송 건의
 * 선결제 배송비까지 비워 빌더에 넘긴다. 수령인·주소·연락처·상품·수량·번호는 그대로다.
 * 사용자 결정(2026-11-12) "착불 금액은 보이게": 착불 배송비(배송 건별)·합포장 착불 합계·착불 수납 정보(수납 주체·수납 방법·
 * 고객 안내·착불 환급 문의)는 창고가 수령인에게 받을 금액과 방법이라 비우지 않는다(배송 운영 안내 시트에 그대로 나온다).
 * 창고 양식(김포 21열·서원 송장양식)은 이 함수를 거치지 않는다.
 */
export const RECIPIENT_ONLY_DETAIL_FIELDS = [
  'buyerName', 'buyerId', 'paidAt', 'paymentMethod', 'productPrice', 'optionPrice',
  'itemTotal', 'itemDiscount', 'sellerDiscount', 'regionalShippingFee', 'shippingDiscount',
] as const satisfies readonly (keyof SmartStoreShipmentDetail)[];

type Shipment = ShipmentExportData['shipments'][number];
type Line = Shipment['lines'][number];
type Blank<T, K extends keyof T> = Omit<T, K> & { [P in K]: null };
export type RecipientOnlyDetail = Blank<SmartStoreShipmentDetail, typeof RECIPIENT_ONLY_DETAIL_FIELDS[number]>;
export type RecipientOnlyLine = Omit<Line, 'smartstore'> & { smartstore?: RecipientOnlyDetail };
export type RecipientOnlyShipment = Omit<Shipment, 'shippingFee' | 'lines'> & {
  /** 선결제 배송비. 착불 배송비(shippingCollectFee)·합포장 착불 합계(pack.collectFee)·착불 수납 정보(collector)는 그대로 둔다. */
  shippingFee: null;
  lines: RecipientOnlyLine[];
};
export interface RecipientOnlyShipmentExportData { shipments: RecipientOnlyShipment[] }

/** RECIPIENT_ONLY_DETAIL_FIELDS와 같은 칸이다(테스트가 둘이 어긋나지 않는지 확인한다). */
const blankDetail = (detail: SmartStoreShipmentDetail): RecipientOnlyDetail => ({
  ...detail, buyerName: null, buyerId: null, paidAt: null, paymentMethod: null, productPrice: null, optionPrice: null,
  itemTotal: null, itemDiscount: null, sellerDiscount: null, regionalShippingFee: null, shippingDiscount: null,
});

/** 원본은 바꾸지 않고 비운 사본을 돌려준다. 주문 조회 권한이 있으면 이 함수를 부르지 않는다. */
export function recipientOnlyShipmentExport(data: ShipmentExportData): RecipientOnlyShipmentExportData {
  return {
    shipments: data.shipments.map(shipment => ({
      ...shipment,
      shippingFee: null,
      pack: shipment.pack ? { ...shipment.pack } : shipment.pack,
      lines: shipment.lines.map(({ smartstore, ...line }): RecipientOnlyLine => (smartstore ? { ...line, smartstore: blankDetail(smartstore) } : line)),
    })),
  };
}
