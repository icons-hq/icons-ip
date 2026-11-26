/**
 * 출고지시 뒤 취소의 창고 회신 기록과 '취소 뒤 출고 발견'(ADR-0046).
 *
 * 출고지시 파일이 나간 배송 건은 운영자 전액·부분 취소 전에 창고에 출고 중단을 요청하고, 창고 회신(출고 중단 확인·이미 출고)을
 * 배송 건마다 기록한다. 취소의 근거는 그 회신이다 — 운영자 확인란은 더는 근거가 아니다. 판정·기록의 진실원은 DB
 * (`admin_record_warehouse_stop_reply`, `private.warehouse_stop_gate`)이고 이 모듈은 화면 문구·입력 정리·읽기 해석만 한다.
 */

import { isUuid } from '@/lib/uuid';

/** stopped = 창고가 내보내지 않기로 확인(보관), already_shipped = 이미 내보냄, returned = 이미 나간 상품이 고객 반송으로 창고에 다시 들어옴. */
export const WAREHOUSE_STOP_OUTCOMES = ['stopped', 'already_shipped', 'returned'] as const;
export type WarehouseStopOutcome = typeof WAREHOUSE_STOP_OUTCOMES[number];
export const WAREHOUSE_STOP_OUTCOME_LABELS: Record<WarehouseStopOutcome, string> = {
  stopped: '출고 중단 확인',
  already_shipped: '이미 출고',
  returned: '반송 입고',
};

export const WAREHOUSE_STOP_CHANNELS = ['phone', 'messenger', 'email', 'warehouse_system', 'other'] as const;
export type WarehouseStopChannel = typeof WAREHOUSE_STOP_CHANNELS[number];
export const WAREHOUSE_STOP_CHANNEL_LABELS: Record<WarehouseStopChannel, string> = {
  phone: '전화',
  messenger: '메신저(카카오톡 등)',
  email: '이메일',
  warehouse_system: '창고 시스템',
  other: '기타',
};

/** 배송 건의 지금 출고지시에 대한 회신 판정. not_applicable은 발송 대기 상태가 아닌(취소·발송된) 배송 건이다. */
export type WarehouseStopStatus = 'not_applicable' | 'required' | 'stopped' | 'already_shipped' | 'used';
export const WAREHOUSE_STOP_STATUS_LABELS: Record<Exclude<WarehouseStopStatus, 'not_applicable'>, string> = {
  required: '창고 회신 기록 필요',
  stopped: '출고 중단 회신 있음',
  already_shipped: '이미 출고 회신',
  used: '다른 취소에 쓴 회신',
};

export const CANCELED_DISPATCH_STATES = ['open', 'returned', 'lost'] as const;
export type CanceledDispatchState = typeof CANCELED_DISPATCH_STATES[number];
export const CANCELED_DISPATCH_STATE_LABELS: Record<CanceledDispatchState, string> = {
  open: '처리 대기',
  returned: '회수 입고',
  lost: '손실 처리',
};
export const CANCELED_DISPATCH_RESOLUTIONS = ['returned', 'lost'] as const;
export type CanceledDispatchResolution = typeof CANCELED_DISPATCH_RESOLUTIONS[number];

export const WAREHOUSE_STOP_NOTE_LIMIT = 500;
export const CANCELED_DISPATCH_NOTE_MIN = 5;

export interface WarehouseStopReply {
  id: string;
  outcome: WarehouseStopOutcome;
  channel: WarehouseStopChannel;
  repliedAt: string;
  note: string | null;
  recordedAt: string;
  recordedByName: string | null;
  /** 지금 출고지시에 대한 회신인가(다시 출고지시하면 예전 회신은 false). */
  current: boolean;
  usedKind: WarehouseStopReplyUse | null;
  usedAt: string | null;
  /** 발송으로 반박돼 무효가 된 회신(배송 건이 실제로 발송됨). 판정에서 빠진다. */
  supersededAt: string | null;
}

export const WAREHOUSE_STOP_REPLY_USES = ['staff_cancellation', 'partial_cancellation', 'claim_collection'] as const;
export type WarehouseStopReplyUse = typeof WAREHOUSE_STOP_REPLY_USES[number];

export interface WarehouseStopShipment {
  shipmentId: string;
  shipmentNumber: string | null;
  originName: string;
  status: string;
  exportedAt: string;
  stopStatus: WarehouseStopStatus;
  replies: WarehouseStopReply[];
}

