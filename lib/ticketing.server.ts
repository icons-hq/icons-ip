import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { PublicTicketType, TicketOrderSnapshot } from './ticketing';

export type { PublicTicketType, TicketOrderSnapshot } from './ticketing';

interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
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

interface TicketTypeSnapshotRow {
  id: string;
  event_id: string;
  name: string;
}

interface EventSnapshotRow {
  id: string;
  title: string;
}

export async function loadPublicTicketTypes(eventId: string): Promise<PublicTicketType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ticket_types')
    .select('id,event_id,name,price,capacity,sold')
    .eq('event_id', eventId)
    .order('name')
    .order('id');

  if (error) throw new Error(`Failed to load public ticket types: ${error.message}`);

  return ((data ?? []) as TicketTypeRow[]).map((row) => ({
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    price: row.price,
    capacity: row.capacity,
    sold: row.sold,
    remaining: Math.max(0, row.capacity - row.sold),
  }));
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

  const [ticketsResult, paymentResult] = await Promise.all([
    supabase
      .from('tickets')
      .select('ticket_type_id')
      .eq('ticket_order_id', ticketOrderId),
    supabase
      .from('payments')
      .select('status')
      .eq('purpose', 'ticket')
      .eq('ref_id', ticketOrderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ status: string }>(),
  ]);

  if (ticketsResult.error) {
    throw new Error(`Failed to load ticket order items: ${ticketsResult.error.message}`);
  }
  if (paymentResult.error) {
    throw new Error(`Failed to load ticket order payment: ${paymentResult.error.message}`);
  }

  const tickets = (ticketsResult.data ?? []) as TicketRow[];
  const ticketTypeIds = new Set(tickets.map((ticket) => ticket.ticket_type_id));
  if (tickets.length === 0 || ticketTypeIds.size !== 1) return null;
  const ticketTypeId = tickets[0].ticket_type_id;

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
    qty: tickets.length,
    total: orderData.total,
    status: orderData.status,
    paymentStatus: paymentResult.data?.status ?? null,
    expiresAt: orderData.expires_at,
  };
}
