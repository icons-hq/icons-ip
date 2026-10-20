import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseOrderAddressContext, parseOrderAddressReceipt } from './order-address';
export async function getOrderAddressContext(orderId: string) {
  const client = await createClient(); const { data, error } = await client.rpc('admin_order_address_context', { p_order_id: orderId });
  const parsed = parseOrderAddressContext(data); if (error || !parsed || parsed.orderId !== orderId) throw new Error('Failed to read order address context'); return parsed;
}
export async function getOrderAddressReceipt(id: string) {
  const client = await createClient(); const { data, error } = await client.rpc('admin_get_order_address_change', { p_operation_id: id });
  if (error) throw new Error('Failed to read order address receipt');
  if (data === null) return null;
  const parsed = parseOrderAddressReceipt(data); if (!parsed || parsed.id !== id) throw new Error('Invalid order address receipt'); return parsed;
}
