import { goodsCustomInputSummary, type GoodsCustomInputSelection } from '@/lib/goods-custom-inputs';
/*
 * 화면별 목록 엑셀의 열과 행.
 *
 * 열 이름은 화면 라벨을 따른다. 상품명·옵션·수량을 각각 한 칸에 두기 위해 주문·배송 건·
 * 요청 목록은 상품 한 줄을 한 행으로 펼친다(스마트스토어 주문 엑셀과 같은 단위).
 * 주문 단위 금액은 행마다 반복되므로 안내 시트에 합계를 내는 열을 밝힌다.
 */
import { ADMIN_VOCABULARY as V } from './vocabulary';
import { SALES_DATE_FIELDS, SALES_SORT_OPTIONS } from './sales-list';
import { shipmentDelayNoticeLabel } from './shipment-delay-notice';
import {
  ADMIN_ORDER_SEARCH_FIELDS,
  ADMIN_ORDER_STATUS_LABELS,
  type AdminOrderFilters,
  type AdminOrderRecord,
} from './orders';
import { adminUnpaidAttemptStateLabel, type AdminUnpaidFilters, type AdminUnpaidOrderRow } from './unpaid';
import {
  SHIPMENT_CONSOLE_TABS,
  type ShipmentConsoleFilters,
  type ShipmentConsoleSurface,
} from './shipment-dispatch';
import {
  ADMIN_CLAIM_REASON_OPTIONS,
  ADMIN_CLAIM_STAGE_OPTIONS,
  ADMIN_CLAIM_DATE_FIELDS,
  ADMIN_CLAIM_SEARCH_FIELDS,
  adminClaimReasonText,
  type AdminClaimFilters,
  type AdminClaimRow,
} from './claims';
import {
  ADMIN_LIST_EXPORT_SCREENS,
  adminListExportClaimScreenId,
  kstDateTimeText,
  listExportPeriodLabel,
  type AdminListExportScreenId,
  type AdminListExportSheet,
  type ListExportCellKind,
  type ListExportCellValue,
  type ListExportColumn,
} from './list-export';
import { orderReferenceLabel, paymentStatusLabel } from '@/lib/orders';
import {
  ORDER_CLAIM_REFUND_METHOD_LABELS,
  ORDER_CLAIM_STAGE_LABELS,
  ORDER_CLAIM_TYPE_LABELS,
  orderClaimReferenceLabel,
  orderClaimSlaState,
  type OrderClaimType,
} from '@/lib/orders/claims';
import { shipmentStatusLabel, type ShipmentRecord, type ShipmentStatus } from '@/lib/orders/shipments';
import { bankTransferDepositNameWithCode } from '@/lib/payments/bank-transfer';
import type { OrderItemAllocation } from './item-allocation';
import { DELIVERY_METHOD_LABELS, deliveryStatusLabel, type ShipmentDeliverySummary } from '@/lib/shipment-delivery';
import { refundTransferRowKey, type RefundTransferRow } from './refund-transfers';

interface ColumnSpec<Row> extends ListExportColumn {
  value: (row: Row) => ListExportCellValue | undefined;
}

function column<Row>(header: string, kind: ListExportCellKind, width: number, value: ColumnSpec<Row>['value']): ColumnSpec<Row> {
  return { header, kind, width, value };
}

function table<Row>(columns: ColumnSpec<Row>[], rows: Row[]) {
  return {
    columns: columns.map(({ header, kind, width }) => ({ header, kind, width })),
    rows: rows.map((row) => columns.map((spec) => spec.value(row) ?? null)),
  };
}

const blank = (value: string | null | undefined) => (value ? value : null);
const nullable = (value: string) => (value ? value : null);

/** 결제수단 표기. DB enum은 card·bank_transfer 두 가지다. */
export function listExportPaymentMethodLabel(method: string | null | undefined) {
  if (method === 'card') return '카드';
  if (method === 'bank_transfer') return '무통장 입금';
  return method ?? '';
}

