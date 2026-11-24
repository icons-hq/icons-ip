/**
 * 부분 반품(원장 #17 CLM-025, ADR-0047).
 *
 * 반품은 굿즈·수량을 골라 신청할 수 있다. 판정·금액·회수·환불은 DB(`request_order_partial_return`·`admin_submit_seller_partial_return_intake`·
 * `admin_record_order_claim_refund`의 부분 반품 분기)가 정하고, 이 모듈은 응답 모양을 좁히고 화면 문구를 만든다. 스위치(DB
 * `partial_return_enabled`)가 꺼져 있으면 문맥이 `enabled: false`이고 화면·API는 지금처럼 주문 전체 반품만 받는다.
 */
import { normalizeOrderPartialCancellationSelection, parseOrderPartialCancellationRecords, type OrderPartialCancellationRecord, type OrderPartialCancellationSelection } from './partial-cancellation';

export type OrderPartialReturnSelection = OrderPartialCancellationSelection;

export interface OrderPartialReturnItem {
  orderItemId: string;
  goodName: string;
  variantName: string | null;
  orderedQty: number;
  /** 지금 고를 수 있는 최대 수량(주문 수량 − 적용된 부분 취소·부분 반품). */
  activeQty: number;
  returnedQty: number;
  unitPrice: number;
  shipmentId: string | null;
  shipmentNumber: string | null;
  originName: string | null;
  /** 고를 수 없는 이유 코드(null이면 고를 수 있다). */
  blocker: string | null;
  /** 반품 제한 굿즈(상품의 반품 조건). 고를 수 있고 사유를 함께 보인다(ADR-0017 — 고지일 뿐 접수를 막지 않는다). */
  returnRestricted: boolean;
  restrictionReason: string | null;
}

export interface OrderPartialReturnContext {
  enabled: boolean;
  /** 주문 단위로 부분 반품을 열 수 없는 이유(선물·결제 수단·배분). null이면 열린다. 주문 전체 반품은 그대로 열린다. */
  blocker: string | null;
  items: OrderPartialReturnItem[];
}

export const DISABLED_PARTIAL_RETURN: OrderPartialReturnContext = Object.freeze({ enabled: false, blocker: null, items: [] }) as OrderPartialReturnContext;

/** 주문 단위로 부분 반품이 막힌 이유. */
export const PARTIAL_RETURN_ORDER_BLOCKER_LABELS: Record<string, string> = {
  gift_order: '선물 주문은 주문 전체로만 반품을 신청할 수 있습니다.',
  unsupported_payment: '이 결제 수단은 일부 금액만 취소할 수 없어 주문 전체로만 반품을 신청할 수 있습니다.',
  payment_unavailable: '결제 정보를 확인할 수 없어 주문 전체로만 반품을 신청할 수 있습니다.',
  payment_reconciliation_required: '결제 결과를 확인하는 중이라 지금은 일부 반품을 신청할 수 없습니다.',
  legacy_order: '이전 방식으로 계산된 주문이라 주문 전체로만 반품을 신청할 수 있습니다.',
  v1_allocation_mismatch: '할인·적립금 배분을 확정할 수 없는 주문이라 주문 전체로만 반품을 신청할 수 있습니다.',
  v1_allocation_unavailable: '할인·적립금 배분을 확정할 수 없는 주문이라 주문 전체로만 반품을 신청할 수 있습니다.',
  payment_refunded_by_transfer: '앞선 반품 환불을 계좌로 송금한 결제라 일부 반품은 1:1 문의로 신청해 주세요.',
  order_not_found: '주문을 찾을 수 없습니다.',
};

/** 품목 단위로 고를 수 없는 이유. */
export const PARTIAL_RETURN_ITEM_BLOCKER_LABELS: Record<string, string> = {
  fully_returned: '이미 모두 반품·취소된 상품입니다.',
  digital_item: '디지털·배송 없는 상품은 반품 대상이 아닙니다.',
  production_item: '주문제작 상품은 일부 반품을 신청할 수 없습니다. 하자·오배송이면 1:1 문의로 알려주세요.',
  allocation_missing: '결제 금액 배분을 확인할 수 없는 상품입니다.',
  shipment_missing: '배송 정보를 확인할 수 없는 상품입니다.',
  shipment_not_dispatched: '아직 발송되지 않은 상품입니다.',
  stock_topology_changed: '교환·상품 통합 이력이 있어 수량을 나눠 반품할 수 없는 상품입니다. 주문 전체 반품이나 1:1 문의로 알려주세요.',
  preorder_not_allocated: '예약 판매 상품의 출고 준비가 끝나지 않았습니다.',
  supply_unavailable: '일부 반품을 신청할 수 없는 상품입니다.',
  order_item_not_found: '주문에 없는 상품입니다.',
};

