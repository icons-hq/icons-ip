import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import type {
  PublicTicketType,
  TicketCancellationRequestSummary,
  TicketCancellationStatus,
  TicketOrderDetail,
  TicketOrderListItem,
  TicketOrderSnapshot,
  TicketOrderStatus,
  TicketRefundSummary,
  TicketStatus,
} from './ticketing';

export type {
  PublicTicketType,
  TicketOrderDetail,
  TicketOrderListItem,
  TicketOrderSnapshot,
} from './ticketing';

interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
  per_user_limit: number;
}

interface ActiveTicketOrderIdRow {
  id: string;
}

interface TicketReservationQuantityRow {
  ticket_order_id: string;
  ticket_type_id: string;
  quantity: number;
}

interface TicketOrderRow {
  id: string;
  user_id: string;
  event_id: string;
  status: string;
  total: number;
  expires_at: string | null;
}

interface TicketRow {
  ticket_type_id: string;
}

interface TicketReservationRow {
  ticket_order_id: string;
  ticket_type_id: string;
  quantity: number;
  unit_price: number;
}

interface TicketTypeSnapshotRow {
  id: string;
  event_id: string;
  name: string;
}

interface EventSnapshotRow {
  id: string;
  title: string;
}

interface TicketHistoryOrderRow {
  id: string;
  user_id: string;
  event_id: string;
  status: string;
  total: number;
  created_at: string;
}

interface TicketHistoryRow {
  id: string;
  ticket_order_id: string;
  ticket_type_id: string;
  status: string;
}

interface TicketHistoryTypeRow extends TicketTypeSnapshotRow {
  event_id: string;
}

interface TicketHistoryEventRow extends EventSnapshotRow {
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
}

interface TicketPaymentRow {
  id: string;
  user_id: string;
  ref_id: string;
  amount: number;
  status: string;
  created_at: string;
}

interface TicketPaymentAttemptRow {
  ref_id: string;
  state: string;
  created_at: string;
}

interface TicketCancellationRow {
  id: string;
  ticket_order_id: string;
  source: string;
  status: string;
  policy_code: string;
  cutoff_at: string;
  gross_amount: number;
  fee_amount: number;
  refund_amount: number;
  requested_at: string;
  completed_at: string | null;
  updated_at: string;
}

interface TicketRefundRow {
  payment_id: string;
  amount: number;
  status: string;
  created_at: string;
}

const TICKET_ORDER_STATUSES = new Set<TicketOrderStatus>(['pending', 'paid', 'canceled']);
const TICKET_STATUSES = new Set<TicketStatus>(['valid', 'used', 'refunded']);
const TICKET_CANCELLATION_STATUSES = new Set<TicketCancellationStatus>([
  'requested',
  'processing',
  'needs_review',
  'completed',
]);

function ticketOrderStatus(value: string): TicketOrderStatus {
  if (!TICKET_ORDER_STATUSES.has(value as TicketOrderStatus)) {
    throw new Error('Failed to load ticket order: unsupported order status');
  }
  return value as TicketOrderStatus;
}

function ticketStatus(value: string): TicketStatus {
  if (!TICKET_STATUSES.has(value as TicketStatus)) {
    throw new Error('Failed to load ticket order: unsupported ticket status');
  }
  return value as TicketStatus;
}

function cancellationSummary(row: TicketCancellationRow | undefined): TicketCancellationRequestSummary | null {
  if (!row) return null;
  if (!TICKET_CANCELLATION_STATUSES.has(row.status as TicketCancellationStatus)) {
    throw new Error('Failed to load ticket order: unsupported cancellation status');
  }
  return {
    status: row.status as TicketCancellationStatus,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    grossAmount: row.gross_amount,
    feeAmount: row.fee_amount,
    refundAmount: row.refund_amount,
  };
}

function refundSummary(row: TicketRefundRow | undefined): TicketRefundSummary | null {
  return row ? { status: row.status, amount: row.amount, createdAt: row.created_at } : null;
}

function firstByKey<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) if (!map.has(key(row))) map.set(key(row), row);
  return map;
}