/** 주문 배송지에서 목록에 필요한 칸만 꺼낸다. 형식이 낯설어도 있는 문자열은 보존한다. */
export interface ListExportContact {
  recipientName: string;
  phone: string;
  postalCode: string;
  address: string;
  deliveryNote: string;
}

export function listExportContact(value: unknown): ListExportContact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string).trim() : '');
  const contact = {
    recipientName: text('recipientName'),
    phone: text('phone'),
    postalCode: text('postalCode'),
    address: [text('address1'), text('address2')].filter(Boolean).join(' '),
    deliveryNote: text('deliveryNote'),
  };
  return Object.values(contact).some(Boolean) ? contact : null;
}

function deliveryLabels(delivery: ShipmentDeliverySummary | null | undefined, status: ShipmentStatus | null) {
  /* 배송 방식이 없던 시절의 배송 건은 택배다(isParcelShipment와 같은 규칙). */
  if (delivery === undefined) return { method: '택배', status: status ? shipmentStatusLabel(status) : '' };
  if (!delivery) return { method: '확인 필요', status: status ? shipmentStatusLabel(status) : '' };
  return {
    method: DELIVERY_METHOD_LABELS[delivery.method],
    status: status ? deliveryStatusLabel(delivery.method, status) : '',
  };
}

function queryText(value: string) {
  return value || '전체';
}

/* ------------------------------------------------------------------------- */
/* 주문 통합검색 — 주문의 상품 한 줄이 한 행 */

interface OrderLine {
  order: AdminOrderRecord;
  item: AdminOrderRecord['items'][number] | null;
  shipment: ShipmentRecord | null;
  paymentMethod: string | null;
}

