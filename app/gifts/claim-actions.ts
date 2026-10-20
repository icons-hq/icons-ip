'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAuthState } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';
import { giftError, type GiftFailure } from '@/lib/gifts';
import { loadGiftClaimContext } from '@/lib/gift-claims.server';
import { parseGiftClaimOutcome, type GiftClaimOutcome, type GiftClaimContext } from '@/lib/gift-claims';
import { normalizeRefundAccount } from '@/lib/orders/claims';
import { isUuid } from '@/lib/uuid';
async function mutate(name: string, args: Record<string, unknown>, actorId: string): Promise<GiftClaimOutcome | GiftFailure> {
  const auth = await getCurrentAuthState(); if (!auth.user || auth.user.id !== actorId) return { error: '로그인 계정이 바뀌었습니다. 화면을 새로 열어주세요.' };
  if (!isUuid(args.p_gift_id) || !isUuid(args.p_operation_id)) return { error: '선물과 요청 정보를 확인해주세요.' };
  try {
    const client = await createClient(), { data, error } = await client.rpc(name, { ...args, p_expected_actor_id: actorId });
    if (error) return giftError(error);
    const outcome = parseGiftClaimOutcome(data);
    if (!outcome || outcome.context.giftId !== args.p_gift_id || outcome.receipt.operationId !== args.p_operation_id) return giftError();
    revalidatePath(`/gifts/${args.p_gift_id}`); return outcome;
  } catch (error) { unstable_rethrow(error); return giftError(); }
}
export async function requestGiftClaimAction(giftId: string, type: 'return' | 'exchange', reason: 'change_of_mind' | 'defect', operationId: string, actorId: string) {
  if (!['return', 'exchange'].includes(type) || !['change_of_mind', 'defect'].includes(reason)) return { error: '요청 유형과 사유를 확인해주세요.' };
  return mutate('request_my_gift_claim', { p_gift_id: giftId, p_claim_type: type, p_reason_type: reason, p_operation_id: operationId }, actorId);
}
export async function withdrawGiftClaimAction(giftId: string, claimId: string, revision: number, operationId: string, actorId: string) {
  if (!isUuid(claimId) || !Number.isSafeInteger(revision) || revision < 0) return { error: '현재 요청 상태를 확인해주세요.' };
  return mutate('withdraw_my_gift_claim', { p_gift_id: giftId, p_claim_id: claimId, p_expected_revision: revision, p_operation_id: operationId }, actorId);
}
export async function setGiftRefundAccountAction(giftId: string, claimId: string, bankName: string, accountNumber: string, accountHolder: string, operationId: string, actorId: string) {
  const account = normalizeRefundAccount({ bankName, accountNumber, accountHolder });
  if (!isUuid(claimId) || !account.ok || !account.value) return { error: '환불받을 계좌를 모두 확인해주세요.' };
  return mutate('set_my_gift_claim_refund_account', { p_gift_id: giftId, p_claim_id: claimId, p_operation_id: operationId, p_bank_name: account.value.bankName, p_account_number: account.value.accountNumber, p_account_holder: account.value.accountHolder }, actorId);
}
export async function reloadGiftClaimAction(giftId: string, actorId: string): Promise<{ context: GiftClaimContext } | GiftFailure> {
  const auth = await getCurrentAuthState(); if (!auth.user || auth.user.id !== actorId) return { error: '로그인 계정이 바뀌었습니다. 화면을 새로 열어주세요.' };
  if (!isUuid(giftId)) return { error: '선물 정보를 확인해주세요.' };
  try { return { context: await loadGiftClaimContext(giftId, actorId) }; } catch (error) { unstable_rethrow(error); return { error: '요청 상태를 불러오지 못했습니다. 입력은 유지됩니다.' }; }
}
