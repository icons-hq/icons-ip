'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { AUTO_ORDER_CONFIRMATION_PATH, autoOrderConfirmationError, isAutoOrderRunTime, parseAutoOrderConfirmation,
  type AutoOrderConfirmationState } from '@/lib/admin/auto-order-confirmation';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export type AutoOrderConfirmationResult = { state: AutoOrderConfirmationState } | { error: string; uncertain?: boolean };

/** 자동 발주확인 켜기·끄기와 매일 실행 시각을 저장한다. 같은 요청 ID는 같은 결과를 다시 읽는다. */
export async function saveAutoOrderConfirmationAction(enabled: unknown, runTime: unknown, expectedRevision: unknown, operationId: unknown): Promise<AutoOrderConfirmationResult> {
  try {
    if (!await requireAdminActionAccess(AUTO_ORDER_CONFIRMATION_PATH, { capability: 'sales.manage' })) return { error: autoOrderConfirmationError('42501') };
    if (typeof enabled !== 'boolean' || !isAutoOrderRunTime(runTime) || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 1 || !isUuid(operationId)) return { error: autoOrderConfirmationError('22023') };
    const { data, error } = await (await createClient()).rpc('admin_save_auto_order_confirmation', {
      p_enabled: enabled, p_run_time: runTime, p_expected_revision: expectedRevision, p_operation_id: operationId,
    });
    if (error) {
      const known = error.code === 'PT409' || ['42501', '28000', '22023'].includes(error.code ?? '');
      return known ? { error: autoOrderConfirmationError(error.code, error.message) } : { error: autoOrderConfirmationError(), uncertain: true };
    }
    const state = parseAutoOrderConfirmation(data);
    if (!state || state.enabled !== enabled || state.runTime !== runTime) return { error: autoOrderConfirmationError(), uncertain: true };
    revalidatePath(AUTO_ORDER_CONFIRMATION_PATH);
    return { state };
  } catch (error) { unstable_rethrow(error); return { error: autoOrderConfirmationError(), uncertain: true }; }
}
