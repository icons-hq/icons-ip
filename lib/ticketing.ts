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