export function partialReturnOrderBlockerLabel(code: string | null) {
  return code ? PARTIAL_RETURN_ORDER_BLOCKER_LABELS[code] ?? '이 주문은 주문 전체로만 반품을 신청할 수 있습니다.' : null;
}

export function partialReturnItemBlockerLabel(code: string | null) {
  return code ? PARTIAL_RETURN_ITEM_BLOCKER_LABELS[code] ?? '일부 반품을 신청할 수 없는 상품입니다.' : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid partial return');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid partial return');
  return value;
}
function optionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid partial return');
  return value;
}
function uuid(value: unknown): string {
  const parsed = text(value);
  if (!UUID.test(parsed)) throw new Error('invalid partial return');
  return parsed.toLowerCase();
}
function optionalUuid(value: unknown): string | null {
  return value === null || value === undefined ? null : uuid(value);
}

function parseItem(value: unknown): OrderPartialReturnItem {
  const row = record(value);
  return {
    orderItemId: uuid(row.orderItemId),
    goodName: text(row.goodName),
    variantName: optionalText(row.variantName),
    orderedQty: count(row.orderedQty),
    activeQty: count(row.activeQty),
    returnedQty: row.returnedQty === undefined ? 0 : count(row.returnedQty),
    unitPrice: row.unitPrice === undefined ? 0 : count(row.unitPrice),
    shipmentId: optionalUuid(row.shipmentId),
    shipmentNumber: optionalText(row.shipmentNumber),
    originName: optionalText(row.originName),
    blocker: optionalText(row.blocker),
    returnRestricted: row.returnRestricted === true,
    restrictionReason: optionalText(row.restrictionReason),
  };
}

/** 구매자·운영자 문맥. 읽지 못하거나 모양이 틀리면 꺼진 것으로 읽는다 — 약속하지 않은 부분 반품을 화면에 열지 않는다. */
export function parseOrderPartialReturnContext(value: unknown): OrderPartialReturnContext {
  try {
    const row = record(value);
    if (row.enabled !== true) return DISABLED_PARTIAL_RETURN;
    return { enabled: true, blocker: optionalText(row.blocker), items: Array.isArray(row.items) ? row.items.map(parseItem) : [] };
  } catch {
    return DISABLED_PARTIAL_RETURN;
  }
}

/** 공개 정책(`get_partial_return_policy`). 읽지 못하면 꺼짐. */
export function parsePartialReturnPolicy(value: unknown): { enabled: boolean } {
  return { enabled: Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).enabled === true) };
}

/** 고를 수 있는 품목(막힌 이유 없음·남은 수량 있음). */
export function selectablePartialReturnItems(context: OrderPartialReturnContext) {
  return context.enabled && !context.blocker ? context.items.filter((item) => !item.blocker && item.activeQty > 0) : [];
}

/** 고른 수량 지도(품목 → 수량)를 요청 본문으로 좁힌다. 0개는 빼고, 남은 수량을 넘거나 고를 수 없는 품목이면 null. 아무것도 안 고르면 null. */
export function partialReturnSelectionFromQuantities(context: OrderPartialReturnContext, quantities: Readonly<Record<string, number>>): OrderPartialReturnSelection[] | null {
  const selectable = new Map(selectablePartialReturnItems(context).map((item) => [item.orderItemId, item]));
  const selection: OrderPartialReturnSelection[] = [];
  for (const [orderItemId, qty] of Object.entries(quantities)) {
    if (!Number.isSafeInteger(qty) || qty < 0) return null;
    if (qty === 0) continue;
    const item = selectable.get(orderItemId.toLowerCase());
    if (!item || qty > item.activeQty) return null;
    selection.push({ orderItemId: item.orderItemId, qty });
  }
  if (!selection.length) return null;
  return normalizeOrderPartialReturnSelection(selection);
}

/** 고른 품목이 남은 수량 전부인지(→ 서버가 주문 전체 반품으로 접수한다). */
export function partialReturnCoversAll(context: OrderPartialReturnContext, selection: readonly OrderPartialReturnSelection[]) {
  const chosen = new Map(selection.map((entry) => [entry.orderItemId, entry.qty]));
  return context.items.every((item) => (chosen.get(item.orderItemId) ?? 0) === item.activeQty);
}

export function normalizeOrderPartialReturnSelection(value: unknown): OrderPartialReturnSelection[] | null {
  return normalizeOrderPartialCancellationSelection(value);
}

/** 운영 클레임 상세의 부분 반품 칸(`admin_order_claim_partial_return`). 주문 전체 클레임이면 null. */
export interface AdminClaimPartialReturnItem {
  orderItemId: string;
  goodName: string;
  variantName: string | null;
  variantCode: string | null;
  qty: number;
  orderedQty: number;
  shipmentNumber: string | null;
  originName: string | null;
}

