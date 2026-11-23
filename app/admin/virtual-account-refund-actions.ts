'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export type VirtualAccountRefundResolveResult = { ok: true; message: string } | { ok: false; error: string };

const ERRORS: Record<string, string> = {
  invalid_refund_resolution: '처리 내용을 2자 이상 200자 이하로 적어주세요.',
  refund_watch_not_found: '이 주문에는 확인할 환불 송금 기록이 없습니다. 주문 화면을 새로고침해 다시 확인해주세요.',
  refund_watch_not_failed: '환불 송금이 실패한 상태가 아닙니다(송금 확인 중이거나 이미 끝났습니다). 주문 화면을 새로고침해 다시 확인해주세요.',
  operator_capability_required: '주문 관리 권한이 있는 계정만 처리할 수 있습니다.',
};

/**
 * 가상계좌 환불 송금 실패를 '처리 완료'로 표시한다(sales.manage, ADR-0049 결정 5 보강). 회사 계좌에서 직접 보내는 등 결제사 밖에서 환불을
 * 끝낸 경우에만 쓴다 — 토스 상점관리자에서 다시 환불하면 시스템이 조회해 저절로 완료로 바꾼다. 처리 내용은 감사 기록에 남는다.
 */
export async function resolveVirtualAccountRefundAction(input: { orderId: string; note: string }): Promise<VirtualAccountRefundResolveResult> {
  const orderId = typeof input?.orderId === 'string' ? input.orderId : '';
  const auth = await requireAdminActionAccess(isUuid(orderId) ? `/admin/sales/orders/${orderId}` : '/admin/sales/orders', { capability: 'sales.manage' });
  if (!auth) return { ok: false, error: ERRORS.operator_capability_required };
  if (!isUuid(orderId)) return { ok: false, error: '주문 화면을 새로고침한 뒤 다시 시도해주세요.' };
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const length = [...note].length;
  if (length < 2 || length > 200) return { ok: false, error: ERRORS.invalid_refund_resolution };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_resolve_virtual_account_refund_watch', { p_order_id: orderId, p_note: note });
    if (error) return { ok: false, error: ERRORS[error.message] ?? '처리 결과를 확인하지 못했습니다. 주문 화면을 새로고침해 상태를 먼저 확인해주세요.' };
    if (data !== 'resolved' && data !== 'already_resolved') {
      return { ok: false, error: '처리 결과를 확인하지 못했습니다. 주문 화면을 새로고침해 상태를 먼저 확인해주세요.' };
    }
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '처리 결과를 확인하지 못했습니다. 주문 화면을 새로고침해 상태를 먼저 확인해주세요.' };
  }
  for (const path of ['/admin/sales/orders', `/admin/sales/orders/${orderId}`, '/admin/settings/system']) revalidatePath(path);
  revalidatePath('/admin');
  return { ok: true, message: '환불 송금을 처리 완료로 표시했습니다. 시스템 상태의 \'환불 송금 확인 필요\'에서 빠집니다.' };
}
