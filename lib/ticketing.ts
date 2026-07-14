export interface PublicTicketType {
  id: string;
  eventId: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
  remaining: number;
}

export interface TicketOrderSnapshot {
  id: string;
  eventId: string;
  eventTitle: string;
  ticketTypeId: string;
  ticketTypeName: string;
  qty: number;
  total: number;
  status: string;
  paymentStatus: string | null;
  expiresAt: string | null;
}

export type TicketOrderStatus = 'pending' | 'paid' | 'canceled';
export type TicketStatus = 'valid' | 'used' | 'refunded';
export type TicketCancellationStatus = 'requested' | 'processing' | 'needs_review' | 'completed';

export interface TicketCancellationRequestSummary {
  status: TicketCancellationStatus;
  requestedAt: string;
  completedAt: string | null;
  grossAmount: number;
  feeAmount: number;
  refundAmount: number;
}

export interface TicketRefundSummary {
  status: string;
  amount: number;
  createdAt: string;
}

export interface TicketOrderListItem {
  id: string;
  eventId: string;
  eventTitle: string;
  ticketTypeId: string;
  ticketTypeName: string;
  qty: number;
  total: number;
  status: TicketOrderStatus;
  paymentStatus: string | null;
  createdAt: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  ticketStatuses: TicketStatus[];
  cancellationRequest: TicketCancellationRequestSummary | null;
  refund: TicketRefundSummary | null;
}

export interface TicketSummary {
  id: string;
  status: TicketStatus;
}

export interface TicketOrderDetail extends Omit<TicketOrderListItem, 'ticketStatuses'> {
  tickets: TicketSummary[];
}

export type TicketOrderDisplayState =
  | 'payment_pending'
  | 'usable'
  | 'used'
  | 'refund_pending'
  | 'refunded'
  | 'unavailable';

export type TicketOrderGroup = 'usable' | 'current' | 'past';

export interface TicketOrderDisplayMeta {
  state: TicketOrderDisplayState;
  group: TicketOrderGroup;
  label: string;
  title: string;
  body: string;
  tone: 'cyan' | 'mint' | 'amber' | 'pink' | 'muted';
}

export type TicketCancellationReason =
  | 'schedule_unknown'
  | 'started'
  | 'used'
  | 'active_request'
  | 'not_cancelable';

export interface ReserveTicketsInput {
  ticketTypeId: string;
  qty: number;
  reservationKey: string;
}

export type ReserveTicketsErrorCode =
  | 'invalid_request'
  | 'auth_required'
  | 'onboarding_required'
  | 'payment_unavailable'
  | 'not_bookable'
  | 'sales_not_open'
  | 'sold_out'
  | 'per_user_limit'
  | 'conflict'
  | 'unavailable';

export type TicketCheckoutState = 'payable' | 'checking' | 'complete' | 'closed';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESERVATION_KEYS = new Set(['ticketTypeId', 'qty', 'reservationKey']);
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const TOSS_ORDER_NAME_MAX_LENGTH = 100;
const ACTIVE_TICKET_CANCELLATION_STATUSES = new Set<TicketCancellationStatus>([
  'requested',
  'processing',
  'needs_review',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeTicketReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized.toLowerCase() : null;
}

export function normalizeReserveTicketsInput(value: unknown): ReserveTicketsInput | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !RESERVATION_KEYS.has(key))) return null;

  const ticketTypeId = normalizeTicketReference(value.ticketTypeId);
  const reservationKey = normalizeTicketReference(value.reservationKey);
  const qty = value.qty;
  if (
    !ticketTypeId
    || !reservationKey
    || typeof qty !== 'number'
    || !Number.isInteger(qty)
    || qty < 1
    || qty > POSTGRES_INTEGER_MAX
  ) return null;

  return { ticketTypeId, qty, reservationKey };
}

