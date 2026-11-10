import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseAdminOrderDownloads } from './order-downloads';
export async function loadAdminOrderDownloads(orderId: string) {
 const { data, error } = await (await createClient()).rpc('admin_get_order_downloads', { p_order: orderId });
 if (error) throw new Error('디지털 파일 제공 기록을 불러오지 못했습니다.');
 if (data === null) return null;
 const document = parseAdminOrderDownloads(data);
 if (!document || document.orderId !== orderId) throw new Error('디지털 파일 제공 기록을 확인하지 못했습니다.');
 return document;
}
