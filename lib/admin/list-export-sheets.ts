/*
 * 화면별 목록 엑셀의 열과 행.
 *
 * 열 이름은 화면 라벨을 따른다. 상품명·옵션·수량을 각각 한 칸에 두기 위해 주문·배송 건·
 * 요청 목록은 상품 한 줄을 한 행으로 펼친다(스마트스토어 주문 엑셀과 같은 단위).
 * 주문 단위 금액은 행마다 반복되므로 안내 시트에 합계를 내는 열을 밝힌다.
 */
import { adminGoodsCopy, ADMIN_VOCABULARY as V } from './vocabulary';
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
  type ShipmentConsoleRow,
  type ShipmentConsoleSurface,
} from './shipment-dispatch';
import {
  ADMIN_CLAIM_REASON_OPTIONS,
  ADMIN_CLAIM_STAGE_OPTIONS,
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
import { ORDER_WITHDRAWAL_REASON_LABELS, orderReferenceLabel, paymentStatusLabel } from '@/lib/orders';
import {
  ORDER_CLAIM_REFUND_METHOD_LABELS,
  ORDER_CLAIM_STAGE_LABELS,
  ORDER_CLAIM_TYPE_LABELS,
  orderClaimReferenceLabel,
  orderClaimSlaState,
  type OrderClaimType,
} from '@/lib/orders/claims';
import { shippingCarrierLabel, type ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { shipmentStatusLabel, type ShipmentRecord, type ShipmentStatus } from '@/lib/orders/shipments';
import { bankTransferDepositName } from '@/lib/payments/bank-transfer';
import { DELIVERY_METHOD_LABELS, deliveryStatusLabel, type ShipmentDeliverySummary } from '@/lib/shipment-delivery';

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

/** 배송 건 번호 표기 — 화면과 같은 끝 8자리 대문자. */
export function listExportShipmentReference(id: string) {
  return id.slice(-8).toUpperCase();
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

function carrierText(carriers: ShippingCarrierRegistry, code: string | null) {
  if (!code) return '';
  return shippingCarrierLabel(carriers, code) ?? code;
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
}): AdminListExportSheet {
  const lines: OrderLine[] = input.records.flatMap((order) => {
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
    column('주문번호', 'code', 12, ({ order }) => orderReferenceLabel(order.id)),
    column('전체 주문번호', 'code', 38, ({ order }) => order.id),
    column('주문일시', 'text', 17, ({ order }) => nullable(kstDateTimeText(order.createdAt))),
    column('주문 상태', 'text', 12, ({ order }) => ADMIN_ORDER_STATUS_LABELS[order.status]),
    column('구매자', 'text', 16, ({ order }) => order.buyerName),
    column('이메일', 'text', 26, ({ order }) => blank(order.buyerEmail)),
    column('수취인', 'text', 12, ({ order }) => blank(order.address?.recipientName)),
    column('결제수단', 'text', 12, ({ paymentMethod }) => nullable(listExportPaymentMethodLabel(paymentMethod))),
    column('결제 상태', 'text', 12, ({ order }) => nullable(order.payments.map((payment) => paymentStatusLabel(payment.status)).join(', '))),
    column('결제금액', 'amount', 12, ({ order }) => order.total),
    column(V.goods + '명', 'text', 32, ({ item }) => blank(item?.name)),
    column(V.option, 'text', 18, ({ item }) => blank(item?.variantName)),
    column('옵션코드', 'code', 16, ({ item }) => blank(item?.variantCode)),
    column('수량', 'count', 8, ({ item }) => item?.qty ?? null),
    column('판매가', 'amount', 12, ({ item }) => item?.unitPrice ?? null),
    column(`${V.goods} 금액`, 'amount', 12, ({ item }) => (item ? item.unitPrice * item.qty : null)),
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
      ['주문일', listExportPeriodLabel(filters.from, filters.to)],
    ],
    notes: [
      `한 행은 주문의 ${V.goods} 한 줄입니다. 결제금액은 주문 단위 값이라 같은 주문의 행마다 반복됩니다. 합계는 ${V.goods} 금액 열로 계산해주세요.`,
    ],
    filters: {
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
    column('주문코드', 'code', 12, (row) => row.depositCode),
    column('전체 주문번호', 'code', 38, (row) => row.id),
    column('구매자', 'text', 16, (row) => row.buyerName),
    column('안내된 입금자명', 'text', 20, (row) => bankTransferDepositName(row.recipientName, row.id)),
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
    conditions: [['검색어', queryText(input.filters.query)]],
    notes: ['한 행은 입금을 기다리는 무통장 입금 주문 한 건입니다. 입금 대조에 필요하지 않은 주소·연락처는 담지 않습니다.'],
    filters: { query: input.filters.query || null },
  };
}

/* ------------------------------------------------------------------------- */
/* 발주·발송 관리 / 배송현황 관리 — 배송 건의 상품 한 줄이 한 행 */

interface ShipmentLine {
  row: ShipmentConsoleRow;
  item: ShipmentConsoleRow['items'][number] | null;
  contact: ListExportContact | null;
}

export function shipmentsListExportSheet(input: {
  surface: ShipmentConsoleSurface;
  rows: ShipmentConsoleRow[];
  filters: ShipmentConsoleFilters;
  contacts: ReadonlyMap<string, ListExportContact | null>;
  origins: { id: string; name: string }[];
  carriers: ShippingCarrierRegistry;
}): AdminListExportSheet {
  const { surface, filters, carriers } = input;
  const isDispatch = surface === 'dispatch';
  const lines: ShipmentLine[] = input.rows.flatMap((row) => {
    const contact = input.contacts.get(row.orderId) ?? null;
    if (!row.items.length) return [{ row, item: null, contact }];
    return row.items.map((item) => ({ row, item, contact }));
  });

  const columns: ColumnSpec<ShipmentLine>[] = [
    column('배송건번호', 'code', 12, ({ row }) => listExportShipmentReference(row.id)),
    column('전체 배송건번호', 'code', 38, ({ row }) => row.id),
    column('주문번호', 'code', 12, ({ row }) => orderReferenceLabel(row.orderId)),
    column('전체 주문번호', 'code', 38, ({ row }) => row.orderId),
    column('출고지', 'text', 10, ({ row }) => blank(row.originName)),
    column('배송 방식', 'text', 10, ({ row }) => deliveryLabels(row.delivery, row.status).method),
    column('배송 상태', 'text', 12, ({ row }) => nullable(deliveryLabels(row.delivery, row.status).status)),
    column('주문일시', 'text', 17, ({ row }) => nullable(kstDateTimeText(row.createdAt))),
    column('발주확인일시', 'text', 17, ({ row }) => nullable(kstDateTimeText(row.confirmedAt))),
    column('발송일시', 'text', 17, ({ row }) => nullable(kstDateTimeText(row.shippedAt))),
    column('배송완료일시', 'text', 17, ({ row }) => nullable(kstDateTimeText(row.deliveredAt))),
    column('구매자', 'text', 16, ({ row }) => row.buyerName),
    column('수취인', 'text', 12, ({ row, contact }) => blank(contact?.recipientName || row.recipientName)),
    column('연락처', 'code', 14, ({ contact }) => blank(contact?.phone)),
    column('우편번호', 'code', 8, ({ contact }) => blank(contact?.postalCode)),
    column('주소', 'text', 48, ({ contact }) => blank(contact?.address)),
    column('배송메시지', 'text', 24, ({ contact }) => blank(contact?.deliveryNote)),
    column(V.goods + '명', 'text', 32, ({ item }) => blank(item?.name)),
    column(V.option, 'text', 18, ({ item }) => blank(item?.variantName)),
    column('수량', 'count', 8, ({ item }) => item?.qty ?? null),
    column('결제금액', 'amount', 12, ({ row }) => row.total),
    column('결제수단', 'text', 12, ({ row }) => nullable(listExportPaymentMethodLabel(row.paymentMethod))),
    column('배송비', 'amount', 10, ({ row }) => row.shippingFee),
    column('택배사', 'text', 12, ({ row }) => nullable(carrierText(carriers, row.carrier))),
    column('운송장번호', 'code', 18, ({ row }) => blank(row.trackingNumber)),
    ...(isDispatch
      ? [column<ShipmentLine>('출고지시 전달일시', 'text', 17, ({ row }) => nullable(kstDateTimeText(row.exportedAt)))]
      : []),
    ...(filters.tab === 'delayed'
      ? [
          column<ShipmentLine>('지연 메모', 'text', 32, ({ row }) => blank(row.delayReason)),
          column<ShipmentLine>('발송 예정일', 'text', 12, ({ row }) => blank(row.expectedShipDate)),
        ]
      : []),
  ];

  const screen: AdminListExportScreenId = surface;
  const tabLabel = SHIPMENT_CONSOLE_TABS[surface].find((tab) => tab.id === filters.tab)?.label ?? filters.tab;
  const originName = filters.originId
    ? input.origins.find((origin) => origin.id === filters.originId)?.name ?? filters.originId
    : '전체 출고지';
  return {
    screen,
    title: `${ADMIN_LIST_EXPORT_SCREENS[screen].label} - ${tabLabel}`,
    ...table(columns, lines),
    recordCount: input.rows.length,
    conditions: [
      ['탭', tabLabel],
      ['출고지', originName],
      ['주문일', listExportPeriodLabel(filters.from, filters.to)],
      ['검색어', queryText(filters.query)],
    ],
    notes: [
      `한 행은 배송 건의 ${V.goods} 한 줄입니다. 결제금액은 주문 단위, 배송비는 배송 건 단위 값이라 같은 주문·배송 건의 행마다 반복됩니다.`,
      ...(isDispatch
        ? ['창고에 전달하는 출고지시 파일과 다른 확인용 목록입니다. 이 파일을 내려받아도 출고지시 전달 기록은 바뀌지 않습니다.']
        : []),
    ],
    filters: {
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
  const lines: ClaimLine[] = input.rows.flatMap((claim) => {
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
    column('주문번호', 'code', 12, ({ claim }) => orderReferenceLabel(claim.orderId)),
    column('전체 주문번호', 'code', 38, ({ claim }) => claim.orderId),
    column('유형', 'text', 8, ({ claim }) => ORDER_CLAIM_TYPE_LABELS[claim.claimType]),
    column('사유', 'text', 16, ({ claim }) => adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[claim.reasonType])),
    column(V.claimStatus, 'text', 12, ({ claim }) => ORDER_CLAIM_STAGE_LABELS[claim.stage]),
    column('구매자', 'text', 16, ({ claim }) => claim.buyerName),
    column('이메일', 'text', 26, ({ claim }) => blank(claim.buyerEmail)),
    column('결제금액', 'amount', 12, ({ claim }) => claim.orderTotal),
    column('접수일시', 'text', 17, ({ claim }) => nullable(kstDateTimeText(claim.requestedAt))),
    column('입고 확인일시', 'text', 17, ({ claim }) => nullable(kstDateTimeText(claim.collectedAt))),
    column('완료일시', 'text', 17, ({ claim }) => nullable(kstDateTimeText(claim.completedAt))),
    column('환급 기한', 'text', 12, ({ claim }) => orderClaimSlaState(claim, now).label),
    column('환불 수단', 'text', 12, ({ claim }) => (claim.refundMethod ? ORDER_CLAIM_REFUND_METHOD_LABELS[claim.refundMethod] : '미접수')),
    column('처리자', 'text', 14, ({ claim }) => claim.handlerName ?? '미배정'),
    column(V.goods + '명', 'text', 32, ({ item }) => blank(item?.name)),
    column(V.option, 'text', 18, ({ item }) => blank(item?.variantName)),
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
      ['접수일', listExportPeriodLabel(filters.from, filters.to)],
      ['검색어', queryText(filters.query)],
    ],
    notes: [
      `한 행은 요청 주문의 ${V.goods} 한 줄입니다. ${V.claimRequest}은 주문 단위로 처리되며 결제금액은 같은 요청의 행마다 반복됩니다.`,
      ...(withDelivery ? ['배송지와 운송장은 원래 주문의 출고 정보입니다. 회수 주소는 요청 상세에서 확인합니다.'] : []),
      `환급 기한은 내려받은 시각 기준입니다.`,
    ],
    filters: {
      stage: filters.stage,
      reasonType: filters.reasonType,
      from: filters.from,
      to: filters.to,
      query: filters.query || null,
    },
  };
}
