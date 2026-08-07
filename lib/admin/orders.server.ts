import 'server-only';

import { normalizeCheckoutAddress } from '@/lib/checkout';
import { orderShipment } from '@/lib/orders/shipment';
import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_ORDER_STATUSES,
  ORDER_CANCELLATION_REQUEST_STATUSES,
  type AdminOrderConsoleData,
  type AdminOrderFilters,
  type AdminOrderRecord,
  type AdminOrderStatus,
  type OrderCancellationRequestStatus,
} from './orders';

const PAGE_SIZE = 20;
const ORDER_STATUS_SET = new Set<string>(ADMIN_ORDER_STATUSES);
const REQUEST_STATUS_SET = new Set<string>(ORDER_CANCELLATION_REQUEST_STATUSES);

interface SearchRow {
  id: string;
  user_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  status: string;
  total: number;
  address: unknown;
  created_at: string;
  updated_at: string;
  cancellation_request_id: string | null;
  cancellation_request_status: string | null;
  cancellation_requested_at: string | null;
  cancellation_decided_at: string | null;
  cancellation_decision_note: string | null;
  shipping_carrier: string | null;
  tracking_number: string | null;
  total_count: number;
}

interface ItemRow {
  id: string;
  order_id: string;
  qty: number;
  unit_price: number;
  good_name_snapshot: string;
  good_type_snapshot: string;
}

interface PaymentRow {
  id: string;
  ref_id: string;
  amount: number;
  status: string;
  created_at: string;
}

interface RefundRow {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
  created_at: string;
}

function requireOrderStatus(value: string): AdminOrderStatus {
  if (!ORDER_STATUS_SET.has(value)) throw new Error('Failed to load admin orders: unsupported status');
  return value as AdminOrderStatus;
}

function requireRequestStatus(value: string): OrderCancellationRequestStatus {
  if (!REQUEST_STATUS_SET.has(value)) {
    throw new Error('Failed to load admin orders: unsupported cancellation status');
  }
  return value as OrderCancellationRequestStatus;
}

function buyerName(value: string | null, userId: string) {
  return value?.trim() || `fan_${userId.slice(0, 6)}`;
}

export async function getAdminOrderRecords(
  filters: AdminOrderFilters,
): Promise<AdminOrderConsoleData> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_search_orders', {
    p_from: filters.from,
    p_limit: PAGE_SIZE,
    p_offset: (filters.page - 1) * PAGE_SIZE,
    p_query: filters.query || null,
    p_status: filters.status === 'all' ? null : filters.status,
    p_to: filters.to,
  });

  if (error) throw new Error(`Failed to load admin orders: ${error.message}`);
  const rows = (data ?? []) as SearchRow[];
  if (!rows.length) {
    return { filters, items: [], pageSize: PAGE_SIZE, total: 0 };
  }

  const orderIds = rows.map((row) => row.id);
  const [itemsResult, paymentsResult] = await Promise.all([
    supabase
      .from('order_items')
      .select('id,order_id,qty,unit_price,good_name_snapshot,good_type_snapshot')
      .in('order_id', orderIds)
      .order('id', { ascending: true }),
    supabase
      .from('payments')
      .select('id,ref_id,amount,status,created_at')
      .eq('purpose', 'order')
      .in('ref_id', orderIds)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  ]);

  if (itemsResult.error) {
    throw new Error(`Failed to load admin order items: ${itemsResult.error.message}`);
  }
  if (paymentsResult.error) {
    throw new Error(`Failed to load admin order payments: ${paymentsResult.error.message}`);
  }

  const itemRows = (itemsResult.data ?? []) as ItemRow[];
  const paymentRows = (paymentsResult.data ?? []) as PaymentRow[];
  let refundRows: RefundRow[] = [];
  if (paymentRows.length) {
    const { data: refundData, error: refundError } = await supabase
      .from('refunds')
      .select('id,payment_id,amount,status,created_at')
      .in('payment_id', paymentRows.map((payment) => payment.id))
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (refundError) {
      throw new Error(`Failed to load admin order refunds: ${refundError.message}`);
    }
    refundRows = (refundData ?? []) as RefundRow[];
  }

  const itemsByOrder = new Map<string, ItemRow[]>();
  for (const item of itemRows) {
    const entries = itemsByOrder.get(item.order_id) ?? [];
    entries.push(item);
    itemsByOrder.set(item.order_id, entries);
  }

  const paymentsByOrder = new Map<string, PaymentRow[]>();
  const orderByPayment = new Map<string, string>();
  for (const payment of paymentRows) {
    const entries = paymentsByOrder.get(payment.ref_id) ?? [];
    entries.push(payment);
    paymentsByOrder.set(payment.ref_id, entries);
    orderByPayment.set(payment.id, payment.ref_id);
  }

  const refundsByOrder = new Map<string, RefundRow[]>();
  for (const refund of refundRows) {
    const orderId = orderByPayment.get(refund.payment_id);
    if (!orderId) continue;
    const entries = refundsByOrder.get(orderId) ?? [];
    entries.push(refund);
    refundsByOrder.set(orderId, entries);
  }

  const items: AdminOrderRecord[] = rows.map((row) => {
    const cancellationRequest = row.cancellation_request_id
      ? {
          id: row.cancellation_request_id,
          status: requireRequestStatus(row.cancellation_request_status ?? ''),
          requestedAt: row.cancellation_requested_at ?? '',
          decidedAt: row.cancellation_decided_at,
          decisionNote: row.cancellation_decision_note,
        }
      : null;

    if (cancellationRequest && !cancellationRequest.requestedAt) {
      throw new Error('Failed to load admin orders: incomplete cancellation request');
    }

    return {
      id: row.id,
      userId: row.user_id,
      buyerName: buyerName(row.buyer_name, row.user_id),
      buyerEmail: row.buyer_email,
      status: requireOrderStatus(row.status),
      total: row.total,
      address: normalizeCheckoutAddress(row.address),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: (itemsByOrder.get(row.id) ?? []).map((item) => ({
        id: item.id,
        name: item.good_name_snapshot,
        type: item.good_type_snapshot,
        qty: item.qty,
        unitPrice: item.unit_price,
      })),
      payments: (paymentsByOrder.get(row.id) ?? []).map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        status: payment.status,
        createdAt: payment.created_at,
      })),
      refunds: (refundsByOrder.get(row.id) ?? []).map((refund) => ({
        id: refund.id,
        amount: refund.amount,
        status: refund.status,
        createdAt: refund.created_at,
      })),
      cancellationRequest,
      shipment: orderShipment(row.shipping_carrier, row.tracking_number),
    };
  });

  return {
    filters,
    items,
    pageSize: PAGE_SIZE,
    total: rows[0].total_count,
  };
}
