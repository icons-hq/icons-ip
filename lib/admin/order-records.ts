import type { AdminFieldErrors, AdminFormResult } from './catalog';

/*
 * 주문 기록 — 메모 · 상태 이력 · 외부 참조 (D-3).
 *
 * 셋 다 「이 주문에 무슨 일이 있었나」에 답하는 자료지만 성질이 다르다:
 * 메모는 사람이 남기는 말, 상태 이력은 시스템이 남기는 사실, 외부 참조는 다른 시스템이 부르는 이름.
 * 그래서 한 표에 섞지 않고 셋으로 두고, 화면에서만 나란히 보여준다.
 */

export const ORDER_NOTE_KINDS = [
  { value: 'memo', label: '내부 메모' },
  { value: 'cs', label: 'CS 응대' },
] as const;

export type OrderNoteKind = (typeof ORDER_NOTE_KINDS)[number]['value'];

/** 시스템이 남기는 종류. 사람이 이 옷을 입고 쓸 수 없다(RPC 가 거절한다). */
export const ORDER_NOTE_SYSTEM_LABELS: Record<string, string> = {
  status: '상태 변경',
  system: '시스템',
  memo: '내부 메모',
  cs: 'CS 응대',
};

export const ORDER_EXTERNAL_REF_KINDS = [
  { value: 'sabangnet_order', label: '사방넷 주문번호' },
  { value: 'erp_shipment', label: 'ERP 출고번호' },
  { value: 'erp_sales', label: 'ERP 매출번호' },
  { value: 'other', label: '기타' },
] as const;

export type OrderExternalRefKind = (typeof ORDER_EXTERNAL_REF_KINDS)[number]['value'];

export const ORDER_EXTERNAL_REF_LABELS: Record<string, string> = Object.fromEntries(
  ORDER_EXTERNAL_REF_KINDS.map((kind) => [kind.value, kind.label]),
);

export const ORDER_NOTE_MAX_LENGTH = 2000;
export const ORDER_EXTERNAL_REF_MAX_LENGTH = 100;

export interface AdminOrderNote {
  id: string;
  kind: string;
  body: string;
  pinned: boolean;
  authorId: string | null;
  authorName: string;
  createdAt: string;
}

export interface AdminOrderStatusEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  actorName: string;
  note: string | null;
  source: string;
  occurredAt: string;
}

export interface AdminOrderExternalRef {
  id: string;
  kind: string;
  value: string;
  source: string;
  note: string | null;
  recordedBy: string | null;
  recordedByName: string;
  recordedAt: string;
}

export interface AdminOrderShipmentItem {
  orderItemId: string;
  itemNo: string;
  name: string;
  qty: number;
}

export interface AdminOrderShipment {
  id: string;
  shipmentNo: string;
  kind: string;
  status: string;
  carrier: string | null;
  carrierLabel: string | null;
  trackingNumber: string | null;
  locationId: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  items: AdminOrderShipmentItem[];
}

export interface AdminOrderRecordPanel {
  orderId: string;
  notes: AdminOrderNote[];
  statusEvents: AdminOrderStatusEvent[];
  externalRefs: AdminOrderExternalRef[];
  shipments: AdminOrderShipment[];
}

export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  ready: '배송대기 (송장 등록·미발송)',
  shipped: '배송중',
  delivered: '배송완료',
  canceled: '취소',
};

/*
 * 이행 상태는 저장하지 않고 조회 시 파생한다(`order_fulfillment_view`).
 * 카페24의 배송준비·부분배송·부분취소가 여기 있고, 헤더 enum 은 7값 그대로다.
 */
export const FULFILLMENT_STATE_LABELS: Record<string, string> = {
  unfulfilled: '출고 전',
  ready: '배송대기',
  partially_shipped: '부분 배송',
  shipped: '배송중',
  partially_delivered: '부분 배송완료',
  delivered: '배송완료',
  partially_canceled: '부분 취소',
  canceled: '취소',
};

export interface AdminOrderNoteInput {
  orderId: string;
  kind: OrderNoteKind;
  body: string;
  pinned: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeOrderNoteInput(formData: FormData): AdminFormResult<AdminOrderNoteInput> {
  const errors: AdminFieldErrors = {};
  const orderId = readField(formData, 'orderId');
  const body = readField(formData, 'body');
  const kind = readField(formData, 'kind') || 'memo';

  if (!UUID_PATTERN.test(orderId)) errors.form = '주문을 찾을 수 없습니다.';
  if (!body) errors.body = '메모를 적어주세요.';
  else if (body.length > ORDER_NOTE_MAX_LENGTH) errors.body = `메모는 ${ORDER_NOTE_MAX_LENGTH}자까지 쓸 수 있습니다.`;
  if (!ORDER_NOTE_KINDS.some((entry) => entry.value === kind)) errors.kind = '메모 종류를 골라주세요.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { orderId, kind: kind as OrderNoteKind, body, pinned: formData.get('pinned') === 'on' },
  };
}

export interface AdminOrderExternalRefInput {
  orderId: string;
  kind: OrderExternalRefKind;
  value: string;
  note: string | null;
}

export function normalizeOrderExternalRefInput(
  formData: FormData,
): AdminFormResult<AdminOrderExternalRefInput> {
  const errors: AdminFieldErrors = {};
  const orderId = readField(formData, 'orderId');
  const kind = readField(formData, 'kind');
  const value = readField(formData, 'value');
  const note = readField(formData, 'note');

  if (!UUID_PATTERN.test(orderId)) errors.form = '주문을 찾을 수 없습니다.';
  if (!ORDER_EXTERNAL_REF_KINDS.some((entry) => entry.value === kind)) errors.kind = '번호 종류를 골라주세요.';
  if (!value) errors.value = '번호를 적어주세요.';
  else if (value.length > ORDER_EXTERNAL_REF_MAX_LENGTH) {
    errors.value = `번호는 ${ORDER_EXTERNAL_REF_MAX_LENGTH}자까지 쓸 수 있습니다.`;
  }
  if (note.length > 200) errors.note = '메모는 200자까지 쓸 수 있습니다.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { orderId, kind: kind as OrderExternalRefKind, value, note: note || null } };
}

/** 상태 이력 한 줄. 「무엇에서 무엇으로」가 사다리를 읽는 방식이다. */
export function describeStatusEvent(
  event: AdminOrderStatusEvent,
  labels: Record<string, string>,
): string {
  const to = labels[event.toStatus] ?? event.toStatus;
  if (!event.fromStatus) return `${to} (주문 접수)`;
  return `${labels[event.fromStatus] ?? event.fromStatus} → ${to}`;
}
