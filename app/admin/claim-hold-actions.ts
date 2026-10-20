'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import {
  claimHoldError, claimHoldReceiptMatches, normalizeClaimHoldRequest,
  parseClaimHoldContext, parseClaimHoldReceipt, type ClaimHoldResult,
} from '@/lib/orders/claim-hold';

const access = () => requireAdminActionAccess('/admin/sales/claims/returns', { capability: 'sales.manage' });

export async function loadClaimHoldContextAction(claimId: string): Promise<ClaimHoldResult> {
  const actor = await access();
  if (!actor) return { error: claimHoldError('42501') };
  if (!isUuid(claimId)) return { error: '요청번호를 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_order_claim_hold_context', { p_claim_id: claimId });
    const context = parseClaimHoldContext(data);
    return !error && context?.claimId === claimId && context.actorId === actor.user.id
      ? { context } : { error: claimHoldError(error?.code, error?.message) };
  } catch (error) {
    unstable_rethrow(error);
    return { error: '최신 요청을 읽지 못했습니다.' };
  }
}

export async function readClaimHoldAction(id: string): Promise<ClaimHoldResult> {
  const actor = await access();
  if (!actor) return { error: claimHoldError('42501'), uncertain: true };
  if (!isUuid(id)) return { error: '변경 요청번호를 확인해주세요.', uncertain: true };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_read_order_claim_hold', { p_operation_id: id });
    if (error) return { error: claimHoldError(error.code, error.message), uncertain: true };
    if (data === null) return { receipt: null };
    const receipt = parseClaimHoldReceipt(data);
    return receipt?.id === id && receipt.actorId === actor.user.id
      ? { receipt } : { error: '해당 요청의 저장 결과를 확인하지 못했습니다.', uncertain: true };
  } catch (error) {
    unstable_rethrow(error);
    return { error: '저장 결과를 읽지 못했습니다.', uncertain: true };
  }
}

export async function changeClaimHoldAction(input: unknown): Promise<ClaimHoldResult> {
  const actor = await access();
  if (!actor) return { error: claimHoldError('42501') };
  const request = normalizeClaimHoldRequest(input);
  if (!request) return { error: '보류 사유와 현재 요청에 대한 확인을 입력해주세요.' };
  if (request.actorId !== actor.user.id) return { error: claimHoldError('42501') };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_change_order_claim_hold', {
      p_claim_id: request.claimId, p_operation_id: request.id, p_expected_revision: request.revision,
      p_expected_claim_type: request.claimType, p_decision: request.decision, p_note: request.note,
      p_expected_actor_id: request.actorId,
    });
    if (error) return {
      error: claimHoldError(error.code, error.message), conflict: error.code === 'PT409',
      uncertain: !['PT409', '42501', '22023', '23514', 'P0002'].includes(error.code ?? ''),
    };
    const receipt = parseClaimHoldReceipt(data);
    if (!receipt || !claimHoldReceiptMatches(receipt, request)) {
      return { error: '저장 결과가 불확실합니다. 같은 요청 결과를 확인해주세요.', uncertain: true };
    }
    for (const path of ['/admin/sales/claims', '/admin/sales/orders', '/admin/sales/dispatch',
      `/admin/sales/orders/${receipt.orderId}`, `/orders/${receipt.orderId}`]) {
      revalidatePath(path, path === '/admin/sales/claims' ? 'layout' : 'page');
    }
    return { receipt };
  } catch (error) {
    unstable_rethrow(error);
    return { error: '저장 결과가 불확실합니다. 같은 요청 결과를 확인해주세요.', uncertain: true };
  }
}
