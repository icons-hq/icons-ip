'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { isOrderDetailId, MAX_ORDER_NOTE_LENGTH } from '@/lib/admin/order-detail';
import { createClient } from '@/lib/supabase/server';

export interface AdminOrderNoteState { error?: string; message?: string; resultKey?: string }
const FAILED = '메모를 저장하지 못했습니다. 입력한 메모는 유지됩니다. 다시 시도해주세요.';

export async function addOrderNoteAction(_state: AdminOrderNoteState, formData: FormData): Promise<AdminOrderNoteState> {
  const orderId = String(formData.get('orderId') ?? '');
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent(isOrderDetailId(orderId) ? `/admin/sales/orders/${orderId}` : '/admin/sales/orders')}`);
  if (!auth.isStaff) return { error: '운영자 권한이 필요합니다.' };
  const operationId = String(formData.get('operationId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (!isOrderDetailId(orderId) || !isOrderDetailId(operationId)) return { error: '주문 화면을 새로 열어 다시 시도해주세요.' };
  if (!body || [...body].length > MAX_ORDER_NOTE_LENGTH) return { error: '메모를 1자 이상 2,000자 이하로 입력해주세요.' };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_add_order_note', {
      target_order_id: orderId, target_body: body, operation_id: operationId,
    });
    if (error) return { error: error.message.includes('order_not_found') ? '주문을 찾을 수 없습니다.' : FAILED };
    if (typeof data !== 'boolean') return { error: FAILED };
  } catch {
    return { error: FAILED };
  }
  revalidatePath(`/admin/sales/orders/${orderId}`);
  return { message: '운영자 메모를 저장했습니다.', resultKey: crypto.randomUUID() };
}
