/**
 * 재고 부족 품목·수량 부분 취소(QNA-020, ADR-0032).
 *
 * 운영자가 발송 전 주문에서 품목·수량을 골라(고객 결정 기록 필수) 그 몫만 환불하고 나머지를 출고한다. 금액·판정·적용은 DB
 * (`admin_*_order_partial_cancellation*`, `service_*_order_partial_cancellation`)가 정하고, 이 모듈은 응답 모양을 좁히고
 * 화면 문구를 만든다. 스위치(DB `partial_cancel_enabled`)가 꺼져 있으면 문맥이 `enabled: false`이고 화면은 아무것도 그리지 않는다.
 */

export const ORDER_PARTIAL_CANCELLATION_STATES = ['processing', 'needs_review', 'rejected', 'completed', 'awaiting_transfer'] as const;
export type OrderPartialCancellationState = (typeof ORDER_PARTIAL_CANCELLATION_STATES)[number];
export type OrderPartialCancellationProvider = 'toss' | 'bank_transfer';

export interface OrderPartialCancellationItem {
  orderItemId: string;
  goodName: string;
  variantName: string | null;
  qty: number;
  goodsRefundAmount: number;
}

export interface OrderPartialCancellationClosedShipment {
  shipmentId: string;
  shipmentNumber: string | null;
  originName: string;
  shippingFeeRefund: number;
}

/** 한 번의 부분 취소. staff 필드는 운영자 문맥에서만 있다. */
export interface OrderPartialCancellationRecord {
  id: string;
  sequence: number;
  state: OrderPartialCancellationState;
  provider: OrderPartialCancellationProvider;
  refundAmount: number;
  goodsRefundAmount: number;
  shippingRefundAmount: number;
  storeCreditRestoreAmount: number;
  createdAt: string;
  appliedAt: string | null;
  completedAt: string | null;
  transferredAt: string | null;
  items: OrderPartialCancellationItem[];
  closedShipmentCount: number;
  staff?: {
    customerDecision: string;
    note: string | null;
    warehouseStopConfirmed: boolean;
    lastErrorCode: string | null;
    balanceBefore: number;
    paymentAmount: number;
    createdBy: string | null;
    transferEvidence: string | null;
    transferNote: string | null;
    closedShipments: OrderPartialCancellationClosedShipment[];
    refundAccount: { maskedAccount: string; maskedHolder: string; purged: boolean } | null;
  };
}

export interface OrderPartialCancellationContextItem {
  orderItemId: string;
  goodName: string;
  variantName: string | null;
  variantCode: string | null;
  orderedQty: number;
  canceledQty: number;
  activeQty: number;
  unitPrice: number;
  shipmentId: string | null;
  shipmentNumber: string | null;
  originName: string | null;
  exported: boolean;
  blocker: string | null;
}

export interface OrderPartialCancellationContext {
  enabled: boolean;
  blockers: string[];
  provider: string | null;
  paymentAmount: number | null;
  balance: number | null;
  items: OrderPartialCancellationContextItem[];
  history: OrderPartialCancellationRecord[];
}

export interface OrderPartialCancellationPlanLine {
  orderItemId: string;
  shipmentId: string;
  shipmentNumber: string | null;
  originName: string;
  exported: boolean;
  goodName: string;
  variantName: string | null;
  qty: number;
  orderedQty: number;
  remainingQtyAfter: number;
  goodsRefundAmount: number;
  couponDiscount: number;
  storeCreditDiscount: number;
}

export interface OrderPartialCancellationPlan {
  provider: OrderPartialCancellationProvider;
  paymentAmount: number;
  balanceBefore: number;
  goodsRefundAmount: number;
  shippingRefundAmount: number;
  refundAmount: number;
  balanceAfter: number;
  storeCreditRestoreAmount: number;
  warehouseStopRequired: boolean;
  remainingQty: number;
  lines: OrderPartialCancellationPlanLine[];
  closedShipments: Array<OrderPartialCancellationClosedShipment & { shippingCollectFee: number; exported: boolean }>;
}

/** 오케스트레이터가 service RPC에서 읽는 모양(토스 부분 취소). */
export interface OrderPartialCancellationServiceRow {
  id: string;
  orderId: string;
  paymentId: string;
  provider: OrderPartialCancellationProvider;
  state: OrderPartialCancellationState;
  paymentAmount: number;
  balanceBefore: number;
  refundAmount: number;
  paymentKey: string | null;
  paymentStatus: string;
  paymentLiveAmount: number;
}

