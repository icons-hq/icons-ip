/** Header, position, formatting and reply identity belong to the same column definition. */
export const GIMPO_COLUMNS = [
  { key: 'collectedItem', header: '상품명(확정)+옵션(수집)+수량(조합용)', width: 48, text: true },
  { key: 'confirmedItem', header: '상품명(확정)+옵션(확정)+수량(조합용)', width: 48, text: true },
  { key: 'address', header: '수취인주소(1)', width: 60, text: true },
  { key: 'recipientShop', header: '수취인명+쇼핑몰명(1)', width: 28, text: true },
  { key: 'phone', header: '수취인전화번호1', width: 19, text: true },
  { key: 'otherPhone', header: '수취인전화번호2', width: 19, text: true },
  { key: 'deliveryNote', header: '배송메세지', width: 35, text: true },
  { key: 'sabangnetOrder', header: '주문번호(사방넷)', width: 25, text: true },
  { key: 'orderId', header: '주문번호(쇼핑몰)', width: 40, text: true },
  { key: 'optionAlias', header: '옵션별칭', width: 22, text: true },
  { key: 'goodName', header: '상품명(확정)', width: 35, text: true },
  { key: 'collectedOption', header: '옵션(수집)', width: 22, text: true },
  { key: 'confirmedOption', header: '옵션(확정)', width: 22, text: true },
  { key: 'supplyPrice', header: '공급단가', width: 14, text: false },
  { key: 'unitPrice', header: '주문금액/수량', width: 18, text: false },
  { key: 'qty', header: '수량', width: 8, text: false },
  { key: 'ea', header: 'EA(상품)', width: 12, text: false },
  { key: 'postalCode', header: '수취인우편번호(1)', width: 19, text: true },
  { key: 'recipient', header: '수취인명', width: 22, text: true },
  { key: 'shippingFee', header: '배송비(수집)', width: 14, text: false },
  { key: 'trackingNumber', header: '운송장번호', width: 25, text: true },
] as const;
export const SEOWON_COLUMNS = [
  { key: 'phone', header: '받는분전화번호', width: 19, text: true },
  { key: 'otherPhone', header: '받는분기타연락처', width: 21, text: true },
  { key: 'postalCode', header: '받는분우편번호', width: 19, text: true },
  { key: 'address', header: '받는분주소(전체,분할)', width: 60, text: true },
  { key: 'freightType', header: '운임Type', width: 12, text: true },
  { key: 'quantity', header: '수량', width: 8, text: false },
  { key: 'items', header: '품목명', width: 60, text: true },
] as const;
export const GIMPO_EXPORT_HEADERS = GIMPO_COLUMNS.map(column => column.header);
export const SEOWON_EXPORT_HEADERS = SEOWON_COLUMNS.map(column => column.header);

/** Companion instructions never alter a warehouse's native columns. */
export const WAREHOUSE_OPERATION_HEADERS = ['배송건번호', '주문번호', '선물 주문', '포장 요청', '선불 배송비', '계약상 착불 배송비', '착불 수납 주체', '수납 방법', '고객 안내', '착불 환급 문의', '합포장번호', '합포장 배송건수', '합포장 착불 합계', '합포장 안내'];