export interface CanceledShipmentDispatchLine {
  orderItemId: string;
  goodName: string;
  variantName: string | null;
  restoredQty: number;
  withdrawnQty: number;
  returnedQty: number | null;
}

export interface CanceledShipmentDispatch {
  id: string;
  shipmentId: string;
  shipmentNumber: string | null;
  originName: string;
  source: 'tracking_reply' | 'warehouse_reply';
  carrier: string | null;
  /** 택배사 이름(레지스트리). 읽는 쪽이 채우면 화면이 코드(epost 등) 대신 이 이름을 보인다. */
  carrierLabel?: string | null;
  trackingNumber: string | null;
  discoveredAt: string;
  discoveredByName: string | null;
  state: CanceledDispatchState;
  restoredQty: number;
  withdrawnQty: number;
  shortfallQty: number;
  returnedQty: number | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  lines: CanceledShipmentDispatchLine[];
}

export interface OrderWarehouseStopContext {
  orderId: string;
  orderStatus: string;
  /** 회신 기록(sales.dispatch, sales.manage 포함). */
  canRecord: boolean;
  /** 발견 처리(sales.manage). */
  canResolve: boolean;
  shipments: WarehouseStopShipment[];
  discoveries: CanceledShipmentDispatch[];
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null => typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : null;
const STOP_STATUSES: readonly WarehouseStopStatus[] = ['not_applicable', 'required', 'stopped', 'already_shipped', 'used'];

function parseReply(value: unknown): WarehouseStopReply | null {
  if (!record(value)) return null;
  const outcome = oneOf(WAREHOUSE_STOP_OUTCOMES, value.outcome), channel = oneOf(WAREHOUSE_STOP_CHANNELS, value.channel);
  const id = text(value.id), repliedAt = text(value.repliedAt), recordedAt = text(value.recordedAt);
  const usedKind = value.usedKind == null ? null : oneOf(WAREHOUSE_STOP_REPLY_USES, value.usedKind);
  if (!id || !outcome || !channel || !repliedAt || !recordedAt || typeof value.current !== 'boolean') return null;
  if (value.usedKind != null && !usedKind) return null;
  return { id, outcome, channel, repliedAt, note: text(value.note), recordedAt, recordedByName: text(value.recordedByName),
    current: value.current, usedKind, usedAt: text(value.usedAt), supersededAt: text(value.supersededAt) };
}

function parseShipment(value: unknown): WarehouseStopShipment | null {
  if (!record(value) || !Array.isArray(value.replies)) return null;
  const shipmentId = text(value.shipmentId), exportedAt = text(value.exportedAt), status = text(value.status);
  const stopStatus = oneOf(STOP_STATUSES, value.stopStatus);
  const replies = value.replies.map(parseReply);
  if (!shipmentId || !exportedAt || !status || !stopStatus || replies.some(reply => !reply)) return null;
  return { shipmentId, shipmentNumber: text(value.shipmentNumber), originName: text(value.originName) ?? '배송 건', status, exportedAt, stopStatus,
    replies: replies as WarehouseStopReply[] };
}

function parseDispatch(value: unknown): CanceledShipmentDispatch | null {
  if (!record(value) || !Array.isArray(value.lines)) return null;
  const id = text(value.id), shipmentId = text(value.shipmentId), discoveredAt = text(value.discoveredAt);
  const source = oneOf(['tracking_reply', 'warehouse_reply'] as const, value.source), state = oneOf(CANCELED_DISPATCH_STATES, value.state);
  const restoredQty = count(value.restoredQty), withdrawnQty = count(value.withdrawnQty), shortfallQty = count(value.shortfallQty);
  if (!id || !shipmentId || !discoveredAt || !source || !state || restoredQty === null || withdrawnQty === null || shortfallQty === null) return null;
  const lines: CanceledShipmentDispatchLine[] = [];
  for (const line of value.lines) {
    if (!record(line)) return null;
    const orderItemId = text(line.orderItemId), restored = count(line.restoredQty), withdrawn = count(line.withdrawnQty);
    if (!orderItemId || restored === null || withdrawn === null) return null;
    lines.push({ orderItemId, goodName: text(line.goodName) ?? '상품', variantName: text(line.variantName), restoredQty: restored, withdrawnQty: withdrawn,
      returnedQty: count(line.returnedQty) });
  }
  return { id, shipmentId, shipmentNumber: text(value.shipmentNumber), originName: text(value.originName) ?? '배송 건', source,
    carrier: text(value.carrier), carrierLabel: text(value.carrierLabel), trackingNumber: text(value.trackingNumber), discoveredAt, discoveredByName: text(value.discoveredByName), state,
    restoredQty, withdrawnQty, shortfallQty, returnedQty: count(value.returnedQty), resolvedAt: text(value.resolvedAt),
    resolvedByName: text(value.resolvedByName), resolutionNote: text(value.resolutionNote), lines };
}

/** `admin_order_warehouse_stop_context`의 응답. 모양이 다르면 null — 화면은 근거를 숨긴 채 처리 버튼을 그리지 않는다. */
export function parseOrderWarehouseStopContext(value: unknown): OrderWarehouseStopContext | null {
  if (!record(value) || !Array.isArray(value.shipments) || !Array.isArray(value.discoveries)) return null;
  const orderId = text(value.orderId), orderStatus = text(value.orderStatus);
  if (!orderId || !orderStatus || typeof value.canRecord !== 'boolean' || typeof value.canResolve !== 'boolean') return null;
  const shipments = value.shipments.map(parseShipment), discoveries = value.discoveries.map(parseDispatch);
  if (shipments.some(item => !item) || discoveries.some(item => !item)) return null;
  return { orderId, orderStatus, canRecord: value.canRecord, canResolve: value.canResolve,
    shipments: shipments as WarehouseStopShipment[], discoveries: discoveries as CanceledShipmentDispatch[] };
}

/**
 * 취소 양식이 보일 창고 회신 판정. 발송 대기 배송 건 가운데 가장 막는 상태 하나와 그 배송 건들을 돌려준다
 * (이미 출고 → 회신 필요 → 이미 씀 순, DB 판정과 같은 순서). 막는 것이 없으면 ready.
 */
export function warehouseStopRequirement(context: OrderWarehouseStopContext, shipmentIds?: readonly string[]):
  { state: 'ready' | 'already_shipped' | 'required' | 'used'; shipments: WarehouseStopShipment[] } {
  const relevant = context.shipments.filter(shipment => shipment.stopStatus !== 'not_applicable'
    && (!shipmentIds || shipmentIds.includes(shipment.shipmentId)));
  for (const state of ['already_shipped', 'required', 'used'] as const) {
    const blocked = relevant.filter(shipment => shipment.stopStatus === state);
    if (blocked.length) return { state, shipments: blocked };
  }
  return { state: 'ready', shipments: relevant };
}

/**
 * DB가 권한으로 거절했을 때의 문장. 이 문구표는 창고 회신 읽기(주문 조회)·기록(출고)·취소 뒤 출고 처리(판매 관리)와 취소·반품의 창고 확인이
 * 함께 써서 어느 권한인지 여기서는 알 수 없다 — 권한 이름을 단정하지 않는다. 화면이 부르는 서버 액션은 먼저 자기 권한을 확인하고
 * 그 권한의 이름으로 말한다(app/admin/warehouse-stop-actions).
 */
const WAREHOUSE_STOP_ACCESS_DENIED = '이 작업을 할 권한이 없거나 로그인이 끝났습니다. 로그인한 계정을 확인하고, 권한이 없으면 계정 주매니저에게 요청해주세요.';

/** DB가 던지는 창고 회신·발견 거절 코드를 운영자 문구로 옮긴다. 모르는 코드는 일반 문구다. */
export function warehouseStopErrorMessage(code: string | null | undefined): string {
  const value = code ?? '';
  const messages: [string, string][] = [
    // 회수 확인 코드는 취소 코드(warehouse_already_shipped)를 품고 있어 먼저 본다.
    ['claim_collection_warehouse_already_shipped', '창고가 이 배송 건을 이미 출고했다고 회신해 [창고 보관 확인]으로 회수를 끝낼 수 없습니다. 고객이 받은 상품을 돌려보내 창고에 다시 들어오면, 주문 상세의 창고 회신 기록에 반송 입고를 남긴 뒤 회수를 확인해주세요.'],
    ['claim_collection_warehouse_reply_required', '출고지시가 나간 발송 전 배송 건입니다. 창고에 보관(출고 중단)을 확인하고 주문 상세의 창고 회신 기록에 남긴 뒤 회수를 확인해주세요. 이미 다른 취소에 쓴 회신은 다시 쓰지 않습니다.'],
    ['warehouse_stop_reply_required', '출고지시가 나간 배송 건입니다. 창고에 출고 중단을 요청하고, 창고의 회신(출고 중단 확인)을 주문 상세의 창고 회신 기록에 남긴 뒤 다시 실행해주세요.'],
    ['warehouse_already_shipped', '창고가 이미 출고했다고 회신한 배송 건입니다. 취소하지 말고 창고의 운송장 회신을 받아 발송 처리한 뒤 고객 반품으로 접수해주세요. 회신을 잘못 기록했다면 바른 회신을 새로 기록해주세요.'],
    ['warehouse_stop_reply_used', '이 배송 건의 출고 중단 회신은 이미 다른 취소에 쓰였습니다. 창고에 다시 확인하고 회신을 새로 기록해주세요.'],
    ['warehouse_stop_confirmation_required', '출고지시가 나간 배송 건입니다. 창고 회신을 주문 상세에 기록한 뒤 다시 실행해주세요.'],
    ['warehouse_stop_reply_before_export', '회신 시각이 출고지시 파일을 보낸 시각보다 앞섭니다. 창고가 실제로 회신한 시각을 입력해주세요.'],
    ['warehouse_stop_reply_in_future', '회신 시각이 지금보다 뒤입니다. 창고가 실제로 회신한 시각을 입력해주세요.'],
    ['warehouse_stop_reply_not_exported', '출고지시 파일이 나가지 않은 택배 배송 건은 창고 회신을 기록하지 않습니다.'],
    ['warehouse_stop_reply_shipment_dispatched', '이미 발송된 배송 건입니다. 고객 반품으로 처리해주세요.'],
    ['warehouse_stop_reply_single_order', '한 번에 한 주문의 배송 건만 기록할 수 있습니다.'],
    ['warehouse_stop_reply_returned_without_shipped', '반송 입고는 창고가 이미 출고했다고 회신한 발송 대기 배송 건에만 기록합니다. 취소된 배송 건은 취소 뒤 출고 처리의 회수 입고로 닫습니다.'],
    ['warehouse_stop_reply_operation_conflict', '이미 다른 내용으로 기록돼 있습니다. 새로고침한 뒤 창고 회신 기록을 확인해주세요.'],
    ['invalid_warehouse_stop_reply', '회신 결과·경로·회신 시각을 확인해주세요. 경로가 기타이면 메모를 적어주세요(메모는 500자까지).'],
    ['canceled_dispatch_already_resolved', '이미 처리한 취소 뒤 출고 건입니다. 새로고침해 결과를 확인해주세요.'],
    ['canceled_dispatch_operation_conflict', '이미 다른 내용으로 처리됐습니다. 새로고침한 뒤 취소 뒤 출고 기록을 확인해주세요.'],
    ['canceled_dispatch_not_found', '취소 뒤 출고 기록을 찾을 수 없습니다. 새로고침해주세요.'],
    ['invalid_canceled_dispatch_resolution', `처리 결과를 고르고 근거 메모를 ${CANCELED_DISPATCH_NOTE_MIN}자 이상 적어주세요(최대 500자).`],
    ['goods_group_retry', '다른 작업이 같은 상품 재고를 바꾸는 중입니다. 잠시 뒤 다시 시도해주세요.'],
    ['shipment_not_found', '배송 건을 찾을 수 없습니다. 새로고침해주세요.'],
    ['operator_capability_required', WAREHOUSE_STOP_ACCESS_DENIED],
    ['staff required', WAREHOUSE_STOP_ACCESS_DENIED],
  ];
  const found = messages.find(([key]) => value.includes(key));
  return found ? found[1] : '처리하지 못했습니다. 다른 사람이 먼저 처리했을 수 있으니 새로고침해 지금 상태를 확인해주세요.';
}

/** 화면의 KST datetime-local(분 단위) 값을 ISO 시각으로. 형식이 다르면 null. */
export function kstLocalToIso(value: string): string | null {
  const local = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local)) return null;
  const instant = new Date(`${local}${local.length === 16 ? ':00' : ''}+09:00`);
  if (!Number.isFinite(instant.valueOf())) return null;
  // 2026-02-30처럼 넘어가는 날짜를 받지 않는다.
  const back = new Date(instant.valueOf() + 9 * 3_600_000).toISOString().slice(0, 16);
  return back === local.slice(0, 16) ? instant.toISOString() : null;
}

