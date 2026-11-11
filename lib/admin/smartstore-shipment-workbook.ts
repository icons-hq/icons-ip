import { kstDateTimeText, type ListExportColumn } from './list-export';

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

/*
 * ICONS 표준 양식. 출고지시 파일과 배송현황 목록 파일은 같은 말·같은 순서를 쓰고,
 * 그 파일에서 항상 비는 열만 `only`로 덜어 낸다. 열 이름은 주문통합검색 엑셀과 `CONTEXT.md`를 따른다.
 */
const ICONS_STANDARD_COLUMNS: readonly (ListExportColumn & { only?: 'instruction' | 'list' })[] = [
  /* 새 번호 체계의 20자리 주문번호·상품주문번호도 잘리지 않게 22자 너비를 둔다. */
  { header: '주문번호', kind: 'code', width: 22 },
  { header: '상품주문번호', kind: 'code', width: 22 },
  { header: '배송건번호', kind: 'code', width: 20 },
  { header: '구매자', kind: 'text', width: 16 },
  { header: '수취인', kind: 'text', width: 12 },
  { header: '연락처', kind: 'code', width: 16 },
  { header: '우편번호', kind: 'code', width: 8 },
  { header: '주소', kind: 'text', width: 64 },
  { header: '배송메시지', kind: 'text', width: 42 },
  { header: '출고지', kind: 'text', width: 10 },
  /* 퀵·방문수령 건은 택배사·운송장번호가 비어 있다. 파일만 보고도 구분되게 목록에 둔다(출고지시는 택배 건 기준). */
  { header: '배송 방식', kind: 'text', width: 10, only: 'list' },
  { header: '택배사', kind: 'text', width: 12 },
  { header: '운송장번호', kind: 'code', width: 18 },
  { header: '상품번호', kind: 'code', width: 28 },
  { header: '상품코드', kind: 'code', width: 14 },
  { header: '상품명', kind: 'text', width: 44 },
  { header: '옵션', kind: 'text', width: 30 },
  /* 목록 조회(admin_delivery_list_export_lines)에는 옵션코드·바코드·ERP 품명이 없다. */
  { header: '옵션코드', kind: 'code', width: 16, only: 'instruction' },
  /* 10/27 회의(1027T-046): 물류가 옵션별 바코드로 출고하도록 옵션의 바코드·ERP 품명을 싣는다. 값이 없으면 빈칸이다. */
  { header: '바코드', kind: 'code', width: 18, only: 'instruction' },
  { header: 'ERP 품명', kind: 'text', width: 36, only: 'instruction' },
  { header: '수량', kind: 'count', width: 8 },
  { header: '상품별 할인액', kind: 'amount', width: 14 },
  { header: '품목 실결제액(배송비 제외)', kind: 'amount', width: 24 },
  { header: '결제일', kind: 'date', width: 17 },
  { header: '결제수단', kind: 'text', width: 12 },
  { header: '주문일시', kind: 'date', width: 17 },
  { header: '발주확인일', kind: 'date', width: 17 },
  { header: '발송 예정일', kind: 'date', width: 12 },
  /* 출고지시는 발송 대기 건만 담으므로 아래 세 칸이 늘 비거나 값이 하나다. */
  { header: '발송처리일', kind: 'date', width: 17, only: 'list' },
  { header: '배송완료일', kind: 'date', width: 17, only: 'list' },
  { header: '주문 상태', kind: 'text', width: 12, only: 'list' },
  { header: '배송비 형태', kind: 'text', width: 12 },
  { header: '배송비 합계', kind: 'amount', width: 12 },
  { header: '제주/도서 추가배송비', kind: 'amount', width: 18 },
  { header: '배송비 할인액', kind: 'amount', width: 14 },
];

function standardColumns(file: 'instruction' | 'list'): readonly ListExportColumn[] {
  return ICONS_STANDARD_COLUMNS.filter(column => !column.only || column.only === file)
    .map(({ header, kind, width }) => ({ header, kind, width }));
}

export const ICONS_INSTRUCTION_COLUMNS = standardColumns('instruction');
export const ICONS_DELIVERY_LIST_COLUMNS = standardColumns('list');
/** 발송지연 탭의 목록 파일에만 오른쪽에 붙는다. */
export const ICONS_DELAY_COLUMNS: readonly ListExportColumn[] = [
  { header: '지연 메모', kind: 'text', width: 32 },
];

/** 표준 양식의 일시는 KST 문자열이고 날짜만 있는 값은 그대로다. 읽을 수 없는 값은 빈칸으로 바꾸지 않고 파일을 만들지 않는다. */
export function iconsStandardDateText(value: string | null | undefined): string | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const text = dateOnly ? (Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? '' : value) : kstDateTimeText(value);
  if (!text) throw new Error('날짜 정보를 확인하지 못했습니다. 목록을 새로고침해주세요.');
  return text;
}

/** 화면·주문통합검색과 같은 구매자 표시 이름. 닉네임이 없으면 회원 ID 앞 6자리로 만든다. */
export function iconsStandardBuyerName(name: string | null | undefined, buyerId: string): string {
  return name?.trim() || `fan_${buyerId.slice(0, 6)}`;
}

export function shippingChargeLabel(prepaid: number, collect: number): string {
  if (prepaid + collect === 0) return '무료';
  if (collect === 0) return '선결제';
  return prepaid > 0 ? '선결제/착불' : '착불';
}

/*
 * 운송장 회신이 읽는 머리글. 나머지 열은 순서·삭제가 자유다.
 * 이미 내려받은 옛 파일에는 운송장번호 대신 송장번호가, 그리고 배송방법 열이 있다.
 */
export const ICONS_REPLY_ITEM_HEADER = '상품주문번호';
export const ICONS_REPLY_CARRIER_HEADER = '택배사';
export const ICONS_REPLY_TRACKING_HEADERS = ['운송장번호', '송장번호'] as const;
export const ICONS_REPLY_METHOD_HEADER = '배송방법';
export const ICONS_REPLY_PARCEL_METHODS: readonly string[] = ['택배', '택배,등기,소포'];
