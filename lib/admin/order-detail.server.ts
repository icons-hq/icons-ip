import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AdminOrderDetail } from './order-detail';

export async function getAdminOrderDetail(orderId: string): Promise<AdminOrderDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_order_detail', { target_order_id: orderId });
  if (error) throw new Error('주문 상세를 불러오지 못했습니다.');
  return data as AdminOrderDetail | null;
}
