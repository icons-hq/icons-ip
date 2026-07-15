import 'server-only';

import { normalizeCheckoutAddress } from './checkout';
import {
  isOrderDetailStatus,
  isOrderCancellationRequestStatus,
  ORDER_DETAIL_STATUSES,
  summarizeOrderItems,
  VISIBLE_ORDER_STATUSES,
  type OrderDetail,
  type OrderCancellationRequestStatus,
  type OrderListItem,
} from './orders';
import { createClient } from '@/lib/supabase/server';

interface OrderListRow {
  id: string;
  user_id: string;
  status: string;
  total: number;
  created_at: string;
}

interface OrderDetailRow extends OrderListRow {
  address: unknown;
}

interface OrderListItemRow {
  order_id: string;
  qty: number;
  good_name_snapshot: string;
}

interface CancellationRequestOrderRow {
  order_id: string;
}

interface OrderDetailItemRow extends OrderListItemRow {
  id: string;
  good_id: string;
  unit_price: number;
  good_type_snapshot: string;
}

interface PaymentRow {
  id: string;
  amount: number;
  status: string;
  created_at: string;
}

interface DrawTicketRow {
  consumed_at: string | null;
  revoked_at: string | null;
}

interface RefundRow {
  status: string;
  created_at: string;
}

interface CancellationRequestRow {
  id: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
}

function requireDetailStatus(status: string) {
  if (!isOrderDetailStatus(status)) {
    throw new Error(`Failed to load order detail: unsupported status ${status}`);
  }
  return status;
}

export async function loadOrders(userId: string): Promise<OrderListItem[]> {
  const supabase = await createClient();
  const [orderResult, requestResult] = await Promise.all([
    supabase
      .from('orders')
      .select('id,user_id,status,total,created_at')
      .eq('user_id', userId)
      .in('status', [...VISIBLE_ORDER_STATUSES])
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    supabase
      .from('order_cancellation_requests')
      .select('order_id'),
  ]);

  if (orderResult.error) {
    throw new Error(`Failed to load orders: ${orderResult.error.message}`);
  }
  if (requestResult.error) {
    throw new Error(`Failed to load order cancellation requests: ${requestResult.error.message}`);
  }

  let orderRows = (orderResult.data ?? []) as OrderListRow[];
  const requestedOrderIds = [...new Set(
    ((requestResult.data ?? []) as CancellationRequestOrderRow[]).map((request) => request.order_id),
  )];

  if (requestedOrderIds.length) {
    const { data: pendingData, error: pendingError } = await supabase
      .from('orders')
      .select('id,user_id,status,total,created_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .in('id', requestedOrderIds)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (pendingError) throw new Error(`Failed to load requested orders: ${pendingError.message}`);
    orderRows = [...orderRows, ...((pendingData ?? []) as OrderListRow[])];
  }

  orderRows.sort((left, right) => (
    right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id)
  ));

  if (orderRows.length === 0) return [];

  const orderIds = orderRows.map((order) => order.id);
  const { data: itemData, error: itemError } = await supabase
    .from('order_items')
    .select('order_id,qty,good_name_snapshot')
    .in('order_id', orderIds)
    .order('id', { ascending: true });

  if (itemError) {
    throw new Error(`Failed to load order items: ${itemError.message}`);
  }

  const itemsByOrderId = new Map<string, OrderListItemRow[]>();
  for (const item of (itemData ?? []) as OrderListItemRow[]) {
    const items = itemsByOrderId.get(item.order_id) ?? [];
    items.push(item);
    itemsByOrderId.set(item.order_id, items);
  }

  return orderRows.map((order) => {
    const status = requireDetailStatus(order.status);
    const summary = summarizeOrderItems(
      (itemsByOrderId.get(order.id) ?? []).map((item) => ({
        name: item.good_name_snapshot,
        qty: item.qty,
      })),
    );

    return {
      id: order.id,
      status,
      total: order.total,
      createdAt: order.created_at,
      itemLabel: summary.label,
      itemCount: summary.itemCount,
    };
  });
}