export function mapReserveTicketsError(message: unknown): ReserveTicketsErrorCode {
  const normalized = typeof message === 'string' ? message.toLowerCase() : '';
  if (normalized.includes('auth required')) return 'auth_required';
  if (normalized.includes('onboarding required')) return 'onboarding_required';
  if (
    normalized.includes('quantity must be positive')
    || normalized.includes('reservation key required')
  ) return 'invalid_request';
  if (
    normalized.includes('ticket type not found')
    || normalized.includes('event not bookable')
    || normalized.includes('paid ticket required')
  ) return 'not_bookable';
  if (normalized.includes('sales not open')) return 'sales_not_open';
  if (normalized.includes('sold out')) return 'sold_out';
  if (normalized.includes('per-user limit exceeded')) return 'per_user_limit';
  if (normalized.includes('reservation conflict')) return 'conflict';
  return 'unavailable';
}

export function ticketCheckoutState(
  orderStatus: string,
  paymentStatus: string | null,
  expiresAt: string | null,
  now: number = Date.now(),
): TicketCheckoutState {
  if (orderStatus === 'paid') return 'complete';
  if (orderStatus !== 'pending') return 'closed';
  if (paymentStatus === 'pending' || paymentStatus === 'paid') return 'checking';
  if (!expiresAt) return 'closed';

  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > now ? 'payable' : 'closed';
}

