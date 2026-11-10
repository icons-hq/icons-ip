import { isUuid } from '@/lib/uuid';
import { transactionEpochMicros, transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
export const SHIPPING_COLLECT_STATES = ['planned', 'collected', 'void', 'refund_review', 'refunded', 'mismatch'] as const;
export type ShippingCollectState = typeof SHIPPING_COLLECT_STATES[number];
export const SHIPPING_COLLECT_STATE_LABEL: Record<ShippingCollectState, string> = {
  planned: '수납 예정', collected: '외부 수납 확인', void: '미수납 종료', refund_review: '외부 환급 확인 필요', refunded: '외부 전액 환급 확인', mismatch: '수납 금액 불일치',
};
export const SHIPPING_COLLECT_WRITE_EVENTS = ['collected', 'void', 'refund_review', 'refunded', 'mismatch', 'correction'] as const;
export type ShippingCollectWriteEvent = typeof SHIPPING_COLLECT_WRITE_EVENTS[number];
export interface ShippingCollectEvent {
  operationId: string; event: ShippingCollectState | 'correction'; amount: number; recordedAt: string;
  occurredAt: string | null; party: string | null; reversesOperationId: string | null; reference: string | null; note: string | null;
}
export interface ShippingCollectObligation {
  shipmentId: string; orderId: string; originName: string; amount: number; state: ShippingCollectState; revision: number; updatedAt: string; events: ShippingCollectEvent[];
}
export interface ShippingCollectEventContext { orderId: string; expectedActorId: string }
export interface ShippingCollectEventRequest extends ShippingCollectEventContext {
  shipmentId: string; expectedRevision: number; operationId: string; event: ShippingCollectWriteEvent; amount: number; occurredAt: string; party: string; reversesOperationId: string | null; reference: string; note: string;
}
export interface ShippingCollectEventReceipt { operationId: string; obligation: ShippingCollectObligation }
export type ShippingCollectEventResult<T> = { ok: true; value: T } | { ok: false; error: string; uncertain?: boolean; conflict?: boolean };
const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value) && value === value.toLowerCase();
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value === value.trim() && [...value].length > 0 && [...value].length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export function validShippingCollectEventContext(value: unknown): value is ShippingCollectEventContext {
  return transactionRecord(value) && uuid(value.orderId) && uuid(value.expectedActorId);
}
export function parseShippingCollectObligation(value: unknown): ShippingCollectObligation | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['shipmentId', 'orderId', 'originName', 'amount', 'state', 'revision', 'updatedAt', 'events'])
    || !uuid(value.shipmentId) || !uuid(value.orderId) || !text(value.originName, 200) || !transactionInteger(value.amount, 1)
    || !SHIPPING_COLLECT_STATES.includes(value.state as ShippingCollectState) || !transactionInteger(value.revision, 1, 2147483647)
    || !transactionInstant(value.updatedAt) || !Array.isArray(value.events)) return null;
  const events: ShippingCollectEvent[] = [];const ids = new Set<string>();
  for (const row of value.events) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['operationId', 'event', 'amount', 'recordedAt', 'occurredAt', 'party', 'reversesOperationId', 'reference', 'note'])
      || !uuid(row.operationId) || ids.has(row.operationId) || ![...SHIPPING_COLLECT_STATES, 'correction'].includes(String(row.event))
      || !transactionInteger(row.amount) || !transactionInstant(row.recordedAt)
      || (row.party !== null && !text(row.party, 200)) || (row.reversesOperationId !== null && !uuid(row.reversesOperationId))
      || (row.occurredAt !== null && !transactionInstant(row.occurredAt)) || (row.reference !== null && !text(row.reference, 1000)) || (row.note !== null && !text(row.note, 1000))) return null;
    ids.add(row.operationId);events.push(row as unknown as ShippingCollectEvent);
  }
  return { shipmentId: value.shipmentId, orderId: value.orderId, originName: value.originName, amount: value.amount,
    state: value.state as ShippingCollectState, revision: value.revision, updatedAt: value.updatedAt, events };
}
export function parseShippingCollectObligations(value: unknown, orderId: string): ShippingCollectObligation[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map(parseShippingCollectObligation);
  if (rows.some(row => !row || row.orderId !== orderId) || new Set(rows.map(row => row?.shipmentId)).size !== rows.length) return null;
  return rows as ShippingCollectObligation[];
}
export function parseShippingCollectEventRequest(value: unknown): ShippingCollectEventRequest | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['orderId', 'expectedActorId', 'shipmentId', 'expectedRevision', 'operationId', 'event', 'amount', 'occurredAt', 'party', 'reversesOperationId', 'reference', 'note'])
    || !validShippingCollectEventContext(value) || !uuid(value.shipmentId) || !uuid(value.operationId)
    || !transactionInteger(value.expectedRevision, 1, 2147483647) || !SHIPPING_COLLECT_WRITE_EVENTS.includes(value.event as ShippingCollectWriteEvent)
    || !transactionInteger(value.amount) || !transactionInstant(value.occurredAt) || !text(value.party, 200)
    || (value.event === 'correction' ? !uuid(value.reversesOperationId) : value.reversesOperationId !== null) || !text(value.reference, 1000) || !text(value.note, 1000)) return null;
  return value as unknown as ShippingCollectEventRequest;
}
export function parseShippingCollectEventReceipt(value: unknown): ShippingCollectEventReceipt | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['operationId', 'obligation']) || !uuid(value.operationId)) return null;
  const obligation = parseShippingCollectObligation(value.obligation);
  return obligation && obligation.events.some(event => event.operationId === value.operationId) ? { operationId: value.operationId, obligation } : null;
}
export function shippingCollectEventReceiptMatches(receipt: ShippingCollectEventReceipt, request: ShippingCollectEventRequest): boolean {
  const event = receipt.obligation.events.find(row => row.operationId === request.operationId);
  return receipt.operationId === request.operationId && receipt.obligation.orderId === request.orderId && receipt.obligation.shipmentId === request.shipmentId
    && receipt.obligation.revision === request.expectedRevision + 1 && event?.event === request.event && event.amount === request.amount
    && event.occurredAt !== null && transactionEpochMicros(event.occurredAt) === transactionEpochMicros(request.occurredAt) && event.party === request.party && event.reversesOperationId === request.reversesOperationId && event.reference === request.reference && event.note === request.note;
}
export function shippingCollectEventError(message = ''): string {
  if (message.includes('auth_context_changed') || message.includes('operator_capability_required')) return '계정 또는 주문 처리 권한이 바뀌었습니다. 현재 계정으로 다시 열어주세요.';
  if (message.includes('shipping_collect_changed')) return '다른 수납 기록이 저장됐습니다. 최신 내역을 불러온 뒤 입력을 확인해주세요.';
  if (message.includes('shipping_collect_correction_requires_latest')) return '가장 최근 기록과 같은 금액을 지정하고 정정 근거를 입력해주세요. 이미 정정된 기록은 다시 정정할 수 없습니다.';
  if (message.includes('shipping_collect_terminal')) return '이미 종료된 착불 기록입니다. 기존 기록을 확인해주세요.';
  if (message.includes('shipping_collect_void_requires_uncollected_cancel')) return '취소된 주문의 미수납 근거가 있어야 미수납으로 종료할 수 있습니다. 수납된 금액은 환급 확인으로 처리해주세요.';
  if (message.includes('shipping_collect_refund_requires_full_cancel')) return '온라인 주문의 전액 취소와 외부 착불 전액 환급을 확인해주세요.';
  if (message.includes('shipping_collect_mismatch_requires_difference')) return '불일치 기록에는 예정 금액과 다른 실제 확인 금액을 입력해주세요.';
  if (message.includes('shipping_collect_amount_or_state')) return '결제된 주문인지 확인하고 주문 당시 착불 금액과 같은 금액을 입력해주세요.';
  if (message.includes('invalid_shipping_collect_time')) return '주문 이후부터 현재까지의 실제 수납·환급 시각을 입력해주세요.';
  return '수납 상태·금액·증빙과 저장 기준을 확인해주세요.';
}

export interface ShippingCollectOperationRecovery extends ShippingCollectEventContext { version: 1; sessionId: string; shipmentId: string; operationId: string }
export function shippingCollectRecoveryKey(context: ShippingCollectEventContext, sessionId: string, shipmentId: string): string {
  return `icons:shipping-collect:operation:v1:${context.expectedActorId}:${sessionId}:${context.orderId}:${shipmentId}`;
}
export function parseShippingCollectRecovery(value: unknown, context: ShippingCollectEventContext, sessionId: string, shipmentId: string): ShippingCollectOperationRecovery | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['version', 'sessionId', 'orderId', 'expectedActorId', 'shipmentId', 'operationId'])
    || value.version !== 1 || !uuid(value.operationId) || !uuid(value.sessionId) || value.sessionId !== sessionId || value.orderId !== context.orderId
    || value.expectedActorId !== context.expectedActorId || value.shipmentId !== shipmentId) return null;
  return value as unknown as ShippingCollectOperationRecovery;
}