function paymentStatusWithAttempt(
  paymentStatus: string | null,
  attemptState: string | null,
) {
  if (attemptState === 'confirming' || attemptState === 'unknown' || attemptState === 'needs_review') {
    return 'pending';
  }
  return paymentStatus;
}

export async function loadPublicTicketTypes(
  eventId: string,
  userId?: string,
): Promise<PublicTicketType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ticket_types')
    .select('id,event_id,name,price,capacity,sold,per_user_limit')
    .eq('event_id', eventId)
    .order('name')
    .order('id');

  if (error) throw new Error(`Failed to load public ticket types: ${error.message}`);

  const reservedByType = new Map<string, number>();
  if (userId) {
    const { data: orderData, error: orderError } = await supabase
      .from('ticket_orders')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['pending', 'paid']);
    if (orderError) throw new Error('Failed to load ticket purchase availability');

    const orderIds = ((orderData ?? []) as ActiveTicketOrderIdRow[]).map((row) => row.id);
    if (orderIds.length > 0) {
      const { data: reservationData, error: reservationError } = await supabase
        .from('ticket_order_reservations')
        .select('ticket_order_id,ticket_type_id,quantity')
        .in('ticket_order_id', orderIds);
      if (reservationError) throw new Error('Failed to load ticket purchase availability');

      for (const reservation of (reservationData ?? []) as TicketReservationQuantityRow[]) {
        if (!Number.isInteger(reservation.quantity) || reservation.quantity <= 0) continue;
        reservedByType.set(
          reservation.ticket_type_id,
          (reservedByType.get(reservation.ticket_type_id) ?? 0) + reservation.quantity,
        );
      }
    }
  }

  return ((data ?? []) as TicketTypeRow[]).map((row) => {
    const remaining = Math.max(0, row.capacity - row.sold);
    const perUserLimit = Number.isInteger(row.per_user_limit) && row.per_user_limit > 0
      ? row.per_user_limit
      : 0;
    return {
      id: row.id,
      eventId: row.event_id,
      name: row.name,
      price: row.price,
      capacity: row.capacity,
      sold: row.sold,
      remaining,
      maxQuantity: Math.min(
        remaining,
        Math.max(0, perUserLimit - (reservedByType.get(row.id) ?? 0)),
      ),
    };
  });
}

