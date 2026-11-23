'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { PAYMENT_RECONCILE_OUTCOME_MESSAGES, SYSTEM_HEALTH_PATH, paymentReconcileError } from '@/lib/admin/system-health';
import { reconcilePaymentAttempt } from '@/lib/payments/attempt-reconciliation.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export type PaymentReconcileActionResult = { ok: true; outcome: string; message: string } | { ok: false; error: string };

const CASE_REF = /^admin-[0-9a-f]{32}$/;

/**
 * 미종결 결제 시도 한 건의 '결제 상태 다시 확인'(sales.manage). DB가 감사 기록(admin.payment_attempt.reconcile_requested)을 남기고
 * caseRef를 돌려주면, 서버 안에서 기존 재정합 seam을 직접 부른다(내부 HTTP·비밀값 없이). 같은 요청번호의 재요청은 같은 caseRef로
 * 다시 확인한다(재정합이 멱등이다). 같은 시도는 1분에 한 번만 새로 확인한다.
 */
export async function reconcilePaymentAttemptAction(input: { attemptId: string; operationId: string }): Promise<PaymentReconcileActionResult> {
  const auth = await requireAdminActionAccess(SYSTEM_HEALTH_PATH, { capability: 'sales.manage' });
  if (!auth) return { ok: false, error: paymentReconcileError('42501') };
  if (!isUuid(input?.attemptId) || !isUuid(input?.operationId)) return { ok: false, error: '화면을 새로고침한 뒤 다시 시도해주세요.' };

  let attempt: { attemptId: string; purpose: string; provider: string; refId: string | null; caseRef: string };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_begin_payment_reconciliation', { p_attempt_id: input.attemptId, p_operation_id: input.operationId });
    if (error) return { ok: false, error: paymentReconcileError(error.code, error.message) };
    const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    if (row.attemptId !== input.attemptId || typeof row.purpose !== 'string' || typeof row.provider !== 'string'
      || (row.refId !== null && !isUuid(row.refId)) || typeof row.caseRef !== 'string' || !CASE_REF.test(row.caseRef)) {
      return { ok: false, error: paymentReconcileError() };
    }
    attempt = { attemptId: input.attemptId, purpose: row.purpose, provider: row.provider, refId: row.refId as string | null, caseRef: row.caseRef };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: paymentReconcileError() };
  }

  const result = await reconcilePaymentAttempt(attempt, attempt.caseRef);
  revalidatePath(SYSTEM_HEALTH_PATH);
  revalidatePath('/admin');
  if (result.kind === 'reconciled') {
    return { ok: true, outcome: result.outcome, message: PAYMENT_RECONCILE_OUTCOME_MESSAGES[result.outcome] ?? '결제 상태를 다시 확인했습니다.' };
  }
  if (result.kind === 'in_progress') return { ok: false, error: '다른 처리가 이 결제를 확인하고 있습니다. 10분쯤 뒤 새로고침해 결과를 확인해주세요.' };
  if (result.kind === 'unsupported') {
    return { ok: false, error: '이 결제는 결제사 조회로 확인할 수 없습니다(코페이·무통장입금 등). 무통장입금은 주문관리의 미결제 확인에서 처리하고, 코페이는 개발팀에 수동 복구를 요청해주세요.' };
  }
  if (result.kind === 'unavailable') return { ok: false, error: '지금 접속한 사이트에는 이 결제사의 연결 설정이 없어 확인할 수 없습니다. 개발팀에 알려주세요.' };
  return { ok: false, error: paymentReconcileError() };
}