/** ISO 시각 → KST datetime-local(분 단위) 값. */
export function isoToKstLocal(value: string | Date): string {
  const milliseconds = value instanceof Date ? value.valueOf() : Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds + 9 * 3_600_000).toISOString().slice(0, 16) : '';
}

export interface WarehouseStopReplyInput {
  orderId: string;
  shipmentIds: string[];
  outcome: WarehouseStopOutcome;
  channel: WarehouseStopChannel;
  repliedAt: string;
  note: string | null;
  operationId: string;
}

/** 회신 기록 입력 정리. 회신 시각은 KST 화면 값(분 단위)을 받는다. 거절 사유는 DB와 같은 문구다. */
export function normalizeWarehouseStopReplyInput(input: unknown): { ok: true; value: WarehouseStopReplyInput } | { ok: false; error: string } {
  if (!record(input)) return { ok: false, error: warehouseStopErrorMessage('invalid_warehouse_stop_reply') };
  const orderId = text(input.orderId)?.toLowerCase() ?? '', operationId = text(input.operationId)?.toLowerCase() ?? '';
  const ids = Array.isArray(input.shipmentIds) ? input.shipmentIds.map(id => typeof id === 'string' ? id.toLowerCase() : '') : [];
  const outcome = oneOf(WAREHOUSE_STOP_OUTCOMES, input.outcome), channel = oneOf(WAREHOUSE_STOP_CHANNELS, input.channel);
  const repliedAt = typeof input.repliedAt === 'string' ? kstLocalToIso(input.repliedAt) : null;
  const note = (text(input.note) ?? '').trim();
  if (!isUuid(orderId) || !isUuid(operationId)) return { ok: false, error: '주문 화면을 새로고침한 뒤 다시 시도해주세요.' };
  if (!ids.length) return { ok: false, error: '회신을 기록할 배송 건을 하나 이상 골라주세요.' };
  if (ids.length > 20 || ids.some(id => !isUuid(id)) || new Set(ids).size !== ids.length) return { ok: false, error: '주문 화면을 새로고침한 뒤 다시 시도해주세요.' };
  if (!outcome) return { ok: false, error: '창고 회신 결과(출고 중단 확인·이미 출고·반송 입고)를 골라주세요.' };
  if (!channel) return { ok: false, error: '회신 경로를 골라주세요.' };
  if (!repliedAt) return { ok: false, error: '창고가 회신한 시각을 입력해주세요.' };
  if ([...note].length > WAREHOUSE_STOP_NOTE_LIMIT) return { ok: false, error: `메모는 ${WAREHOUSE_STOP_NOTE_LIMIT}자 이내로 입력해주세요.` };
  if (channel === 'other' && !note) return { ok: false, error: '경로가 기타이면 어디서 받은 회신인지 메모로 적어주세요.' };
  return { ok: true, value: { orderId, shipmentIds: ids, outcome, channel, repliedAt, note: note || null, operationId } };
}

