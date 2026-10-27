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
/**
 * 서원(남양주) `260908_우체국 송장 입력 양식.xlsx`의 `송장양식` 시트. 7열의 헤더·순서·너비와
 * 헤더 색(`fill`: 노랑=필수, 회색=선택, 초록=피킹)은 원본 그대로다. 원본에는 받는 분 이름·주문 번호
 * 칸이 없다 — 7열은 건드리지 않고 오른쪽에 받는분성명·배송메시지·배송건번호를 덧붙인다(`appended`).
 * 서원 프로그램이 7열만 읽으면 덧붙인 열은 무시된다. 배송건번호는 송장이 등록되는 단위(배송 건)의
 * 16자리 번호라 회신에 남아 있으면 내용 대조 없이 그 배송 건을 바로 찾는다.
 */
export const SEOWON_SHEET_NAME = '송장양식';
export const SEOWON_COLUMNS = [
  { key: 'phone', header: '받는분전화번호', width: 18.3984375, fill: 'required', text: true },
  { key: 'otherPhone', header: '받는분기타연락처', width: 21, fill: 'optional', text: true },
  { key: 'postalCode', header: '받는분우편번호', width: 18.3984375, fill: 'optional', text: true },
  { key: 'address', header: '받는분주소(전체,분할)', width: 83.3984375, fill: 'required', text: true },
  { key: 'freightType', header: '운임Type', width: 11.69921875, fill: 'optional', text: true },
  { key: 'quantity', header: '수량', width: 6.59765625, fill: 'picking', text: false },
  { key: 'items', header: '품목명', width: 62.5, fill: 'picking', text: true },
  { key: 'recipient', header: '받는분성명', width: 16, fill: 'optional', text: true, appended: true },
  { key: 'deliveryNote', header: '배송메시지', width: 40, fill: 'optional', text: true, appended: true },
  { key: 'shipmentNumber', header: '배송건번호', width: 20, fill: 'optional', text: true, appended: true },
] as const;
/** 회신 파일에서 송장번호 열로 인정하는 헤더. 공백은 비교 전에 지운다. */
export const SEOWON_REPLY_TRACKING_HEADERS = ['송장번호', '운송장번호', '등기번호', '운송장', '송장', '택배송장번호', '우체국송장번호'] as const;
export const GIMPO_EXPORT_HEADERS = GIMPO_COLUMNS.map(column => column.header);
export const SEOWON_EXPORT_HEADERS = SEOWON_COLUMNS.map(column => column.header);

/** Companion instructions never alter a warehouse's native columns. */
export const WAREHOUSE_OPERATION_HEADERS = ['배송건번호', '주문번호', '선물 주문', '포장 요청', '선불 배송비', '계약상 착불 배송비', '착불 수납 주체', '수납 방법', '고객 안내', '착불 환급 문의', '합포장번호', '합포장 배송건수', '합포장 착불 합계', '합포장 안내'];
/** 제공 원본의 7열. 회신 판별은 이 7개 헤더가 A~G에 그대로 있는지로 한다. */
export const SEOWON_TEMPLATE_HEADERS = SEOWON_COLUMNS.filter(column => !('appended' in column)).map(column => column.header);