export interface OrderPartialCancellationSelection {
  orderItemId: string;
  qty: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set<string>(ORDER_PARTIAL_CANCELLATION_STATES);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid partial cancellation');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid partial cancellation');
  return value;
}
function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return text(value);
}
function amount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid partial cancellation');
  return value;
}
function optionalAmount(value: unknown): number | null {
  return value === null || value === undefined ? null : amount(value);
}
function uuid(value: unknown): string {
  const parsed = text(value);
  if (!UUID.test(parsed)) throw new Error('invalid partial cancellation');
  return parsed.toLowerCase();
}
function state(value: unknown): OrderPartialCancellationState {
  if (typeof value !== 'string' || !STATES.has(value)) throw new Error('invalid partial cancellation');
  return value as OrderPartialCancellationState;
}
function provider(value: unknown): OrderPartialCancellationProvider {
  if (value !== 'toss' && value !== 'bank_transfer') throw new Error('invalid partial cancellation');
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('invalid partial cancellation');
  return value;
}

function parseClosedShipment(value: unknown): OrderPartialCancellationClosedShipment {
  const row = record(value);
  return { shipmentId: uuid(row.shipmentId), shipmentNumber: optionalText(row.shipmentNumber), originName: text(row.originName),
    shippingFeeRefund: amount(row.shippingFeeRefund) };
}

export function parseOrderPartialCancellationRecord(value: unknown): OrderPartialCancellationRecord {
  const row = record(value);
  const parsed: OrderPartialCancellationRecord = {
    id: uuid(row.id),
    sequence: amount(row.sequence),
    state: state(row.state),
    provider: provider(row.provider),
    refundAmount: amount(row.refundAmount),
    goodsRefundAmount: amount(row.goodsRefundAmount),
    shippingRefundAmount: amount(row.shippingRefundAmount),
    storeCreditRestoreAmount: amount(row.storeCreditRestoreAmount),
    createdAt: text(row.createdAt),
    appliedAt: optionalText(row.appliedAt),
    completedAt: optionalText(row.completedAt),
    transferredAt: optionalText(row.transferredAt),
    items: array(row.items).map((entry) => {
      const item = record(entry);
      return { orderItemId: uuid(item.orderItemId), goodName: text(item.goodName), variantName: optionalText(item.variantName),
        qty: amount(item.qty), goodsRefundAmount: amount(item.goodsRefundAmount) };
    }),
    closedShipmentCount: amount(row.closedShipmentCount),
  };
  if (parsed.refundAmount !== parsed.goodsRefundAmount + parsed.shippingRefundAmount) throw new Error('invalid partial cancellation');
  if ('customerDecision' in row) {
    const account = row.refundAccount === null || row.refundAccount === undefined ? null : record(row.refundAccount);
    parsed.staff = {
      customerDecision: text(row.customerDecision),
      note: optionalText(row.note),
      warehouseStopConfirmed: row.warehouseStopConfirmed === true,
      lastErrorCode: optionalText(row.lastErrorCode),
      balanceBefore: amount(row.balanceBefore),
      paymentAmount: amount(row.paymentAmount),
      createdBy: optionalText(row.createdBy),
      transferEvidence: optionalText(row.transferEvidence),
      transferNote: optionalText(row.transferNote),
      closedShipments: array(row.closedShipments).map(parseClosedShipment),
      refundAccount: account ? { maskedAccount: text(account.maskedAccount), maskedHolder: text(account.maskedHolder), purged: account.purged === true } : null,
    };
  }
  return parsed;
}

export function parseOrderPartialCancellationRecords(value: unknown): OrderPartialCancellationRecord[] {
  if (value === null || value === undefined) return [];
  return array(value).map(parseOrderPartialCancellationRecord);
}

export function parseOrderPartialCancellationContext(value: unknown): OrderPartialCancellationContext {
  const row = record(value);
  if (typeof row.enabled !== 'boolean') throw new Error('invalid partial cancellation');
  return {
    enabled: row.enabled,
    blockers: array(row.blockers ?? []).map(text),
    provider: optionalText(row.provider),
    paymentAmount: optionalAmount(row.paymentAmount),
    balance: optionalAmount(row.balance),
    items: array(row.items ?? []).map((entry) => {
      const item = record(entry);
      return {
        orderItemId: uuid(item.orderItemId), goodName: text(item.goodName), variantName: optionalText(item.variantName),
        variantCode: optionalText(item.variantCode), orderedQty: amount(item.orderedQty), canceledQty: amount(item.canceledQty),
        activeQty: amount(item.activeQty), unitPrice: amount(item.unitPrice),
        shipmentId: item.shipmentId === null || item.shipmentId === undefined ? null : uuid(item.shipmentId),
        shipmentNumber: optionalText(item.shipmentNumber), originName: optionalText(item.originName), exported: item.exported === true,
        blocker: optionalText(item.blocker),
      };
    }),
    history: parseOrderPartialCancellationRecords(row.history),
  };
}

