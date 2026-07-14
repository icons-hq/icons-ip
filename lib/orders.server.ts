import 'server-only';

import { normalizeCheckoutAddress } from './checkout';
import {
  isVisibleOrderStatus,
  summarizeOrderItems,
  VISIBLE_ORDER_STATUSES,
  type OrderDetail,
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
}

function requireVisibleStatus(status: string) {
  if (!isVisibleOrderStatus(status)) {
    throw new Error(`Failed to load orders: unsupported status ${status}`);
  }
  return status;
}

export async function loadOrders(userId: string): Promise<OrderListItem[]> {
  const supabase = await createClient();
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('id,user_id,status,total,created_at')
    .eq('user_id', userId)
    .in('status', [...VISIBLE_ORDER_STATUSES])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (orderError) {
    throw new Error(`Failed to load orders: ${orderError.message}`);
  }

  const orderRows = (orderData ?? []) as OrderListRow[];
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
    const status = requireVisibleStatus(order.status);
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
    .in('status', [...VISIBLE_ORDER_STATUSES])
    .maybeSingle<OrderDetailRow>();

  if (orderError) {
    throw new Error(`Failed to load order detail: ${orderError.message}`);
  }
  if (!orderData) return null;

  const status = requireVisibleStatus(orderData.status);
  const [itemsResult, paymentResult, ticketsResult] = await Promise.all([
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
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle<PaymentRow>(),
    supabase
      .from('draw_tickets')
      .select('consumed_at')
      .eq('user_id', userId)
      .eq('source', 'order_paid')
      .eq('source_id', orderId),
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

  const ticketRows = (ticketsResult.data ?? []) as DrawTicketRow[];
  const payment = paymentResult.data;

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
    cardPacks: {
      issuedCount: ticketRows.length,
      availableCount: ticketRows.filter((ticket) => ticket.consumed_at === null).length,
    },
  };
}