export function ordersListExportSheet(input: {
  records: AdminOrderRecord[];
  paymentMethods: ReadonlyMap<string, string | null>;
  filters: AdminOrderFilters;
  /** 품목별 쿠폰·적립금 배분(`lib/admin/item-allocation`). 계산 버전 1 주문도 거래확정 엑셀과 같은 규칙으로 채운다. */
  allocations?: ReadonlyMap<string, OrderItemAllocation>;
}): AdminListExportSheet {
  const allocated = (order: AdminOrderRecord, item: AdminOrderRecord['items'][number] | null) => {
    if (!item) return null;
    const line = order.transaction?.lines.find(entry => entry.lineId === item.id);
    if (line) return { volumeDiscount: line.volumeDiscountTotal, couponDiscount: line.couponDiscount, storeCreditDiscount: line.storeCreditDiscount, paidGoodsTotal: line.paidGoodsTotal };
    return input.allocations?.get(item.id) ?? null;
  };
  const lines = input.records.flatMap<OrderLine>((order) => {
    const paymentMethod = input.paymentMethods.get(order.id) ?? null;
    if (!order.items.length) return [{ order, item: null, shipment: null, paymentMethod }];
    return order.items.map((item) => ({
      order,
      item,
      shipment: order.shipments.find((shipment) => shipment.orderItemIds.includes(item.id)) ?? null,
      paymentMethod,
    }));
  });

  const columns: ColumnSpec<OrderLine>[] = [
    column('주문번호', 'code', 22, ({ order }) => orderReferenceLabel(order.id, order.orderNumber)),
    column('주문일시', 'text', 17, ({ order }) => nullable(kstDateTimeText(order.createdAt))),
    column('주문 상태', 'text', 12, ({ order }) => ADMIN_ORDER_STATUS_LABELS[order.status]),
    column('구매자', 'text', 16, ({ order }) => order.buyerName),
    column('이메일', 'text', 36, ({ order }) => blank(order.buyerEmail)),
    column('수취인', 'text', 12, ({ order }) => blank(order.address?.recipientName)),
    column('결제수단', 'text', 12, ({ paymentMethod }) => nullable(listExportPaymentMethodLabel(paymentMethod))),
    column('결제 상태', 'text', 12, ({ order }) => nullable(order.payments.map((payment) => paymentStatusLabel(payment.status)).join(', '))),
    column('결제금액', 'amount', 12, ({ order }) => order.total),
    column('선물 주문', 'text', 12, ({ order }) => order.isGift ? '선물 · 수령인용 가격표 제외' : '일반 주문'),
    column('복수구매 할인(주문)', 'amount', 18, ({ order }) => order.transaction?.totals.volumeDiscountTotal ?? 0),
    column('선불 배송비(주문)', 'amount', 18, ({ order }) => order.transaction?.totals.prepaidShippingTotal ?? null),
    column('착불 배송비(주문)', 'amount', 18, ({ order }) => order.transaction?.totals.collectShippingTotal ?? 0),
    column(V.goods + '명', 'text', 32, ({ item }) => blank(item?.name)),
    column(V.option, 'text', 18, ({ item }) => blank(item?.variantName)),
    column('직접 입력 옵션', 'text', 36, ({ item }) => blank(goodsCustomInputSummary(item?.customInputs))),
    column('옵션코드', 'code', 16, ({ item }) => blank(item?.variantCode)),
    column('수량', 'count', 8, ({ item }) => item?.qty ?? null),
    column('판매가', 'amount', 12, ({ item }) => item?.unitPrice ?? null),
    column(`${V.goods} 금액`, 'amount', 12, ({ item }) => (item ? item.unitPrice * item.qty : null)),
    column('복수구매 할인(품목)', 'amount', 18, ({ order, item }) => allocated(order, item)?.volumeDiscount ?? 0),
    column('쿠폰 할인(품목)', 'amount', 18, ({ order, item }) => allocated(order, item)?.couponDiscount ?? null),
    column('적립금 사용(품목)', 'amount', 18, ({ order, item }) => allocated(order, item)?.storeCreditDiscount ?? null),
    column('품목 실결제액(배송비 제외)', 'amount', 24, ({ order, item }) => allocated(order, item)?.paidGoodsTotal ?? null),
    column('출고지', 'text', 10, ({ shipment }) => blank(shipment?.originName)),
    column('배송 방식', 'text', 10, ({ shipment }) => (shipment ? deliveryLabels(shipment.delivery, shipment.status).method : null)),
    column('배송 상태', 'text', 12, ({ shipment }) => (shipment ? nullable(deliveryLabels(shipment.delivery, shipment.status).status) : null)),
    column('택배사', 'text', 12, ({ shipment }) => blank(shipment?.carrierLabel)),
    column('운송장번호', 'code', 18, ({ shipment }) => blank(shipment?.trackingNumber)),
    column(V.claimRequest, 'text', 20, ({ order }) => (order.cancellationRequest
      ? `${ORDER_CLAIM_TYPE_LABELS[order.cancellationRequest.claimType]} · ${ORDER_CLAIM_STAGE_LABELS[order.cancellationRequest.stage]}`
      : null)),
  ];

  const { filters } = input;
  const fieldLabel = ADMIN_ORDER_SEARCH_FIELDS.find((field) => field.value === filters.field)?.label ?? '전체';
  return {
    screen: 'orders',
    title: ADMIN_LIST_EXPORT_SCREENS.orders.label,
    ...table(columns, lines),
    recordCount: input.records.length,
    conditions: [
      ['검색 대상', fieldLabel],
      ['검색어', queryText(filters.query)],
      ['주문 상태', filters.status === 'all' ? '전체 상태' : ADMIN_ORDER_STATUS_LABELS[filters.status]],
      [SALES_DATE_FIELDS.find(option => option.value === (filters.dateField ?? 'ordered'))!.label, listExportPeriodLabel(filters.from, filters.to)],
      ...(filters.paymentMethod ? [['결제수단', listExportPaymentMethodLabel(filters.paymentMethod)] as [string, string]] : []),
      ...(filters.sort ? [['정렬', SALES_SORT_OPTIONS.find(option => option.value === filters.sort)!.label] as [string, string]] : []),
    ],
    notes: [
      `한 행은 주문의 ${V.goods} 한 줄입니다. 결제금액과 (주문) 열은 같은 주문의 행마다 반복되므로 주문번호별로 한 번만 합산해주세요.`,
      `${V.goods} 금액은 복수구매·쿠폰·적립금 차감 전 품목 소계입니다. 품목 실결제액은 해당 할인과 적립금을 차감하며 배송비를 제외합니다. 주문 당시 배분 기록을 쓰고, 배분 기록이 없는 주문은 주문 당시 쿠폰 기록을 거래확정 엑셀과 같은 규칙(대상 품목 금액 비례)으로 나눈 값을 씁니다. 기록이 없거나 합계가 맞지 않으면 빈칸입니다.`,
      '착불 배송비는 온라인 결제금액·PG 매출·PG 환급액에 포함하지 않습니다. 이 금액만으로 실제 수납 완료를 판단하지 마세요.',
      '선물 주문은 내부 운영용 주소를 포함합니다. 수령인에게 가격·결제정보가 있는 이 파일을 동봉하지 마세요.',
    ],
    filters: {
      ...(filters.dateField ? { dateField: filters.dateField } : {}),
      ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod } : {}),
      ...(filters.sort ? { sort: filters.sort } : {}),
      field: filters.field,
      query: filters.query || null,
      status: filters.status,
      from: filters.from,
      to: filters.to,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* 미입금 확인 — 주문 한 건이 한 행. 주소·연락처는 화면과 같이 싣지 않는다. */

export function unpaidListExportSheet(input: {
  rows: AdminUnpaidOrderRow[];
  filters: AdminUnpaidFilters;
}): AdminListExportSheet {
  const columns: ColumnSpec<AdminUnpaidOrderRow>[] = [
    column('입금확인코드', 'code', 12, (row) => row.depositCode),
    column('주문번호', 'code', 22, (row) => row.orderNumber ?? row.id),
    column('구매자', 'text', 16, (row) => row.buyerName),
    column('안내된 입금자명', 'text', 20, (row) => bankTransferDepositNameWithCode(row.recipientName, row.depositCode)),
    column('품목', 'text', 40, (row) => blank(row.itemSummary)),
    column('주문일시', 'text', 17, (row) => nullable(kstDateTimeText(row.createdAt))),
    column('입금 기한', 'text', 17, (row) => nullable(kstDateTimeText(row.expiresAt))),
    column('기한 연장', 'text', 17, (row) => nullable(kstDateTimeText(row.extendedAt))),
    column('상태', 'text', 12, (row) => adminUnpaidAttemptStateLabel(row.attemptState)),
    column('입금액', 'amount', 12, (row) => row.total),
  ];
  return {
    screen: 'unpaid',
    title: ADMIN_LIST_EXPORT_SCREENS.unpaid.label,
    ...table(columns, input.rows),
    recordCount: input.rows.length,
    conditions: [['검색어', queryText(input.filters.query)],
      ...(input.filters.state ? [['결제상태', input.filters.state === 'missing' ? '원장 없음' : adminUnpaidAttemptStateLabel(input.filters.state)] as [string, string]] : [])],
    notes: ['한 행은 입금을 기다리는 무통장 입금 주문 한 건입니다. 입금 대조에 필요하지 않은 주소·연락처는 담지 않습니다.'],
    filters: { query: input.filters.query || null, ...(input.filters.state ? { state: input.filters.state } : {}), ...(input.filters.sort ? { sort: input.filters.sort } : {}) },
  };
}

/* ------------------------------------------------------------------------- */
/* 발주·발송 관리 / 배송현황 관리 — 배송 건의 상품 한 줄이 한 행 */

/** 조건·안내만 만든다. 열과 행은 `smartStoreDeliveryListSheet`가 ICONS 표준 양식으로 채운다. */
export function shipmentsListExportSheet(input: {
  surface: ShipmentConsoleSurface;
  recordCount: number;
  filters: ShipmentConsoleFilters;
  origins: { id: string; name: string }[];
}): Omit<AdminListExportSheet, 'columns' | 'rows'> {
  const { surface, filters } = input;
  const isDispatch = surface === 'dispatch';

  const screen: AdminListExportScreenId = surface;
  const tabLabel = SHIPMENT_CONSOLE_TABS[surface].find((tab) => tab.id === filters.tab)?.label ?? filters.tab;
  const originName = filters.originId
    ? input.origins.find((origin) => origin.id === filters.originId)?.name ?? filters.originId
    : '전체 출고지';
  return {
    screen,
    title: `${ADMIN_LIST_EXPORT_SCREENS[screen].label} - ${tabLabel}`,
    recordCount: input.recordCount,
    conditions: [
      ['탭', tabLabel],
      ['출고지', originName],
      [SALES_DATE_FIELDS.find(option => option.value === (filters.dateField ?? 'ordered'))!.label, listExportPeriodLabel(filters.from, filters.to)],
      ['검색어', queryText(filters.query)],
      ...(isDispatch ? [['발송지연 안내여부', filters.delayNotice ? shipmentDelayNoticeLabel(filters.delayNotice) : '전체'] as [string, string]] : []),
      ...(filters.method ? [['배송방법', DELIVERY_METHOD_LABELS[filters.method]] as [string, string]] : []),
      ...(filters.paymentMethod ? [['결제수단', listExportPaymentMethodLabel(filters.paymentMethod)] as [string, string]] : []),
    ],
    notes: [
      `한 행은 배송 건의 ${V.goods} 한 줄입니다. 배송비는 같은 배송건번호의 첫 행에 한 번만 기록합니다. 기록되지 않은 금액·날짜는 빈칸입니다.`,
      '운송장 회신은 택배사와 운송장번호를 채운 뒤 이 XLSX를 발주·발송 관리의 "엑셀 일괄 운송장 등록"에 올립니다. 비밀번호를 건 XLSX는 해제하지 않고 그대로 올리고 "파일 비밀번호" 칸에 입력합니다. 상품주문번호는 전체 번호를 유지해주세요.',
      ...(isDispatch ? ['창고에 전달하는 출고지시 파일과 다른 확인용 목록입니다. 이 파일을 내려받아도 출고지시 전달 기록은 바뀌지 않습니다.'] : []),
    ],
    filters: {
      ...(filters.dateField ? { dateField: filters.dateField } : {}),
      ...(filters.field ? { field: filters.field } : {}),
      ...(filters.method ? { method: filters.method } : {}),
      ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod } : {}),
      ...(isDispatch && filters.delayNotice ? { delayNotice: filters.delayNotice } : {}),
      ...(filters.sort ? { sort: filters.sort } : {}),
      tab: filters.tab,
      originId: filters.originId,
      query: filters.query || null,
      from: filters.from,
      to: filters.to,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* 취소·반품·교환 관리 — 요청 주문의 상품 한 줄이 한 행 */

export interface ListExportClaimItem {
  id: string;
  name: string;
  variantName: string | null;
  customInputs?:GoodsCustomInputSelection|null;
  qty: number;
}

export interface ListExportClaimOrder {
  items: ListExportClaimItem[];
  contact: ListExportContact | null;
  shipments: ShipmentRecord[];
}

interface ClaimLine {
  claim: AdminClaimRow;
  item: ListExportClaimItem | null;
  contact: ListExportContact | null;
  shipment: ShipmentRecord | null;
}

export function claimsListExportSheet(input: {
  claimType: OrderClaimType;
  rows: AdminClaimRow[];
  filters: AdminClaimFilters;
  orders: ReadonlyMap<string, ListExportClaimOrder>;
  now: Date;
}): AdminListExportSheet {
  const { claimType, filters, now } = input;
  /* 회수가 있는 유형만 배송지를 싣는다. 취소는 출고 전 중단이라 주소가 필요 없다. */
  const withDelivery = claimType !== 'cancel';
  const lines = input.rows.flatMap<ClaimLine>((claim) => {
    const order = input.orders.get(claim.orderId);
    const contact = withDelivery ? order?.contact ?? null : null;
    if (!order?.items.length) return [{ claim, item: null, contact, shipment: null }];
    return order.items.map((item) => ({
      claim,
      item,
      contact,
      shipment: withDelivery
        ? order.shipments.find((shipment) => shipment.orderItemIds.includes(item.id)) ?? null
        : null,
    }));
  });

  const columns: ColumnSpec<ClaimLine>[] = [
    column(V.claimNumber, 'code', 10, ({ claim }) => orderClaimReferenceLabel(claim.reference)),
    column('주문번호', 'code', 22, ({ claim }) => orderReferenceLabel(claim.orderId, claim.orderNumber)),
    column('유형', 'text', 8, ({ claim }) => ORDER_CLAIM_TYPE_LABELS[claim.claimType]),
    column('사유', 'text', 20, ({ claim }) => adminClaimReasonText(claim.reasonType, claim.staffReasonCode)),
    column(V.claimStatus, 'text', 12, ({ claim }) => ORDER_CLAIM_STAGE_LABELS[claim.stage]),
    column('구매자', 'text', 16, ({ claim }) => claim.buyerName),
    column('이메일', 'text', 36, ({ claim }) => blank(claim.buyerEmail)),
    column('결제금액', 'amount', 12, ({ claim }) => claim.orderTotal),
    column('접수일시', 'text', 17, ({ claim }) => nullable(kstDateTimeText(claim.requestedAt))),
    column('입고 확인일시', 'text', 17, ({ claim }) => nullable(kstDateTimeText(claim.collectedAt))),
    column('완료일시', 'text', 17, ({ claim }) => nullable(kstDateTimeText(claim.completedAt))),
    column('환급 기한', 'text', 12, ({ claim }) => orderClaimSlaState(claim, now).label),
    column('환불 수단', 'text', 12, ({ claim }) => (claim.refundMethod ? ORDER_CLAIM_REFUND_METHOD_LABELS[claim.refundMethod] : '미접수')),
    column('처리자', 'text', 14, ({ claim }) => claim.handlerName ?? '미배정'),
    column(V.goods + '명', 'text', 32, ({ item }) => blank(item?.name)),
    column(V.option, 'text', 18, ({ item }) => blank(item?.variantName)),
    column('직접 입력 옵션', 'text', 36, ({ item }) => blank(goodsCustomInputSummary(item?.customInputs))),
    column('수량', 'count', 8, ({ item }) => item?.qty ?? null),
    ...(withDelivery
      ? [
          column<ClaimLine>('수취인', 'text', 12, ({ contact }) => blank(contact?.recipientName)),
          column<ClaimLine>('연락처', 'code', 14, ({ contact }) => blank(contact?.phone)),
          column<ClaimLine>('우편번호', 'code', 8, ({ contact }) => blank(contact?.postalCode)),
          column<ClaimLine>('주소', 'text', 48, ({ contact }) => blank(contact?.address)),
          column<ClaimLine>('배송메시지', 'text', 24, ({ contact }) => blank(contact?.deliveryNote)),
          column<ClaimLine>('출고지', 'text', 10, ({ shipment }) => blank(shipment?.originName)),
          column<ClaimLine>('택배사', 'text', 12, ({ shipment }) => blank(shipment?.carrierLabel)),
          column<ClaimLine>('운송장번호', 'code', 18, ({ shipment }) => blank(shipment?.trackingNumber)),
        ]
      : []),
  ];

  const screen = adminListExportClaimScreenId(claimType);
  return {
    screen,
    title: ADMIN_LIST_EXPORT_SCREENS[screen].label,
    ...table(columns, lines),
    recordCount: input.rows.length,
    conditions: [
      [V.claimStatus, ADMIN_CLAIM_STAGE_OPTIONS.find((option) => option.value === filters.stage)?.label ?? filters.stage],
      ['사유', ADMIN_CLAIM_REASON_OPTIONS.find((option) => option.value === filters.reasonType)?.label ?? filters.reasonType],
      [filters.dateField ? ADMIN_CLAIM_DATE_FIELDS.find(option => option.value === filters.dateField)!.label : '접수일', listExportPeriodLabel(filters.from, filters.to)],
      ['검색어', queryText(filters.query)],
      ...(filters.field ? [['검색 대상', ADMIN_CLAIM_SEARCH_FIELDS.find(option => option.value === filters.field)!.label] as [string, string]] : []),
    ],
    notes: [
      `한 행은 요청 주문의 ${V.goods} 한 줄입니다. ${V.claimRequest}은 주문 단위로 처리되며 결제금액은 같은 요청의 행마다 반복됩니다.`,
      ...(withDelivery ? ['배송지와 운송장은 원래 주문의 출고 정보입니다. 회수 주소는 요청 상세에서 확인합니다.'] : []),
      `환급 기한은 내려받은 시각 기준입니다.`,
    ],
    filters: {
      ...(filters.dateField ? { dateField: filters.dateField } : {}),
      ...(filters.field ? { field: filters.field } : {}),
      ...(filters.sort ? { sort: filters.sort } : {}),
      stage: filters.stage,
      reasonType: filters.reasonType,
      from: filters.from,
      to: filters.to,
      query: filters.query || null,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* 환불 송금 대기 — 송금할 무통장 환불 요청 한 건이 한 행 */

/**
 * 환불 송금 대기 엑셀의 계좌 열(은행·계좌번호·예금주·계좌 상태) 스위치. 이 한 곳에서 켜고 끈다.
 * 2026-11-11 사용자 결정(1007-047·048 "계좌 포함 + 비밀번호 엑셀")으로 켰다. 켜져 있으면 내려받을 때마다 서버가 요청별 계좌 열람을
 * 기록하고(`service_export_bank_transfer_refund_accounts`) 그 계좌를 싣는다. 끄면 계좌 열람 없이 화면과 같은 열만 남는다.
 * 어느 쪽이든 파일은 비밀번호를 건 엑셀로만 내려간다.
 */
export const REFUND_TRANSFER_EXPORT_INCLUDES_ACCOUNT = true;

export type RefundTransferAccountStatus = 'revealed' | 'not_filed' | 'unavailable';
export interface RefundTransferExportAccount {
  status: RefundTransferAccountStatus;
  bankName: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
}
const REFUND_TRANSFER_ACCOUNT_STATUS_LABELS: Record<RefundTransferAccountStatus, string> = {
  revealed: '확인됨', not_filed: '환불 접수 전', unavailable: '요청 상세 확인 필요',
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 화면(`RefundTransfersScreen`)과 같이 한국 달력으로 센 대기 일수. */
function refundTransferWaitingDays(confirmedAt: string, now: Date) {
  const from = Date.parse(confirmedAt);
  if (Number.isNaN(from)) return null;
  return Math.max(0, Math.floor((now.getTime() + KST_OFFSET_MS) / DAY_MS) - Math.floor((from + KST_OFFSET_MS) / DAY_MS));
}

interface RefundTransferLine { row: RefundTransferRow; account: RefundTransferExportAccount | null }

export function refundTransfersListExportSheet(input: {
  rows: RefundTransferRow[];
  /** 줄 키(`refundTransferRowKey`: 요청 id 또는 부분 취소) → 계좌. 계좌 열을 켰으면 모든 줄의 값이 있어야 한다(없으면 파일을 만들지 않는다). */
  accounts: ReadonlyMap<string, RefundTransferExportAccount> | null;
  /** 이번 내려받기의 계좌 열람 기록 id. 발급 감사 기록이 이 열람을 가리킨다. */
  accountExportId: string | null;
  now: Date;
  /** 시험용. 기본은 `REFUND_TRANSFER_EXPORT_INCLUDES_ACCOUNT`. */
  includeAccount?: boolean;
}): AdminListExportSheet {
  const includeAccount = input.includeAccount ?? REFUND_TRANSFER_EXPORT_INCLUDES_ACCOUNT;
  const accounts = input.accounts;
  if (includeAccount && (!accounts || !input.accountExportId || input.rows.some(row => !accounts.has(refundTransferRowKey(row))))) {
    throw new Error('환불 계좌를 확인하지 못해 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.');
  }
  const lines = input.rows.map<RefundTransferLine>(row => ({ row, account: includeAccount ? accounts?.get(refundTransferRowKey(row)) ?? null : null }));
  const columns: ColumnSpec<RefundTransferLine>[] = [
    column(V.claimNumber, 'code', 10, ({ row }) => (row.kind === 'partial_cancellation' ? `${row.sequence}차 부분 취소` : orderClaimReferenceLabel(row.reference))),
    column('송금 대기 금액', 'amount', 14, ({ row }) => row.amount),
    column('결제자', 'text', 16, ({ row }) => row.payerName || '이름 미등록'),
    ...(includeAccount ? [
      column<RefundTransferLine>('은행', 'text', 14, ({ account }) => blank(account?.bankName)),
      column<RefundTransferLine>('계좌번호', 'code', 22, ({ account }) => blank(account?.accountNumber)),
      column<RefundTransferLine>('예금주', 'text', 14, ({ account }) => blank(account?.accountHolder)),
      column<RefundTransferLine>('계좌 상태', 'text', 18, ({ account }) => (account ? REFUND_TRANSFER_ACCOUNT_STATUS_LABELS[account.status] : null)),
    ] : []),
    column('대기 일수', 'count', 10, ({ row }) => refundTransferWaitingDays(row.confirmedAt, input.now)),
    column('유형', 'text', 12, ({ row }) => `${row.gift ? '선물 · ' : ''}${row.kind === 'partial_cancellation' ? '부분 취소' : row.claimType === 'cancel' ? '취소' : '반품'}`),
    column('주문번호', 'code', 22, ({ row }) => orderReferenceLabel(row.orderId, row.orderNumber)),
    column('취소 확정일', 'text', 17, ({ row }) => nullable(kstDateTimeText(row.confirmedAt))),
    column('환불 접수일', 'text', 17, ({ row }) => (row.filedAt ? nullable(kstDateTimeText(row.filedAt)) : '미접수')),
    column('요청자', 'text', 16, ({ row }) => (row.kind === 'partial_cancellation' ? '운영자 처리' : row.requesterName || '이름 미등록')),
  ];
  return {
    screen: 'refund-transfers',
    title: ADMIN_LIST_EXPORT_SCREENS['refund-transfers'].label,
    ...table(columns, lines),
    recordCount: input.rows.length,
    conditions: [['대상', '송금 대기 중인 무통장 환불 전체']],
    notes: [
      '한 행은 송금을 기다리는 무통장 환불 요청 한 건입니다. 결제자에게 송금 대기 금액을 보낸 뒤 요청 상세에서 송금 완료를 기록해야 이 목록에서 빠집니다.',
      ...(input.rows.some(row => row.kind === 'partial_cancellation') ? ['유형이 "부분 취소"인 행은 재고 부족 부분 취소의 환불입니다. 송금 완료는 주문 상세의 부분 취소 기록에서 적습니다.'] : []),
      ...(includeAccount ? [
        '은행·계좌번호·예금주는 고객이 환불 접수 때 등록한 계좌 원문입니다. 계좌 상태가 "확인됨"이 아닌 요청은 계좌 칸이 비어 있으니 요청 상세에서 확인한 뒤 송금하세요.',
        '이 파일을 내려받을 때 요청마다 계좌 열람 기록(담당자·시각)이 남았습니다. 송금에만 쓰고, 송금이 끝나면 파일을 삭제해주세요.',
      ] : []),
      '선물 주문도 환불은 결제자 기준입니다. 요청자와 결제자를 혼동하지 마세요.',
      '대기 일수는 취소 확정일부터 내려받은 날까지 한국 날짜로 셉니다.',
    ],
    filters: includeAccount ? { accountExportId: input.accountExportId } : {},
  };
}
