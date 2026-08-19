import 'server-only';

import {
  normalizeCheckoutAddress,
  normalizeCheckoutPaymentMethod,
  type CheckoutAddress,
  type CheckoutPaymentMethod,
} from './checkout';
import { createClient } from './supabase/server';
import { createServiceClient } from './supabase/service';

interface OrderRow {
  id: string;
  user_id: string;
  status: string;
  total: number;
  shipping_fee: number | null;
  address: unknown;
  expires_at: string | null;
  created_at: string;
  payment_method: string | null;
}

interface OrderItemRow {
  good_id: string;
  qty: number;
  unit_price: number;
  good_name_snapshot: string;
  good_type_snapshot: string;
}

export interface CheckoutOrderItem {
  goodId: string;
  name: string;
  type: string;
  qty: number;
  unitPrice: number;
}

export interface CheckoutOrderSnapshot {
  id: string;
  status: string;
  total: number;
  /** 주문 시점 배송비 스냅샷. total에 이미 포함되어 있다. */
  shippingFee: number;
  address: CheckoutAddress | null;
  expiresAt: string | null;
  createdAt: string;
  paymentStatus: string | null;
  /** 주문 생성 시점에 고정된 결제수단 (#256). */
  paymentMethod: CheckoutPaymentMethod;
  items: CheckoutOrderItem[];
}

export async function loadLatestCheckoutAddress(userId: string): Promise<CheckoutAddress | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('orders')
    .select('address')
    .eq('user_id', userId)
    .not('address', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ address: unknown }>();

  return error ? null : normalizeCheckoutAddress(data?.address);
}

export async function loadLatestPendingCheckoutOrderId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .not('checkout_key', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  return error ? null : data?.id ?? null;
}

export async function loadCheckoutOrder(
  userId: string,
  orderId: string,
): Promise<CheckoutOrderSnapshot | null> {
  const supabase = await createClient();
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('id,user_id,status,total,shipping_fee,address,expires_at,created_at,payment_method')
    .eq('id', orderId)
    .eq('user_id', userId)
    .maybeSingle<OrderRow>();
  if (orderError || !orderData) return null;
  const paymentLedger = createServiceClient();

  const [
    { data: itemData, error: itemError },
    { data: paymentData, error: paymentError },
    { data: attemptData, error: attemptError },
  ] = await Promise.all([
    supabase
      .from('order_items')
      .select('good_id,qty,unit_price,good_name_snapshot,good_type_snapshot')
      .eq('order_id', orderId)
      .order('id'),
    supabase
      .from('payment_summaries')
      .select('status')
      .eq('purpose', 'order')
      .eq('ref_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ status: string }>(),
    paymentLedger
      .from('payment_attempts')
      .select('state')
      .eq('user_id', userId)
      .eq('purpose', 'order')
      .eq('ref_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ state: string }>(),
  ]);
  if (itemError || paymentError || attemptError) return null;

  const itemRows = (itemData ?? []) as OrderItemRow[];

  return {
    id: orderData.id,
    status: orderData.status,
    total: orderData.total,
    shippingFee: orderData.shipping_fee ?? 0,
    address: normalizeCheckoutAddress(orderData.address),
    expiresAt: orderData.expires_at,
    createdAt: orderData.created_at,
    paymentStatus: (
      attemptData?.state === 'confirming'
      || attemptData?.state === 'unknown'
      || attemptData?.state === 'needs_review'
    ) ? 'pending' : paymentData?.status ?? null,
    paymentMethod: normalizeCheckoutPaymentMethod(orderData.payment_method) ?? 'card',
    items: itemRows.map((item) => ({
      goodId: item.good_id,
      name: item.good_name_snapshot,
      type: item.good_type_snapshot,
      qty: item.qty,
      unitPrice: item.unit_price,
    })),
  };
}
