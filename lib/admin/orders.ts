import type { OrderWithdrawalReasonType } from '@/lib/orders';
import {
  isSelectableShippingCarrier,
  isTrackingNumber,
  normalizeTrackingNumber,
  type OrderShipment,
  type ShippingCarrierRegistry,
} from '@/lib/orders/shipment';

// DB의 order_status enum과 같은 순서를 유지한다 — 상태 필터의 표시 순서가
// 사다리 순서 그 자체다(#250).
export const ADMIN_ORDER_STATUSES = [
  'pending',
  'paid',
  'confirmed',
  'shipping',
  'delivered',
  'done',
  'canceled',
] as const;
export type AdminOrderStatus = (typeof ADMIN_ORDER_STATUSES)[number];
export type AdminOrderStatusFilter = AdminOrderStatus | 'all';

/**
 * 상태 표기의 단일 진실원.
 *
 * 필터 드롭다운과 오류 문구가 같은 말을 써야 한다 — 일괄 등록 실패 리포트가
 * "confirmed가 아닙니다"라고 적으면 운영자는 화면 어디에서도 그 단어를 찾을 수 없다.
 */
export const ADMIN_ORDER_STATUS_LABELS: Record<AdminOrderStatus, string> = {
  pending: '결제 대기',
  paid: '신규주문',
  confirmed: '발주확인',
  shipping: '배송중',
  delivered: '배송완료',
  done: '거래확정',
  canceled: '취소',
};

export const GOODS_PAYMENT_ATTEMPT_STATES = [
  'prepared',
  'confirming',
  'approved',
  'declined',
  'canceled',
  'unknown',
  'needs_review',
] as const;
export type GoodsPaymentAttemptState = (typeof GOODS_PAYMENT_ATTEMPT_STATES)[number];

const KORPAY_MANUAL_RECOVERY_STATE_SET = new Set<GoodsPaymentAttemptState>([
  'confirming',
  'approved',
  'unknown',
  'needs_review',
]);

export function isKorpayManualRecoveryState(state: GoodsPaymentAttemptState) {
  return KORPAY_MANUAL_RECOVERY_STATE_SET.has(state);
}

export const ORDER_CANCELLATION_REQUEST_STATUSES = [
  'requested',
  'processing',
  'needs_review',
  'completed',
  'rejected',
] as const;
export type OrderCancellationRequestStatus = (typeof ORDER_CANCELLATION_REQUEST_STATUSES)[number];

export interface AdminOrderFilters {
  from: string | null;
  orderId: string | null;
  page: number;
  query: string;
  status: AdminOrderStatusFilter;
  to: string | null;
}

export interface AdminOrderAddress {
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2?: string;
  deliveryNote?: string;
}

export interface AdminOrderItemRecord {
  id: string;
  name: string;
  type: string;
  qty: number;
  unitPrice: number;
}

