'use server';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { claimWithdrawalError, parseClaimWithdrawalContext, type ClaimWithdrawalResult } from '@/lib/orders/claim-withdrawal';
const access = () => requireAdminActionAccess('/admin/sales/claims/returns', { capability: 'sales.manage' });
/*
 * 요청 상세의 철회 이력 읽기. 운영자가 고객 대신 철회하는 양식은 없앴다(2026-10-27 "철회는 구매자 몫") — 대리 철회·그 결과 확인 액션도
 * 부르는 화면이 없어 함께 지웠다. DB 함수(admin_withdraw_order_claim·admin_read_order_claim_withdrawal)는 그대로 있다.
 */
export async function loadAdminClaimWithdrawalAction(claimId: string): Promise<ClaimWithdrawalResult> {
  if (!await access()) return { error: claimWithdrawalError('42501') };
  if (!isUuid(claimId)) return { error: '요청을 찾지 못했습니다. 화면을 새로고침한 뒤 다시 열어주세요.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_order_claim_withdrawal_context', { p_claim_id: claimId });
    const context = parseClaimWithdrawalContext(data);
    if (error || !context || context.claimId !== claimId) return { error: claimWithdrawalError(error?.code, error?.message) };
    return { context };
  } catch (error) { unstable_rethrow(error); return { error: '최신 요청을 불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.' }; }
}
