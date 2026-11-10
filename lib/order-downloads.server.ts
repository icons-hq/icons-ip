import 'server-only';
import { createClient } from './supabase/server';
import { parseOrderDownloads } from './order-downloads';
export async function loadMyOrderDownloads(orderId: string) {
 const { data, error } = await (await createClient()).rpc('get_my_order_downloads', { p_order: orderId });
 const document = error ? null : parseOrderDownloads(data); return document?.orderId === orderId ? document : null;
}
