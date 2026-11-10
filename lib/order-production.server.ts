import 'server-only';
import { createClient } from './supabase/server';
import { parseOrderProduction } from './order-production';
export async function loadMyOrderProduction(orderId: string) {
 const { data, error } = await (await createClient()).rpc('get_my_order_production', { p_order: orderId });
 const document = error ? null : parseOrderProduction(data); return document?.orderId === orderId ? document : null;
}

export async function loadAdminOrderProduction(orderId: string) {
 const { data, error } = await (await createClient()).rpc('admin_get_order_production', { p_order: orderId });
 const document = error ? null : parseOrderProduction(data); return document?.orderId === orderId ? document : null;
}
