import 'server-only';

import { normalizeCheckoutAddress, type CheckoutAddress } from './checkout';
import { createClient } from './supabase/server';

interface OrderRow {
  id: string;
  user_id: string;
  status: string;
  total: number;
  address: unknown;
  expires_at: string | null;
  created_at: string;
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
  address: CheckoutAddress | null;
  expiresAt: string | null;
  createdAt: string;
  paymentStatus: string | null;
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
    .select('id,user_id,status,total,address,expires_at,created_at')
    .eq('id', orderId)
    .eq('user_id', userId)
    .maybeSingle<OrderRow>();
  if (orderError || !orderData) return null;

  const [{ data: itemData, error: itemError }, { data: paymentData, error: paymentError }] = await Promise.all([
    supabase
      .from('order_items')
      .select('good_id,qty,unit_price,good_name_snapshot,good_type_snapshot')
      .eq('order_id', orderId)
      .order('id'),
    supabase
      .from('payments')
      .select('status')
      .eq('purpose', 'order')
      .eq('ref_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ status: string }>(),
  ]);
  if (itemError || paymentError) return null;

  const itemRows = (itemData ?? []) as OrderItemRow[];

  return {
    id: orderData.id,
    status: orderData.status,
    total: orderData.total,
    address: normalizeCheckoutAddress(orderData.address),
    expiresAt: orderData.expires_at,
    createdAt: orderData.created_at,
    paymentStatus: paymentData?.status ?? null,
    items: itemRows.map((item) => ({
      goodId: item.good_id,
      name: item.good_name_snapshot,
      type: item.good_type_snapshot,
      qty: item.qty,
      unitPrice: item.unit_price,
    })),
  };
}