export interface AdminOrderPaymentRecord {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface AdminOrderRefundRecord {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface AdminGoodsManualRecoveryAttemptRecord {
  attemptId: string;
  requestId: string;
  providerOrderId: string;
  state: GoodsPaymentAttemptState;
  amount: number;
  currency: string;
  manualRecoveryAvailable: boolean;
}

export interface AdminOrderCancellationRequestRecord {
  id: string;
  status: OrderCancellationRequestStatus;
  reasonType: OrderWithdrawalReasonType;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

/**
 * 반송비 부담 주체는 귀책에서 갈린다. 승인 화면에서 운영자가 함께 봐야 한다.
 * 표기는 배송정책 문서(`lib/legal/documents.ts` "반송비 부담")의 어휘를 따른다 —
 * 운영자가 화면에서 본 말로 정책 원문을 찾을 수 있어야 한다.
 */
export const ADMIN_WITHDRAWAL_RETURN_SHIPPING_LABELS: Record<OrderWithdrawalReasonType, string> = {
  change_of_mind: '반송비 이용자 부담',
  defect: '반송비 회사 부담',
};

export interface AdminOrderRecord {
  id: string;
  userId: string;
  buyerName: string;
  buyerEmail: string | null;
  status: AdminOrderStatus;
  total: number;
  address: AdminOrderAddress | null;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItemRecord[];
  payments: AdminOrderPaymentRecord[];
  refunds: AdminOrderRefundRecord[];
  cancellationRequest: AdminOrderCancellationRequestRecord | null;
  manualRecoveryAttempt: AdminGoodsManualRecoveryAttemptRecord | null;
  shipment: OrderShipment | null;
}

export interface AdminOrderConsoleData {
  items: AdminOrderRecord[];
  filters: AdminOrderFilters;
  pageSize: number;
  total: number;
  /**
   * 운송장 폼이 고를 수 있는 택배사(#251). 목록 응답에 함께 실어 보낸다 —
   * 콘솔은 클라이언트 컴포넌트라 DB 레지스트리를 직접 읽을 수 없고, 상수 목록을
   * 다시 두면 레지스트리와 갈라진다.
   */
  carriers: ShippingCarrierRegistry;
}

export type AdminOrderFieldErrors = Record<string, string>;
export type AdminOrderFormResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: AdminOrderFieldErrors };

type SearchParamValue = string | string[] | undefined;
type AdminOrderSearchParams = Record<string, SearchParamValue>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ORDER_STATUS_SET = new Set<string>(ADMIN_ORDER_STATUSES);
/**
 * 어드민 상태 폼이 직접 밀 수 있는 전이 대상(#250).
 *
 * `admin_update_order_status`가 받는 값과 같아야 한다 — `paid`는 결제 웹훅이,
 * `done`은 자동 거래확정 잡이, `canceled`는 청약철회 경로가 각각 소유하므로
 * 운영자 폼이 손댈 수 있는 것은 사다리 중간 세 칸뿐이다.
 */
const SHIPPING_STATUS_SET = new Set<string>(['confirmed', 'shipping', 'delivered']);
export type AdminOrderFormStatus = 'confirmed' | 'shipping' | 'delivered';

function singleParam(value: SearchParamValue) {
  return typeof value === 'string' ? value : '';
}

function validCalendarDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizedDate(value: SearchParamValue) {
  const candidate = singleParam(value);
  return validCalendarDate(candidate) ? candidate : null;
}

function normalizedUuid(value: SearchParamValue) {
  const candidate = singleParam(value).trim();
  return UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAdminOrderFilters(searchParams: AdminOrderSearchParams): AdminOrderFilters {
  let from = normalizedDate(searchParams.from);
  let to = normalizedDate(searchParams.to);
  if (from && to && from > to) {
    from = null;
    to = null;
  }

  const rawPage = Number(singleParam(searchParams.page));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawQuery = singleParam(searchParams.query).trim();
  const query = rawQuery.length <= 100 ? rawQuery : '';
  const rawStatus = singleParam(searchParams.status);
  const status = ORDER_STATUS_SET.has(rawStatus) ? rawStatus as AdminOrderStatus : 'all';

  return {
    from,
    orderId: normalizedUuid(searchParams.order),
    page,
    query,
    status,
    to,
  };
}

interface TrackingInput {
  carrier: string;
  trackingNumber: string;
}

/**
 * 택배사·운송장번호를 함께 검증한다. 둘 중 하나만 남으면 DB 쌍 제약에 걸린다.
 *
 * 택배사 판정은 레지스트리를 받아서 한다(#251). **활성** 택배사만 통과시킨다 —
 * 등록만 되어 있고 계약이 끝난 코드로 새 운송장을 붙이면 DB 게이트에서 거절돼
 * 운영자는 이유를 알 수 없는 저장 실패를 본다.
 */
function readTrackingInput(
  formData: FormData,
  carriers: ShippingCarrierRegistry,
): AdminOrderFormResult<TrackingInput> {
  const carrier = readFormString(formData, 'carrier');
  const rawTrackingNumber = readFormString(formData, 'trackingNumber');
  const trackingNumber = normalizeTrackingNumber(rawTrackingNumber);
  const errors: AdminOrderFieldErrors = {};

  if (!isSelectableShippingCarrier(carriers, carrier)) errors.carrier = '택배사를 선택해주세요.';
  if (!trackingNumber) {
    errors.trackingNumber = '운송장번호를 입력해주세요.';
  } else if (!isTrackingNumber(trackingNumber)) {
    errors.trackingNumber = '운송장번호는 하이픈을 뺀 8~30자리 영숫자여야 합니다.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  return { ok: true, value: { carrier, trackingNumber } };
}

export function normalizeAdminOrderStatusForm(
  formData: FormData,
  carriers: ShippingCarrierRegistry,
): AdminOrderFormResult<{
  orderId: string;
  status: AdminOrderFormStatus;
  carrier: string | null;
  trackingNumber: string | null;
}> {
  const orderId = readFormString(formData, 'orderId').toLowerCase();
  const status = readFormString(formData, 'status');
  const errors: AdminOrderFieldErrors = {};

  if (!UUID_PATTERN.test(orderId)) errors.orderId = '주문을 찾을 수 없습니다.';
  if (!SHIPPING_STATUS_SET.has(status)) errors.status = '허용된 주문 상태를 선택해주세요.';
  if (Object.keys(errors).length) return { ok: false, errors };

  // 운송장을 받는 것은 발송처리(shipping)뿐이다. 발주확인·배송완료 전이에서 재입력을
  // 받으면 그 시점에 운송장이 조용히 바뀌는 경로가 생긴다 — 수정은 전용 폼에서만
  // 감사와 함께 한다. DB도 입력이 없으면 기존 운송장을 유지한다.
  if (status !== 'shipping') {
    return {
      ok: true,
      value: {
        orderId,
        status: status as Exclude<AdminOrderFormStatus, 'shipping'>,
        carrier: null,
        trackingNumber: null,
      },
    };
  }

  const tracking = readTrackingInput(formData, carriers);
  if (!tracking.ok) return tracking;

  return {
    ok: true,
    value: {
      orderId,
      status: 'shipping',
      carrier: tracking.value.carrier,
      trackingNumber: tracking.value.trackingNumber,
    },
  };
}

export function normalizeAdminOrderTrackingForm(
  formData: FormData,
  carriers: ShippingCarrierRegistry,
): AdminOrderFormResult<{ orderId: string; carrier: string; trackingNumber: string }> {
  const orderId = readFormString(formData, 'orderId').toLowerCase();
  const tracking = readTrackingInput(formData, carriers);
  const errors: AdminOrderFieldErrors = {
    ...(UUID_PATTERN.test(orderId) ? {} : { orderId: '주문을 찾을 수 없습니다.' }),
    ...(tracking.ok ? {} : tracking.errors),
  };
  if (Object.keys(errors).length) return { ok: false, errors };
  if (!tracking.ok) return { ok: false, errors };

  return {
    ok: true,
    value: {
      orderId,
      carrier: tracking.value.carrier,
      trackingNumber: tracking.value.trackingNumber,
    },
  };
}

export function normalizeAdminCancellationDecisionForm(
  formData: FormData,
  decision: 'approve',
): AdminOrderFormResult<{ requestId: string }>;
export function normalizeAdminCancellationDecisionForm(
  formData: FormData,
  decision: 'reject',
): AdminOrderFormResult<{ requestId: string; reason: string }>;
export function normalizeAdminCancellationDecisionForm(
  formData: FormData,
  decision: 'approve' | 'reject',
): AdminOrderFormResult<{ requestId: string; reason?: string }> {
  const requestId = readFormString(formData, 'requestId').toLowerCase();
  const errors: AdminOrderFieldErrors = {};
  if (!UUID_PATTERN.test(requestId)) errors.requestId = '청약철회 요청을 찾을 수 없습니다.';

  if (decision === 'reject') {
    const reason = readFormString(formData, 'reason');
    if (reason.length < 10 || reason.length > 200) {
      errors.reason = '거절 사유를 10자 이상 200자 이하로 입력해주세요.';
    }
    if (Object.keys(errors).length) return { ok: false, errors };
    return { ok: true, value: { requestId, reason } };
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { requestId } };
}

export function normalizeAdminGoodsManualRecoveryForm(
  formData: FormData,
): AdminOrderFormResult<{
  operation: 'provider_cancel_confirmed';
  attemptId: string;
  requestId: string;
  operatorAttested: true;
}> {
  const attemptId = readFormString(formData, 'attemptId').toLowerCase();
  const requestId = readFormString(formData, 'requestId').toLowerCase();
  const attestation = readFormString(formData, 'operatorAttestation');
  const errors: AdminOrderFieldErrors = {};

  if (!UUID_PATTERN.test(attemptId)) {
    errors.attemptId = '결제 시도를 찾을 수 없습니다.';
  }
  if (!UUID_PATTERN.test(requestId)) {
    errors.requestId = '청약철회 요청을 찾을 수 없습니다.';
  }
  if (attestation !== 'provider_cancel_confirmed') {
    errors.operatorAttestation = '결제사 원장에서 전액 취소를 확인해야 합니다.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      operation: 'provider_cancel_confirmed',
      attemptId,
      requestId,
      operatorAttested: true,
    },
  };
}

/**
 * 주문 목록 링크. 필터는 쿼리로 남고 화면은 라우트가 정한다 —
 * 섹션 전환이 `?section=`이던 시절의 파라미터는 더 이상 붙이지 않는다.
 */
export function adminOrdersHref(
  filters: AdminOrderFilters,
  overrides: Partial<Pick<AdminOrderFilters, 'orderId' | 'page'>> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.status !== 'all') params.set('status', next.status);
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.query) params.set('query', next.query);
  params.set('page', String(next.page));
  if (next.orderId) params.set('order', next.orderId);
  return `/admin/sales/orders?${params.toString()}`;
}
