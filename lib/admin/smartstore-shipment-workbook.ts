/** Selected orders and their stored item allocations; current catalog prices are excluded. */
export interface SmartStoreShipmentDetail {
  orderNumber: string;
  productOrderNumber: string;
  shipmentNumber: string;
  itemId: string;
  goodId: string;
  buyerName: string;
  buyerId: string;
  buyerPhone: string;
  address1: string;
  address2: string;
  orderedAt: string;
  paidAt: string | null;
  confirmedAt: string | null;
  expectedShipDate: string | null;
  shippedAt: string | null;
  exportedAt: string | null;
  goodType: string;
  paymentMethod: string;
  /** Null when the historical base/option split was not recorded. */
  productPrice: number | null;
  optionPrice: number | null;
  /** Whole item row, after unit-price promotion and before shipping. */
  itemDiscount: number | null;
  sellerDiscount: number | null;
  itemTotal: number | null;
  /** Whole shipment; written on its first item row only. */
  regionalShippingFee: number | null;
  shippingDiscount: number | null;
}

export const SMARTSTORE_TRACKING_HEADERS = ['상품주문번호', '배송방법', '택배사', '송장번호'] as const;
export const SMARTSTORE_PARCEL_METHOD = '택배,등기,소포';
