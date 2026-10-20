'use server';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { runtimeGoodsSubscriptionWorker } from '@/lib/subscriptions/worker.server';
import type { SubscriptionResult } from '@/lib/subscriptions/customer';
export async function inspectGoodsSubscriptionPaymentAction(input: { expectedActorId: string; cycleId: string; operationId: string }): Promise<SubscriptionResult<string>> {
  if (![input.expectedActorId, input.cycleId, input.operationId].every(isUuid)) return { ok: false, error: '다시 조회할 회차를 선택해주세요.' };
  const access = await requireAdminActionAccess('/admin/sales/subscriptions', { capability: 'sales.manage' });
  if (access?.user.id !== input.expectedActorId) return { ok: false, error: '현재 로그인 계정과 판매관리 권한을 확인해주세요.' };
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_prepare_subscription_inspection', {
      p_expected_actor_id: input.expectedActorId, p_cycle_id: input.cycleId, p_operation_id: input.operationId });
    if (error) return { ok: false, uncertain: !['42501', '22023', '55000'].includes(error.code ?? ''), error: '결제 확인 요청을 처리하지 못했습니다. 최신 회차를 확인해주세요.' };
    if (!data || data.operationId !== input.operationId || data.cycleId !== input.cycleId || !isUuid(data.planId)) return { ok: false, uncertain: true, error: '요청 기록을 대조하지 못했습니다. 같은 요청으로 다시 확인해주세요.' };
    const current = await requireAdminActionAccess('/admin/sales/subscriptions', { capability: 'sales.manage' });
    if (current?.user.id !== input.expectedActorId) return { ok: false, error: '현재 로그인 계정과 판매관리 권한을 확인해주세요.' };
    const result = await runtimeGoodsSubscriptionWorker().run(input.cycleId, true);
    return { ok: true, value: result.state === 'idle' || result.state === 'wait' ? '다른 확인 작업이 진행 중이거나 이미 처리됐습니다. 최신 상태를 확인해주세요.' : '결제 조회 결과를 반영했습니다. 최신 회차 상태를 확인해주세요.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, uncertain: true, error: '조회 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.' }; }
}