export async function loadTicketOrder(
  userId: string,
  ticketOrderId: string,
): Promise<TicketOrderSnapshot | null> {
  const supabase = await createClient();
  const { data: orderData, error: orderError } = await supabase
    .from('ticket_orders')
    .select('id,user_id,event_id,status,total,expires_at')
    .eq('id', ticketOrderId)
    .eq('user_id', userId)
    .maybeSingle<TicketOrderRow>();

  if (orderError) throw new Error(`Failed to load ticket order: ${orderError.message}`);
  if (!orderData) return null;
  const paymentLedger = createServiceClient();

  const [reservationResult, ticketsResult, paymentResult, attemptResult] = await Promise.all([
    supabase
      .from('ticket_order_reservations')
      .select('ticket_type_id,quantity,unit_price')
      .eq('ticket_order_id', ticketOrderId)
      .maybeSingle<Omit<TicketReservationRow, 'ticket_order_id'>>(),
    supabase
      .from('tickets')
      .select('ticket_type_id')
      .eq('ticket_order_id', ticketOrderId),
    supabase
      .from('payment_summaries')
      .select('status')
      .eq('purpose', 'ticket')
      .eq('ref_id', ticketOrderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ status: string }>(),
    paymentLedger
      .from('payment_attempts')
      .select('state')
      .eq('user_id', userId)
      .eq('purpose', 'ticket')
      .eq('ref_id', ticketOrderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ state: string }>(),
  ]);

  if (reservationResult.error) {
    throw new Error(`Failed to load ticket reservation: ${reservationResult.error.message}`);
  }
  if (ticketsResult.error) {
    throw new Error(`Failed to load ticket order items: ${ticketsResult.error.message}`);
  }
  if (paymentResult.error) {
    throw new Error(`Failed to load ticket order payment: ${paymentResult.error.message}`);
  }
  if (attemptResult.error) {
    throw new Error(`Failed to load ticket payment attempt: ${attemptResult.error.message}`);
  }

  const tickets = (ticketsResult.data ?? []) as TicketRow[];
  const ticketTypeIds = new Set(tickets.map((ticket) => ticket.ticket_type_id));
  const reservation = reservationResult.data;
  if (
    !reservation
    || !Number.isInteger(reservation.quantity)
    || reservation.quantity <= 0
    || !Number.isInteger(reservation.unit_price)
    || reservation.unit_price <= 0
    || reservation.quantity * reservation.unit_price !== orderData.total
    || (orderData.status === 'paid' && tickets.length !== reservation.quantity)
    || (tickets.length > 0 && (
      ticketTypeIds.size !== 1
      || tickets[0].ticket_type_id !== reservation.ticket_type_id
      || tickets.length !== reservation.quantity
    ))
  ) return null;
  const ticketTypeId = reservation.ticket_type_id;

  const [ticketTypeResult, eventResult] = await Promise.all([
    supabase
      .from('ticket_types')
      .select('id,event_id,name')
      .eq('id', ticketTypeId)
      .eq('event_id', orderData.event_id)
      .maybeSingle<TicketTypeSnapshotRow>(),
    supabase
      .from('events')
      .select('id,title')
      .eq('id', orderData.event_id)
      .maybeSingle<EventSnapshotRow>(),
  ]);

  if (ticketTypeResult.error) {
    throw new Error(`Failed to load ticket type snapshot: ${ticketTypeResult.error.message}`);
  }
  if (eventResult.error) {
    throw new Error(`Failed to load ticket event snapshot: ${eventResult.error.message}`);
  }
  if (!ticketTypeResult.data || !eventResult.data) return null;

  return {
    id: orderData.id,
    eventId: orderData.event_id,
    eventTitle: eventResult.data.title,
    ticketTypeId: ticketTypeResult.data.id,
    ticketTypeName: ticketTypeResult.data.name,
    qty: reservation.quantity,
    total: orderData.total,
    status: orderData.status,
    paymentStatus: paymentStatusWithAttempt(
      paymentResult.data?.status ?? null,
      attemptResult.data?.state ?? null,
    ),
    expiresAt: orderData.expires_at,
  };
}

function ticketsByOrder(rows: TicketHistoryRow[]) {
  const grouped = new Map<string, TicketHistoryRow[]>();
  for (const row of rows) {
    const tickets = grouped.get(row.ticket_order_id) ?? [];
    tickets.push(row);
    grouped.set(row.ticket_order_id, tickets);
  }
  return grouped;
}

function paymentsByOrder(rows: TicketPaymentRow[]) {
  const grouped = new Map<string, TicketPaymentRow[]>();
  for (const row of rows) {
    const payments = grouped.get(row.ref_id) ?? [];
    payments.push(row);
    grouped.set(row.ref_id, payments);
  }
  for (const payments of grouped.values()) {
    payments.sort((left, right) => (
      right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id)
    ));
  }
  return grouped;
}

function requireSingleTicketType(tickets: TicketHistoryRow[]): string | null {
  if (tickets.length === 0) return null;
  const ids = new Set(tickets.map((ticket) => ticket.ticket_type_id));
  return ids.size === 1 ? tickets[0].ticket_type_id : null;
}

