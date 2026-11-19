import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseAdminOrderAcknowledgement, type AdminOrderAcknowledgement } from './order-acknowledgement';

/**
 * 주문의 결제 전 확인 동의 기록. 기록이 없으면 null(이 기능 이전 주문이거나 기록에 실패한 주문)이다.
 * 이 읽기가 실패해도 주문 상세 자체는 열어야 하므로 실패는 undefined로 돌려 화면이 칸을 숨기게 한다.
 */
export async function loadAdminOrderAcknowledgement(orderId: string): Promise<AdminOrderAcknowledgement | null | undefined> {
  try {
    const { data, error } = await (await createClient()).rpc('admin_order_purchase_acknowledgement', { p_order: orderId });
    if (error) return undefined;
    if (data === null) return null;
    const parsed = parseAdminOrderAcknowledgement(data);
    return parsed && parsed.orderId === orderId ? parsed : undefined;
  } catch {
    return undefined;
  }
}