export async function loadOrderDetail(userId: string, orderId: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('id,user_id,status,total,address,created_at')
    .eq('id', orderId)
    .eq('user_id', userId)
    .in('status', [...ORDER_DETAIL_STATUSES])
    .maybeSingle<OrderDetailRow>();

  if (orderError) {
    throw new Error(`Failed to load order detail: ${orderError.message}`);
  }
  if (!orderData) return null;

  const status = requireDetailStatus(orderData.status);
  const [itemsResult, paymentResult, ticketsResult, cancellationRequestResult] = await Promise.all([
    supabase
      .from('order_items')
      .select('id,order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot')
      .eq('order_id', orderId)
      .order('id', { ascending: true }),
    supabase
      .from('payments')
      .select('id,amount,status,created_at')
      .eq('user_id', userId)
      .eq('purpose', 'order')
      .eq('ref_id', orderId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    supabase
      .from('draw_tickets')
      .select('consumed_at,revoked_at')
      .eq('user_id', userId)
      .eq('source', 'order_paid')
      .eq('source_id', orderId),
    supabase
      .from('order_cancellation_requests')
      .select('id,status,requested_at,decided_at,decision_note')
      .eq('order_id', orderId)
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle<CancellationRequestRow>(),
  ]);

  if (itemsResult.error) {
    throw new Error(`Failed to load order items: ${itemsResult.error.message}`);
  }
  if (paymentResult.error) {
    throw new Error(`Failed to load order payment: ${paymentResult.error.message}`);
  }
  if (ticketsResult.error) {
    throw new Error(`Failed to load order card packs: ${ticketsResult.error.message}`);
  }
  if (cancellationRequestResult.error) {
    throw new Error(`Failed to load order cancellation request: ${cancellationRequestResult.error.message}`);
  }

  const ticketRows = (ticketsResult.data ?? []) as DrawTicketRow[];
  const paymentRows = (paymentResult.data ?? []) as PaymentRow[];
  const payment = paymentRows[0] ?? null;
  let refund: RefundRow | null = null;
  const cancellationRequestRow = cancellationRequestResult.data;
  let cancellationRequestStatus: OrderCancellationRequestStatus | null = null;
  if (cancellationRequestRow) {
    if (!isOrderCancellationRequestStatus(cancellationRequestRow.status)) {
      throw new Error('Failed to load order cancellation request: unsupported status');
    }
    cancellationRequestStatus = cancellationRequestRow.status;
  }

  if (paymentRows.length > 0) {
    const { data: refundData, error: refundError } = await supabase
      .from('refunds')
      .select('status,created_at')
      .in('payment_id', paymentRows.map((row) => row.id))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<RefundRow>();

    if (refundError) {
      throw new Error(`Failed to load order refund: ${refundError.message}`);
    }
    refund = refundData;
  }

  return {
    id: orderData.id,
    status,
    total: orderData.total,
    address: normalizeCheckoutAddress(orderData.address),
    createdAt: orderData.created_at,
    items: ((itemsResult.data ?? []) as OrderDetailItemRow[]).map((item) => ({
      goodId: item.good_id,
      name: item.good_name_snapshot,
      type: item.good_type_snapshot,
      qty: item.qty,
      unitPrice: item.unit_price,
    })),
    payment: payment
      ? {
          amount: payment.amount,
          status: payment.status,
          createdAt: payment.created_at,
        }
      : null,
    refund: refund
      ? {
          status: refund.status,
          createdAt: refund.created_at,
        }
      : null,
    cancellationRequest: cancellationRequestRow && cancellationRequestStatus
      ? {
          id: cancellationRequestRow.id,
          status: cancellationRequestStatus,
          requestedAt: cancellationRequestRow.requested_at,
          decidedAt: cancellationRequestRow.decided_at,
          decisionNote: cancellationRequestRow.decision_note,
        }
      : null,
    cardPacks: {
      issuedCount: ticketRows.length,
      availableCount: ticketRows.filter((ticket) => (
        ticket.consumed_at === null && ticket.revoked_at === null
      )).length,
    },
  };
}