export interface CanceledDispatchResolutionInput {
  orderId: string;
  dispatchId: string;
  outcome: CanceledDispatchResolution;
  note: string;
  operationId: string;
}

export function normalizeCanceledDispatchResolution(input: unknown): { ok: true; value: CanceledDispatchResolutionInput } | { ok: false; error: string } {
  if (!record(input)) return { ok: false, error: warehouseStopErrorMessage('invalid_canceled_dispatch_resolution') };
  const orderId = text(input.orderId)?.toLowerCase() ?? '', dispatchId = text(input.dispatchId)?.toLowerCase() ?? '';
  const operationId = text(input.operationId)?.toLowerCase() ?? '';
  const outcome = oneOf(CANCELED_DISPATCH_RESOLUTIONS, input.outcome), note = (text(input.note) ?? '').trim();
  if (!isUuid(orderId) || !isUuid(dispatchId) || !isUuid(operationId)) return { ok: false, error: '주문 화면을 새로고침한 뒤 다시 시도해주세요.' };
  const length = [...note].length;
  if (!outcome || length < CANCELED_DISPATCH_NOTE_MIN || length > WAREHOUSE_STOP_NOTE_LIMIT) {
    return { ok: false, error: warehouseStopErrorMessage('invalid_canceled_dispatch_resolution') };
  }
  return { ok: true, value: { orderId, dispatchId, outcome, note, operationId } };
}

