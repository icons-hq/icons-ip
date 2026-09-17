/** Header, position, formatting and reply identity belong to the same column definition. */
export const GIMPO_COLUMNS = [
  { key: 'collectedItem', header: '상품명(확정)+옵션(수집)+수량(조합용)', width: 48 },
  { key: 'confirmedItem', header: '상품명(확정)+옵션(확정)+수량(조합용)', width: 48 },
  { key: 'address', header: '수취인주소(1)', width: 60 },
  { key: 'recipientShop', header: '수취인명+쇼핑몰명(1)', width: 28 },
  { key: 'phone', header: '수취인전화번호1', width: 19 },
  { key: 'otherPhone', header: '수취인전화번호2', width: 19 },
  { key: 'deliveryNote', header: '배송메세지', width: 35 },
  { key: 'sabangnetOrder', header: '주문번호(사방넷)', width: 25 },
  { key: 'orderId', header: '주문번호(쇼핑몰)', width: 40 },
  { key: 'optionAlias', header: '옵션별칭', width: 22 },
  { key: 'goodName', header: '상품명(확정)', width: 35 },
  { key: 'collectedOption', header: '옵션(수집)', width: 22 },
  { key: 'confirmedOption', header: '옵션(확정)', width: 22 },
  { key: 'supplyPrice', header: '공급단가', width: 14 },
  { key: 'unitPrice', header: '주문금액/수량', width: 18 },
  { key: 'qty', header: '수량', width: 8 },
  { key: 'ea', header: 'EA(상품)', width: 12 },
  { key: 'postalCode', header: '수취인우편번호(1)', width: 19 },
  { key: 'recipient', header: '수취인명', width: 22 },
  { key: 'shippingFee', header: '배송비(수집)', width: 14 },
  { key: 'trackingNumber', header: '운송장번호', width: 25 },
] as const;
export const SEOWON_COLUMNS = [
  { key: 'phone', header: '받는분전화번호', width: 19 },
  { key: 'otherPhone', header: '받는분기타연락처', width: 21 },
  { key: 'postalCode', header: '받는분우편번호', width: 19 },
  { key: 'address', header: '받는분주소(전체,분할)', width: 60 },
  { key: 'freightType', header: '운임Type', width: 12 },
  { key: 'quantity', header: '수량', width: 8 },
  { key: 'items', header: '품목명', width: 60 },
] as const;
export const GIMPO_EXPORT_HEADERS = GIMPO_COLUMNS.map(column => column.header);
export const SEOWON_EXPORT_HEADERS = SEOWON_COLUMNS.map(column => column.header);
