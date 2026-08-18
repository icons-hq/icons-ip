import 'server-only';

import { normalizeCheckoutAddress } from '@/lib/checkout';
import { isOrderWithdrawalReasonType, type OrderWithdrawalReasonType } from '@/lib/orders';
import { orderShipment } from '@/lib/orders/shipment';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';
import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_ORDER_STATUSES,
  GOODS_PAYMENT_ATTEMPT_STATES,
  isKorpayManualRecoveryState,
  ORDER_CANCELLATION_REQUEST_STATUSES,
  type AdminOrderConsoleData,
  type AdminOrderFilters,
  type AdminOrderRecord,
  type AdminOrderStatus,
  type GoodsPaymentAttemptState,
  type OrderCancellationRequestStatus,
} from './orders';

const PAGE_SIZE = 20;
const ORDER_STATUS_SET = new Set<string>(ADMIN_ORDER_STATUSES);
const REQUEST_STATUS_SET = new Set<string>(ORDER_CANCELLATION_REQUEST_STATUSES);
const ATTEMPT_STATE_SET = new Set<string>(GOODS_PAYMENT_ATTEMPT_STATES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  cancellation_reason_type: string | null;
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

interface ManualRecoveryAttemptRow {
  order_id: string;
  request_id: string;
  attempt_id: string;
  provider_order_id: string;
  state: string;
  amount: number;
  currency: string;
  manual_recovery_available: boolean;
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

function requireAttemptState(value: string): GoodsPaymentAttemptState {
  if (!ATTEMPT_STATE_SET.has(value)) {
    throw new Error('Failed to load admin orders: unsupported payment attempt state');
  }
  return value as GoodsPaymentAttemptState;
}

function normalizeManualRecoveryAttemptRow(value: ManualRecoveryAttemptRow) {
  if (!UUID_PATTERN.test(value.order_id)
    || !UUID_PATTERN.test(value.request_id)
    || !UUID_PATTERN.test(value.attempt_id)
    || typeof value.provider_order_id !== 'string'
    || value.provider_order_id !== value.provider_order_id.trim()
    || value.provider_order_id.length < 1
    || value.provider_order_id.length > 200
    || !Number.isSafeInteger(value.amount)
    || value.amount < 0
    || typeof value.currency !== 'string'
    || !/^[A-Z]{3}$/.test(value.currency)
    || typeof value.manual_recovery_available !== 'boolean'
  ) {
    throw new Error('Failed to load admin orders: invalid payment attempt summary');
  }
  const state = requireAttemptState(value.state);
  if (value.manual_recovery_available && !isKorpayManualRecoveryState(state)) {
    throw new Error('Failed to load admin orders: invalid payment recovery availability');
  }
  return {
    orderId: value.order_id,
    requestId: value.request_id,
    attemptId: value.attempt_id,
    providerOrderId: value.provider_order_id,
    state,
    amount: value.amount,
    currency: value.currency,
    manualRecoveryAvailable: value.manual_recovery_available,
  };
}

// 사유 구분은 기한과 반품 배송비 부담 주체를 가른다. 모르는 값을 기본값으로 접으면
// 운영자가 틀린 근거로 승인한다.
function requireReasonType(value: string): OrderWithdrawalReasonType {
  if (!isOrderWithdrawalReasonType(value)) {
    throw new Error('Failed to load admin orders: unsupported cancellation reason type');
  }
  return value;
}

function buyerName(value: string | null, userId: string) {
  return value?.trim() || `fan_${userId.slice(0, 6)}`;
}

export async function getAdminOrderRecords(
  filters: AdminOrderFilters,
  includeManualRecovery = false,
): Promise<AdminOrderConsoleData> {
  const supabase = await createClient();
  /* 드롭다운과 배송조회 링크가 같은 레지스트리를 봐야 한다. 클라이언트 콘솔에는
     상수가 없으므로 목록 응답에 실어 보낸다(#251). */
  const carriers = await getShippingCarrierRegistry();
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
    return { carriers, filters, items: [], pageSize: PAGE_SIZE, total: 0 };
  }

  const orderIds = rows.map((row) => row.id);
  const recoveryOrderIds = includeManualRecovery
    ? rows.filter((row) => row.cancellation_request_id
      && (row.cancellation_request_status === 'processing'
        || row.cancellation_request_status === 'needs_review'))
      .map((row) => row.id)
    : [];
  const [itemsResult, paymentsResult, recoveryAttemptsResult] = await Promise.all([
    supabase
      .from('order_items')
      .select('id,order_id,qty,unit_price,good_name_snapshot,good_type_snapshot')
      .in('order_id', orderIds)
      .order('id', { ascending: true }),
    supabase
      .from('payment_summaries')
      .select('id,ref_id,amount,status,created_at')
      .eq('purpose', 'order')
      .in('ref_id', orderIds)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    recoveryOrderIds.length
      ? supabase.rpc('admin_goods_manual_recovery_attempts', {
          p_order_ids: recoveryOrderIds,
        })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (itemsResult.error) {
    throw new Error(`Failed to load admin order items: ${itemsResult.error.message}`);
  }
  if (paymentsResult.error) {
    throw new Error(`Failed to load admin order payments: ${paymentsResult.error.message}`);
  }
  if (recoveryAttemptsResult.error) {
    throw new Error(`Failed to load admin payment attempts: ${recoveryAttemptsResult.error.message}`);
  }

  const itemRows = (itemsResult.data ?? []) as ItemRow[];
  const paymentRows = (paymentsResult.data ?? []) as PaymentRow[];
  const recoveryAttemptRows = (recoveryAttemptsResult.data ?? []) as ManualRecoveryAttemptRow[];
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

  const recoveryAttemptByOrder = new Map<
    string,
    ReturnType<typeof normalizeManualRecoveryAttemptRow>
  >();
  for (const row of recoveryAttemptRows) {
    const attempt = normalizeManualRecoveryAttemptRow(row);
    if (!orderIds.includes(attempt.orderId) || recoveryAttemptByOrder.has(attempt.orderId)) {
      throw new Error('Failed to load admin orders: invalid payment attempt relation');
    }
    recoveryAttemptByOrder.set(attempt.orderId, attempt);
  }

  const items: AdminOrderRecord[] = rows.map((row) => {
    const cancellationRequest = row.cancellation_request_id
      ? {
          id: row.cancellation_request_id,
          status: requireRequestStatus(row.cancellation_request_status ?? ''),
          reasonType: requireReasonType(row.cancellation_reason_type ?? ''),
          requestedAt: row.cancellation_requested_at ?? '',
          decidedAt: row.cancellation_decided_at,
          decisionNote: row.cancellation_decision_note,
        }
      : null;

    if (cancellationRequest && !cancellationRequest.requestedAt) {
      throw new Error('Failed to load admin orders: incomplete cancellation request');
    }

    const relatedAttempt = recoveryAttemptByOrder.get(row.id) ?? null;
    if (relatedAttempt && (
      !cancellationRequest
      || !['processing', 'needs_review'].includes(cancellationRequest.status)
      || relatedAttempt.requestId !== cancellationRequest.id
    )) {
      throw new Error('Failed to load admin orders: mismatched payment attempt relation');
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
      manualRecoveryAttempt: relatedAttempt && {
        attemptId: relatedAttempt.attemptId,
        requestId: relatedAttempt.requestId,
        providerOrderId: relatedAttempt.providerOrderId,
        state: relatedAttempt.state,
        amount: relatedAttempt.amount,
        currency: relatedAttempt.currency,
        manualRecoveryAvailable: relatedAttempt.manualRecoveryAvailable,
      },
      shipment: orderShipment(carriers, row.shipping_carrier, row.tracking_number),
    };
  });

  return {
    carriers,
    filters,
    items,
    pageSize: PAGE_SIZE,
    total: rows[0].total_count,
  };
}