export function parseOrderPartialCancellationPlan(value: unknown): OrderPartialCancellationPlan {
  const row = record(value);
  const plan: OrderPartialCancellationPlan = {
    provider: provider(row.provider),
    paymentAmount: amount(row.paymentAmount),
    balanceBefore: amount(row.balanceBefore),
    goodsRefundAmount: amount(row.goodsRefundAmount),
    shippingRefundAmount: amount(row.shippingRefundAmount),
    refundAmount: amount(row.refundAmount),
    balanceAfter: amount(row.balanceAfter),
    storeCreditRestoreAmount: amount(row.storeCreditRestoreAmount),
    warehouseStopRequired: row.warehouseStopRequired === true,
    remainingQty: amount(row.remainingQty),
    lines: array(row.lines).map((entry) => {
      const line = record(entry);
      return {
        orderItemId: uuid(line.orderItemId), shipmentId: uuid(line.shipmentId), shipmentNumber: optionalText(line.shipmentNumber),
        originName: text(line.originName), exported: line.exported === true, goodName: text(line.goodName),
        variantName: optionalText(line.variantName), qty: amount(line.qty), orderedQty: amount(line.orderedQty),
        remainingQtyAfter: amount(line.remainingQtyAfter), goodsRefundAmount: amount(line.goodsRefundAmount),
        couponDiscount: amount(line.couponDiscount), storeCreditDiscount: amount(line.storeCreditDiscount),
      };
    }),
    closedShipments: array(row.closedShipments).map((entry) => {
      const closed = record(entry);
      return { ...parseClosedShipment(closed), shippingCollectFee: amount(closed.shippingCollectFee), exported: closed.exported === true };
    }),
  };
  if (plan.refundAmount !== plan.goodsRefundAmount + plan.shippingRefundAmount || plan.balanceAfter !== plan.balanceBefore - plan.refundAmount) {
    throw new Error('invalid partial cancellation');
  }
  return plan;
}

export function parseOrderPartialCancellationServiceRow(value: unknown): OrderPartialCancellationServiceRow | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  const parsed: OrderPartialCancellationServiceRow = {
    id: uuid(row.id), orderId: uuid(row.orderId), paymentId: uuid(row.paymentId), provider: provider(row.provider), state: state(row.state),
    paymentAmount: amount(row.paymentAmount), balanceBefore: amount(row.balanceBefore), refundAmount: amount(row.refundAmount),
    paymentKey: optionalText(row.paymentKey), paymentStatus: text(row.paymentStatus), paymentLiveAmount: amount(row.paymentLiveAmount),
  };
  return parsed;
}

/** 운영자가 고른 품목·수량을 좁힌다. 같은 품목을 두 번 고르거나 수량이 정수가 아니면 null. */
export function normalizeOrderPartialCancellationSelection(value: unknown): OrderPartialCancellationSelection[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const seen = new Set<string>();
  const result: OrderPartialCancellationSelection[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const { orderItemId, qty } = entry as Record<string, unknown>;
    if (typeof orderItemId !== 'string' || !UUID.test(orderItemId) || typeof qty !== 'number' || !Number.isSafeInteger(qty) || qty < 1 || qty > 999999) {
      return null;
    }
    const id = orderItemId.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    result.push({ orderItemId: id, qty });
  }
  return result;
}

const KRW = new Intl.NumberFormat('ko-KR');
function won(value: number) { return `${KRW.format(value)}원`; }

/** 'A (옵션) 1개, B 2개' */
export function orderPartialCancellationItemsLabel(items: readonly Pick<OrderPartialCancellationItem, 'goodName' | 'variantName' | 'qty'>[]) {
  return items.map((item) => `${item.goodName}${item.variantName ? ` (${item.variantName})` : ''} ${KRW.format(item.qty)}개`).join(', ');
}

/** 구매자 주문 상세 한 줄: 'A 1개 취소 · 환불 N원' (+ 배송비 함께 환불). */
export function orderPartialCancellationSummary(record: Pick<OrderPartialCancellationRecord, 'items' | 'refundAmount' | 'shippingRefundAmount'>) {
  const shipping = record.shippingRefundAmount > 0 ? ` (배송비 ${won(record.shippingRefundAmount)} 포함)` : '';
  return `${orderPartialCancellationItemsLabel(record.items)} 취소 · 환불 ${won(record.refundAmount)}${shipping}`;
}