export function ticketOrderName(eventTitle: string, ticketTypeName: string, qty?: number): string {
  const event = eventTitle.trim();
  const ticketType = ticketTypeName.trim();
  const qtyLabel = Number.isInteger(qty) && (qty ?? 0) > 0 ? `${qty}매` : '';
  const ticketDetails = [ticketType, qtyLabel].filter(Boolean).join(' · ');
  if (!event && !ticketDetails) return 'ICONS 티켓';
  if (!event) return ticketDetails.slice(0, TOSS_ORDER_NAME_MAX_LENGTH);
  if (!ticketDetails) return event.slice(0, TOSS_ORDER_NAME_MAX_LENGTH);

  const suffix = ` · ${ticketDetails}`;
  if (suffix.length >= TOSS_ORDER_NAME_MAX_LENGTH) {
    if (!qtyLabel) return ticketDetails.slice(0, TOSS_ORDER_NAME_MAX_LENGTH);
    const qtySuffix = ` · ${qtyLabel}`;
    return `${ticketType.slice(0, TOSS_ORDER_NAME_MAX_LENGTH - qtySuffix.length)}${qtySuffix}`;
  }
  return `${event.slice(0, TOSS_ORDER_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
}

export function isActiveTicketCancellation(status: TicketCancellationStatus | null): boolean {
  return status !== null && ACTIVE_TICKET_CANCELLATION_STATUSES.has(status);
}

export function ticketCanShowQr(
  orderStatus: TicketOrderStatus,
  ticketStatus: TicketStatus,
  cancellationStatus: TicketCancellationStatus | null,
): boolean {
  return orderStatus === 'paid'
    && ticketStatus === 'valid'
    && !isActiveTicketCancellation(cancellationStatus);
}

export function ticketOrderDisplayMeta(
  order: TicketOrderListItem,
  now: number = Date.now(),
): TicketOrderDisplayMeta {
  if (isActiveTicketCancellation(order.cancellationRequest?.status ?? null)) {
    return {
      state: 'refund_pending',
      group: 'current',
      label: '환불 확인 중',
      title: '취소·환불 상태를 확인하고 있어요',
      body: '결제 취소 결과가 확정될 때까지 QR 사용이 제한됩니다.',
      tone: 'amber',
    };
  }

  if (order.refund && order.refund.status !== 'done') {
    return {
      state: 'refund_pending',
      group: 'current',
      label: '환불 확인 중',
      title: '환불 상태를 확인하고 있어요',
      body: '결제수단의 최종 환불 결과를 확인 중입니다.',
      tone: 'amber',
    };
  }

  const allRefunded = order.ticketStatuses.length > 0
    && order.ticketStatuses.every((status) => status === 'refunded');
  if (order.status === 'canceled' || allRefunded || order.cancellationRequest?.status === 'completed') {
    const hadPayment = order.refund !== null
      || order.paymentStatus === 'paid'
      || order.paymentStatus === 'refunded';
    return {
      state: 'refunded',
      group: 'past',
      label: hadPayment ? '환불 완료' : '취소 완료',
      title: hadPayment ? '취소·환불이 완료됐어요' : '예매 취소가 완료됐어요',
      body: hadPayment
        ? '환불 반영 시점은 결제수단에 따라 다를 수 있습니다.'
        : '결제 전 예매가 취소됐습니다.',
      tone: 'muted',
    };
  }

  if (order.status === 'pending') {
    return {
      state: 'payment_pending',
      group: 'current',
      label: '결제 대기',
      title: '결제 상태를 확인하고 있어요',
      body: '결제 확정 전에는 QR이 발급되지 않습니다.',
      tone: 'cyan',
    };
  }

  const eventEndedAt = order.endsAt ? Date.parse(order.endsAt) : Number.NaN;
  const allUsed = order.ticketStatuses.length > 0
    && order.ticketStatuses.every((status) => status === 'used');
  if (allUsed || (Number.isFinite(eventEndedAt) && eventEndedAt <= now)) {
    return {
      state: 'used',
      group: 'past',
      label: allUsed ? '사용 완료' : '이벤트 종료',
      title: '지난 티켓이에요',
      body: allUsed ? '현장 검표가 완료됐습니다.' : '이벤트 일정이 종료됐습니다.',
      tone: 'muted',
    };
  }

  if (order.status === 'paid' && order.ticketStatuses.some((status) => status === 'valid')) {
    return {
      state: 'usable',
      group: 'usable',
      label: '사용 가능',
      title: '현장에서 사용할 수 있어요',
      body: '입장할 티켓의 QR을 한 장씩 제시해주세요.',
      tone: 'mint',
    };
  }

  return {
    state: 'unavailable',
    group: 'current',
    label: '상태 확인 중',
    title: '티켓 상태를 확인하고 있어요',
    body: '잠시 후 최신 상태를 다시 확인해주세요.',
    tone: 'pink',
  };
}

export function groupTicketOrders(
  orders: TicketOrderListItem[],
  now: number = Date.now(),
): Record<TicketOrderGroup, TicketOrderListItem[]> {
  const groups: Record<TicketOrderGroup, TicketOrderListItem[]> = {
    usable: [],
    current: [],
    past: [],
  };

  for (const order of orders) groups[ticketOrderDisplayMeta(order, now).group].push(order);
  for (const group of Object.values(groups)) {
    group.sort((left, right) => (
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    ));
  }
  return groups;
}

export function cancellationEligibility(
  order: Pick<
    TicketOrderListItem,
    'status' | 'startsAt' | 'ticketStatuses' | 'cancellationRequest'
  >,
  now: number = Date.now(),
): { canCancel: true; reason: null } | { canCancel: false; reason: TicketCancellationReason } {
  if (isActiveTicketCancellation(order.cancellationRequest?.status ?? null)) {
    return { canCancel: false, reason: 'active_request' };
  }
  if (order.status !== 'pending' && order.status !== 'paid') {
    return { canCancel: false, reason: 'not_cancelable' };
  }
  if (!order.startsAt) return { canCancel: false, reason: 'schedule_unknown' };

  const startsAt = Date.parse(order.startsAt);
  if (!Number.isFinite(startsAt)) return { canCancel: false, reason: 'schedule_unknown' };
  if (startsAt <= now) return { canCancel: false, reason: 'started' };
  if (order.ticketStatuses.some((status) => status !== 'valid')) {
    return { canCancel: false, reason: 'used' };
  }
  return { canCancel: true, reason: null };
}
