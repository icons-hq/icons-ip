'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { notePiiAccess } from '@/lib/admin/pii-access-log.server';
import { normalizeAdminRefundAccountEntry, VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS, virtualAccountRefundAccountEntryMessage } from '@/lib/admin/virtual-account-refund-account';
import { retryVirtualAccountRefund } from '@/lib/orders/virtual-account-refund-retry.server';
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

export type VirtualAccountRefundAccountSaveResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * 운영자가 전화 등으로 받은 가상계좌 환급 계좌를 대신 입력한다(sales.manage — 환불 처리·[상태 다시 확인]과 같은 권한, ADR-0049 결정 5 보강
 * 2026-11-25). 판정·저장소는 구매자 입력과 같고(admin_set_order_claim_refund_account), 사유와 함께 감사 기록에 남는다. 저장 뒤 동작은
 * 기존 재시도 규칙 그대로다 — 취소는 서버가 이 계좌로 환불을 다시 요청하고(시스템), 반품은 운영자가 [환불 완료 확정]·[상태 다시 확인]을 누른다.
 * 개인정보 접속기록(정정)을 남긴다. 계좌 원문은 응답·로그에 싣지 않는다.
 */
export async function saveVirtualAccountRefundAccountAction(input: unknown): Promise<VirtualAccountRefundAccountSaveResult> {
  const entry = normalizeAdminRefundAccountEntry(input);
  const claimPath = entry ? `/admin/sales/claims/${entry.claimType === 'return' ? 'returns' : 'cancels'}/${entry.claimId}` : '/admin/sales/claims/cancels';
  const auth = await requireAdminActionAccess(claimPath, { capability: 'sales.manage' });
  if (!auth) return { ok: false, error: VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS.operator_capability_required };
  if (!entry) return { ok: false, error: VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS.invalid_entry };
  let claimType: 'cancel' | 'return';
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_set_order_claim_refund_account', {
      p_claim_id: entry.claimId,
      p_operation_id: entry.operationId,
      p_bank_name: entry.bankName,
      p_account_number: entry.accountNumber,
      p_account_holder: entry.accountHolder,
      p_reason: entry.reason,
    });
    if (error) {
      return { ok: false, error: VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS[error.message] ?? VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS.unknown };
    }
    const receipt = data as { state?: unknown; claimId?: unknown; orderId?: unknown; claimType?: unknown } | null;
    if (!receipt || receipt.state !== 'saved' || receipt.claimId !== entry.claimId || receipt.orderId !== entry.orderId
      || (receipt.claimType !== 'cancel' && receipt.claimType !== 'return')) {
      return { ok: false, error: VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS.unknown };
    }
    claimType = receipt.claimType;
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS.unknown };
  }
  // 계좌는 저장됐다 — 접속기록(정정)은 실패해도 결과를 바꾸지 않는다(DB 감사 기록이 따로 있다).
  await notePiiAccess({ actorId: auth.user.id, action: 'correct', surface: 'refund_account', path: claimPath, subjectKind: 'claim',
    subjectIds: [entry.claimId], detail: { mode: 'virtual_account', claimType } });
  // 취소는 구매자 입력과 같이 이 계좌로 환불을 다시 요청한다(DB가 대상인지 다시 본다). 반품은 운영자 버튼(DB가 operator_required).
  const retry = await retryVirtualAccountRefund(entry.claimId);
  for (const path of ['/admin/sales/orders', `/admin/sales/orders/${entry.orderId}`, `/admin/sales/claims/cancels/${entry.claimId}`,
    `/admin/sales/claims/returns/${entry.claimId}`, `/orders/${entry.orderId}`]) revalidatePath(path);
  return { ok: true, message: virtualAccountRefundAccountEntryMessage(claimType, retry) };
}