/** 반송 입고를 고를 수 없을 때 그 자리에 보이는 이유. */
export const WAREHOUSE_STOP_RETURNED_LOCK_REASON = '창고가 이미 출고했다고 회신한 발송 대기 배송 건에만 고를 수 있습니다.';

/**
 * 반송 입고는 창고가 이미 출고했다고 회신한 발송 대기 배송 건에만 남긴다(DB 판정과 같다 — `admin_record_warehouse_stop_reply`).
 * 고른 배송 건이 모두 그래야 고를 수 있고, 아니면 화면이 미리 잠근다.
 */
export function warehouseStopReturnedAllowed(shipments: readonly Pick<WarehouseStopShipment, 'status' | 'stopStatus'>[]): boolean {
  return shipments.length > 0 && shipments.every(shipment => shipment.status === 'ready' && shipment.stopStatus === 'already_shipped');
}

/** 회신 기록 양식에서 아직 빠진 것 하나(없으면 null). 기록 버튼을 잠그고 그 이유를 버튼 옆에 보인다. */
export function warehouseStopReplyMissing(input: { selected: number; outcome: string; channel: string; repliedAt: string; note: string }): string | null {
  if (!input.selected) return '기록할 배송 건을 골라주세요.';
  if (!input.outcome) return '창고 회신 결과를 골라주세요.';
  if (!input.channel) return '회신 경로를 골라주세요.';
  if (!input.repliedAt) return '창고가 회신한 시각을 넣어주세요.';
  if (input.channel === 'other' && !input.note.trim()) return '경로가 기타이면 메모에 어디서 받은 회신인지 적어주세요.';
  return null;
}