export interface AdminClaimPartialReturnPreview {
  provider: string;
  balanceBefore: number;
  goodsRefundAmount: number;
  shippingRefundAmount: number;
  grossRefundAmount: number;
  returnFeeDeduction: number;
  returnFeeBasis: 'one_way' | 'round_trip' | null;
  returnFeeReason: string | null;
  refundAmount: number;
  storeCreditRestoreAmount: number;
  emptiedShipmentCount: number;
}

export interface AdminClaimPartialReturn {
  items: AdminClaimPartialReturnItem[];
  /** 살아 있는 부분 환불 원장 id(환불 접수 뒤). 결제사가 받지 않아 닫힌 줄 뒤에 다시 접수하기 전이면 null. */
  refundId: string | null;
  history: OrderPartialCancellationRecord[];
  preview: AdminClaimPartialReturnPreview | null;
  /** 미리보기를 계산하지 못한 이유 코드(DB 거절 문구). */
  previewError: string | null;
  /** 살아 있는 원장의 정산 경로: toss = 결제사 부분 취소, bank_transfer = 계좌 송금(무통장 결제 또는 계좌 송금 전환). 원장이 없으면 null. */
  settlement: 'toss' | 'bank_transfer' | null;
  /** 결제사가 부분 취소를 받지 않아 닫힌 뒤 계좌 송금 부분 환불로 바꿀 수 있는지(결제 담당에게만 true). */
  transferConvertible: boolean;
}

export function parseAdminClaimPartialReturn(value: unknown): AdminClaimPartialReturn | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  let preview: AdminClaimPartialReturnPreview | null = null;
  let previewError: string | null = null;
  if (row.preview !== null && row.preview !== undefined) {
    const p = record(row.preview);
    if (typeof p.error === 'string') previewError = p.error;
    else {
      const fee = p.returnFee && typeof p.returnFee === 'object' ? p.returnFee as Record<string, unknown> : {};
      preview = {
        provider: text(p.provider),
        balanceBefore: count(p.balanceBefore),
        goodsRefundAmount: count(p.goodsRefundAmount),
        shippingRefundAmount: count(p.shippingRefundAmount),
        grossRefundAmount: count(p.grossRefundAmount),
        returnFeeDeduction: count(p.returnFeeDeduction),
        returnFeeBasis: fee.basis === 'round_trip' || fee.basis === 'one_way' ? fee.basis : null,
        returnFeeReason: typeof fee.reason === 'string' ? fee.reason : null,
        refundAmount: count(p.refundAmount),
        storeCreditRestoreAmount: count(p.storeCreditRestoreAmount),
        emptiedShipmentCount: Array.isArray(p.emptiedShipments) ? p.emptiedShipments.length : 0,
      };
    }
  }
  return {
    items: (Array.isArray(row.items) ? row.items : []).map((entry) => {
      const item = record(entry);
      return {
        orderItemId: uuid(item.orderItemId), goodName: text(item.goodName), variantName: optionalText(item.variantName),
        variantCode: optionalText(item.variantCode), qty: count(item.qty), orderedQty: count(item.orderedQty),
        shipmentNumber: optionalText(item.shipmentNumber), originName: optionalText(item.originName),
      };
    }),
    refundId: optionalUuid(row.refundId),
    history: parseOrderPartialCancellationRecords(row.history),
    preview,
    previewError,
    settlement: row.settlement === 'toss' || row.settlement === 'bank_transfer' ? row.settlement : null,
    transferConvertible: row.transferConvertible === true,
  };
}

/** 구매자 주문 상세: 부분 반품 클레임에 고른 굿즈(`get_my_order_claim_items`). */
export interface MyOrderClaimItem {
  claimId: string;
  orderItemId: string;
  goodName: string;
  variantName: string | null;
  qty: number;
}

export function parseMyOrderClaimItems(value: unknown): MyOrderClaimItem[] {
  if (!Array.isArray(value)) return [];
  try {
    return value.map((entry) => {
      const row = record(entry);
      return { claimId: uuid(row.claimId), orderItemId: uuid(row.orderItemId), goodName: text(row.goodName), variantName: optionalText(row.variantName), qty: count(row.qty) };
    });
  } catch {
    return [];
  }
}

const KRW = new Intl.NumberFormat('ko-KR');

/** '반품 신청 굿즈: A (옵션) 1개, B 2개' */
export function partialReturnItemsLabel(items: readonly Pick<MyOrderClaimItem, 'goodName' | 'variantName' | 'qty'>[]) {
  return items.map((item) => `${item.goodName}${item.variantName ? ` (${item.variantName})` : ''} ${KRW.format(item.qty)}개`).join(', ');
}