function buildListItem({
  cancellation,
  event,
  order,
  payment,
  paymentAttempt,
  refund,
  reservation,
  ticketType,
  tickets,
}: {
  cancellation: TicketCancellationRow | undefined;
  event: TicketHistoryEventRow | undefined;
  order: TicketHistoryOrderRow;
  payment: TicketPaymentRow | undefined;
  paymentAttempt: TicketPaymentAttemptRow | undefined;
  refund: TicketRefundRow | undefined;
  reservation: TicketReservationRow | undefined;
  ticketType: TicketHistoryTypeRow | undefined;
  tickets: TicketHistoryRow[];
}): TicketOrderListItem | null {
  const issuedTicketTypeId = requireSingleTicketType(tickets);
  const ticketTypeId = reservation?.ticket_type_id;
  if (
    !ticketTypeId
    || !reservation
    || !Number.isInteger(reservation.quantity)
    || reservation.quantity <= 0
    || !Number.isInteger(reservation.unit_price)
    || reservation.unit_price <= 0
    || reservation.quantity * reservation.unit_price !== order.total
    || (order.status === 'paid' && tickets.length !== reservation.quantity)
    || (tickets.length > 0 && (
      issuedTicketTypeId !== ticketTypeId
      || tickets.length !== reservation.quantity
    ))
    || !event
    || !ticketType
    || ticketType.id !== ticketTypeId
    || ticketType.event_id !== order.event_id
    || event.id !== order.event_id
  ) return null;

  return {
    id: order.id,
    eventId: order.event_id,
    eventTitle: event.title,
    ticketTypeId,
    ticketTypeName: ticketType.name,
    qty: reservation.quantity,
    total: order.total,
    status: ticketOrderStatus(order.status),
    paymentStatus: paymentStatusWithAttempt(
      payment?.status ?? null,
      paymentAttempt?.state ?? null,
    ),
    createdAt: order.created_at,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    location: event.location,
    ticketStatuses: tickets.map((ticket) => ticketStatus(ticket.status)),
    cancellationRequest: cancellationSummary(cancellation),
    refund: refundSummary(refund),
  };
}