/** 취소 뒤 출고 처리 양식에서 아직 빠진 것 하나(없으면 null). */
export function canceledDispatchResolveMissing(input: { outcome: string; note: string }): string | null {
  if (!input.outcome) return '처리 결과를 골라주세요.';
  if ([...input.note.trim()].length < CANCELED_DISPATCH_NOTE_MIN) return `근거를 ${CANCELED_DISPATCH_NOTE_MIN}자 이상 적어주세요.`;
  return null;
}

/**
 * 창고 회신 기록 확인창. 기록은 지울 수 없다. 이미 취소된 배송 건에 '이미 출고'를 남기면 재고가 다시 빠지므로 그 결과를 먼저 말한다.
 * `targets`는 화면에 보이는 배송 건 이름(출고지 · 배송건번호)을 쉼표로 이은 글이다.
 */
export function warehouseStopReplyConfirm({ targets, outcome, canceledSelected }: { targets: string; outcome: WarehouseStopOutcome; canceledSelected: boolean }) {
  const discovery = outcome === 'already_shipped' && canceledSelected;
  return {
    title: '창고 회신을 기록할까요?',
    message: discovery
      ? `배송 건 ${targets}에 창고 회신(이미 출고)을 남깁니다. 이미 취소된 배송 건은 '취소 뒤 출고 발견'으로 남고, 그 수량만큼 재고를 다시 뺍니다. 기록은 지울 수 없습니다.`
      : `배송 건 ${targets}에 창고 회신(${WAREHOUSE_STOP_OUTCOME_LABELS[outcome]})을 남깁니다. 기록은 지울 수 없습니다. 잘못 남겼다면 바른 회신을 새로 기록하세요(가장 늦은 회신을 따릅니다).`,
    confirmLabel: '회신 기록',
    destructive: discovery,
  };
}

/** 취소 뒤 출고 처리 확인창. 회수 입고는 발견 때 뺀 재고를 되돌리고, 손실은 그대로 둔다. 둘 다 되돌릴 수 없다. */
export function canceledDispatchResolveConfirm({ target, outcome, withdrawnQty }: { target: string; outcome: CanceledDispatchResolution; withdrawnQty: number }) {
  return outcome === 'returned'
    ? { title: '취소 뒤 출고 처리', message: `배송 건 ${target}\n회수한 상품이 창고에 입고된 것을 확인했나요? 발견 때 뺀 재고 ${withdrawnQty}개를 되돌립니다. 되돌릴 수 없습니다.`, confirmLabel: '회수 입고 처리' }
    : { title: '취소 뒤 출고 처리', message: `배송 건 ${target}\n회수할 수 없어 손실로 처리할까요? 재고는 발견 때 뺀 그대로 둡니다. 되돌릴 수 없습니다.`, confirmLabel: '손실 처리' };
}