export async function listTicketOrders(userId: string): Promise<TicketOrderListItem[]> {
  const supabase = await createClient();
  const { data: orderData, error: orderError } = await supabase
    .from('ticket_orders')
    .select('id,user_id,event_id,status,total,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (orderError) throw new Error(`Failed to load ticket orders: ${orderError.message}`);
  const orders = (orderData ?? []) as TicketHistoryOrderRow[];
  orders.sort((left, right) => (
    right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id)
  ));
  if (orders.length === 0) return [];

  const orderIds = orders.map((order) => order.id);
  const eventIds = [...new Set(orders.map((order) => order.event_id))];
  const paymentLedger = createServiceClient();
  const [reservationsResult, ticketsResult, eventsResult, paymentsResult, attemptsResult, cancellationsResult] = await Promise.all([
    supabase
      .from('ticket_order_reservations')
      .select('ticket_order_id,ticket_type_id,quantity,unit_price')
      .in('ticket_order_id', orderIds),
    supabase
      .from('tickets')
      .select('id,ticket_order_id,ticket_type_id,status')
      .in('ticket_order_id', orderIds)
      .order('id', { ascending: true }),
    supabase
      .from('events')
      .select('id,title,starts_at,ends_at,location')
      .in('id', eventIds),
    supabase
      .from('payment_summaries')
      .select('id,user_id,ref_id,amount,status,created_at')
      .eq('user_id', userId)
      .eq('purpose', 'ticket')
      .in('ref_id', orderIds)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    paymentLedger
      .from('payment_attempts')
      .select('ref_id,state,created_at')
      .eq('user_id', userId)
      .eq('purpose', 'ticket')
      .in('ref_id', orderIds)
      .order('created_at', { ascending: false }),
    supabase
      .from('ticket_cancellation_requests')
      .select('id,ticket_order_id,source,status,policy_code,cutoff_at,gross_amount,fee_amount,refund_amount,requested_at,completed_at,updated_at')
      .in('ticket_order_id', orderIds)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false }),
  ]);

  if (reservationsResult.error) throw new Error(`Failed to load ticket reservations: ${reservationsResult.error.message}`);
  if (ticketsResult.error) throw new Error(`Failed to load ticket order items: ${ticketsResult.error.message}`);
  if (eventsResult.error) throw new Error(`Failed to load ticket order events: ${eventsResult.error.message}`);
  if (paymentsResult.error) throw new Error(`Failed to load ticket order payments: ${paymentsResult.error.message}`);
  if (attemptsResult.error) throw new Error(`Failed to load ticket payment attempts: ${attemptsResult.error.message}`);
  if (cancellationsResult.error) {
    throw new Error(`Failed to load ticket cancellation requests: ${cancellationsResult.error.message}`);
  }

  const tickets = (ticketsResult.data ?? []) as TicketHistoryRow[];
  const payments = (paymentsResult.data ?? []) as TicketPaymentRow[];
  const reservations = (reservationsResult.data ?? []) as TicketReservationRow[];
  const ticketTypeIds = [...new Set(reservations.map((reservation) => reservation.ticket_type_id))];
  const paymentIds = payments.map((payment) => payment.id);
  const [ticketTypesResult, refundsResult] = await Promise.all([
    ticketTypeIds.length > 0
      ? supabase
          .from('ticket_types')
          .select('id,event_id,name')
          .in('id', ticketTypeIds)
      : Promise.resolve({ data: [], error: null }),
    paymentIds.length > 0
      ? supabase
          .from('refunds')
          .select('payment_id,amount,status,created_at')
          .in('payment_id', paymentIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (ticketTypesResult.error) throw new Error(`Failed to load ticket order types: ${ticketTypesResult.error.message}`);
  if (refundsResult.error) throw new Error(`Failed to load ticket order refunds: ${refundsResult.error.message}`);

  const ticketsMap = ticketsByOrder(tickets);
  const paymentsMap = paymentsByOrder(payments);
  const reservationsMap = new Map(
    reservations.map((reservation) => [reservation.ticket_order_id, reservation]),
  );
  const attemptsMap = firstByKey(
    (attemptsResult.data ?? []) as TicketPaymentAttemptRow[],
    (attempt) => attempt.ref_id,
  );
  const eventsMap = new Map(
    ((eventsResult.data ?? []) as TicketHistoryEventRow[]).map((event) => [event.id, event]),
  );
  const typesMap = new Map(
    ((ticketTypesResult.data ?? []) as TicketHistoryTypeRow[]).map((ticketType) => [ticketType.id, ticketType]),
  );
  const cancellationRows = (cancellationsResult.data ?? []) as TicketCancellationRow[];
  cancellationRows.sort((left, right) => (
    right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id)
  ));
  const cancellationsMap = firstByKey(
    cancellationRows,
    (request) => request.ticket_order_id,
  );
  const refundsMap = firstByKey(
    (refundsResult.data ?? []) as TicketRefundRow[],
    (refund) => refund.payment_id,
  );

  return orders.map((order) => {
    const orderTickets = ticketsMap.get(order.id) ?? [];
    const reservation = reservationsMap.get(order.id);
    const ticketTypeId = reservation?.ticket_type_id;
    const orderPayments = paymentsMap.get(order.id) ?? [];
    const payment = orderPayments[0];
    const refund = orderPayments
      .map((row) => refundsMap.get(row.id))
      .filter((row): row is TicketRefundRow => Boolean(row))
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
    const result = buildListItem({
      cancellation: cancellationsMap.get(order.id),
      event: eventsMap.get(order.event_id),
      order,
      payment,
      paymentAttempt: attemptsMap.get(order.id),
      refund,
      reservation,
      ticketType: ticketTypeId ? typesMap.get(ticketTypeId) : undefined,
      tickets: orderTickets,
    });
    if (!result) throw new Error('Failed to load ticket orders: inconsistent booking snapshot');
    return result;
  });
}

export async function loadTicketOrderDetail(
  userId: string,
  ticketOrderId: string,
): Promise<TicketOrderDetail | null> {
  const supabase = await createClient();
  const { data: orderData, error: orderError } = await supabase
    .from('ticket_orders')
    .select('id,user_id,event_id,status,total,created_at')
    .eq('id', ticketOrderId)
    .eq('user_id', userId)
    .maybeSingle<TicketHistoryOrderRow>();

  if (orderError) throw new Error(`Failed to load ticket order detail: ${orderError.message}`);
  if (!orderData) return null;
  const paymentLedger = createServiceClient();

  const [reservationResult, ticketsResult, eventResult, paymentsResult, attemptResult, cancellationResult] = await Promise.all([
    supabase
      .from('ticket_order_reservations')
      .select('ticket_order_id,ticket_type_id,quantity,unit_price')
      .eq('ticket_order_id', ticketOrderId)
      .maybeSingle<TicketReservationRow>(),
    supabase
      .from('tickets')
      .select('id,ticket_order_id,ticket_type_id,status')
      .eq('ticket_order_id', ticketOrderId)
      .order('id', { ascending: true }),
    supabase
      .from('events')
      .select('id,title,starts_at,ends_at,location')
      .eq('id', orderData.event_id)
      .maybeSingle<TicketHistoryEventRow>(),
    supabase
      .from('payment_summaries')
      .select('id,user_id,ref_id,amount,status,created_at')
      .eq('user_id', userId)
      .eq('purpose', 'ticket')
      .eq('ref_id', ticketOrderId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    paymentLedger
      .from('payment_attempts')
      .select('ref_id,state,created_at')
      .eq('user_id', userId)
      .eq('purpose', 'ticket')
      .eq('ref_id', ticketOrderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<TicketPaymentAttemptRow>(),
    supabase
      .from('ticket_cancellation_requests')
      .select('id,ticket_order_id,source,status,policy_code,cutoff_at,gross_amount,fee_amount,refund_amount,requested_at,completed_at,updated_at')
      .eq('ticket_order_id', ticketOrderId)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false }),
  ]);

  if (reservationResult.error) throw new Error(`Failed to load ticket reservation: ${reservationResult.error.message}`);
  if (ticketsResult.error) throw new Error(`Failed to load ticket order items: ${ticketsResult.error.message}`);
  if (eventResult.error) throw new Error(`Failed to load ticket order event: ${eventResult.error.message}`);
  if (paymentsResult.error) throw new Error(`Failed to load ticket order payments: ${paymentsResult.error.message}`);
  if (attemptResult.error) throw new Error(`Failed to load ticket payment attempt: ${attemptResult.error.message}`);
  if (cancellationResult.error) {
    throw new Error(`Failed to load ticket cancellation request: ${cancellationResult.error.message}`);
  }

  const tickets = (ticketsResult.data ?? []) as TicketHistoryRow[];
  const reservation = reservationResult.data;
  const ticketTypeId = reservation?.ticket_type_id;
  if (!ticketTypeId || !eventResult.data) return null;
  const payments = (paymentsResult.data ?? []) as TicketPaymentRow[];
  payments.sort((left, right) => (
    right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id)
  ));
  const payment = payments[0];
  const cancellationRows = (cancellationResult.data ?? []) as TicketCancellationRow[];
  cancellationRows.sort((left, right) => (
    right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id)
  ));

  const [ticketTypeResult, refundResult] = await Promise.all([
    supabase
      .from('ticket_types')
      .select('id,event_id,name')
      .eq('id', ticketTypeId)
      .eq('event_id', orderData.event_id)
      .maybeSingle<TicketHistoryTypeRow>(),
    payment
      ? supabase
          .from('refunds')
          .select('payment_id,amount,status,created_at')
          .in('payment_id', payments.map((row) => row.id))
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle<TicketRefundRow>()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (ticketTypeResult.error) throw new Error(`Failed to load ticket order type: ${ticketTypeResult.error.message}`);
  if (refundResult.error) throw new Error(`Failed to load ticket order refund: ${refundResult.error.message}`);
  if (!ticketTypeResult.data) return null;

  const summary = buildListItem({
    cancellation: cancellationRows[0],
    event: eventResult.data,
    order: orderData,
    payment,
    paymentAttempt: attemptResult.data ?? undefined,
    refund: refundResult.data ?? undefined,
    reservation,
    ticketType: ticketTypeResult.data,
    tickets,
  });
  if (!summary) return null;

  return {
    id: summary.id,
    eventId: summary.eventId,
    eventTitle: summary.eventTitle,
    ticketTypeId: summary.ticketTypeId,
    ticketTypeName: summary.ticketTypeName,
    qty: summary.qty,
    total: summary.total,
    status: summary.status,
    paymentStatus: summary.paymentStatus,
    createdAt: summary.createdAt,
    startsAt: summary.startsAt,
    endsAt: summary.endsAt,
    location: summary.location,
    cancellationRequest: summary.cancellationRequest,
    refund: summary.refund,
    tickets: tickets.map((ticket) => ({ id: ticket.id, status: ticketStatus(ticket.status) })),
  };
}
