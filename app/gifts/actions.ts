'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAuthState } from '@/lib/auth/server';
import { isOnboarded, isAccountSuspended } from '@/lib/auth/onboarding';
import { createClient } from '@/lib/supabase/server';
import { normalizeCheckoutAddress, normalizeCheckoutPaymentMethod } from '@/lib/checkout';
import { giftClaimSessionHash, giftSecretHash, loadGift, maskRandomGiftOptions } from '@/lib/gifts.server';
import { GIFT_MESSAGE_LIMIT, giftError, parseGiftOutcome, type GiftDetail, type GiftFailure, type GiftReceipt } from '@/lib/gifts';
import { parseGoodsTransactionSelection, parseGoodsTransactionQuote, type GoodsTransactionQuote } from '@/lib/goods-transaction';
import { isUuid } from '@/lib/uuid';
import { goodsCheckoutPaymentsEnabled } from '@/lib/payments/goods-checkout-availability';
import { bankTransferCheckoutEnabled } from '@/lib/payments/bank-transfer.server';

type GiftResult = { gift: GiftDetail; receipt?: GiftReceipt } | GiftFailure;
const invalid = (): GiftFailure => ({ error: '입력과 선물 정보를 확인해주세요.' });
async function actor(expected: string, newWrite = true): Promise<string | GiftFailure> {
  const auth = await getCurrentAuthState();
  if (!auth.user || auth.user.id !== expected) return { error: '로그인 계정이 바뀌었습니다. 화면을 새로 열어주세요.' };
  if (newWrite && (isAccountSuspended(auth.profile) || !isOnboarded(auth.profile, auth.user.email))) return { error: '현재 계정 상태로 새 선물을 준비하거나 수락할 수 없습니다.' };
  return auth.user.id;
}
async function mutate(name: string, args: Record<string, unknown>, id: string): Promise<GiftResult> {
  try {
    const client = await createClient(), { data, error } = await client.rpc(name, args);
    if (error) return giftError(error);
    const outcome = parseGiftOutcome(data); if (!outcome || outcome.gift.id !== id || outcome.receipt.operationId !== args.p_operation_id) return giftError();
    /* 랜덤 판매로 바뀐 굿즈의 옵션명은 응답에서도 가린다(m27 CUST-1). 읽지 못하면 catch가 같은 요청 재확인으로 돌린다. */
    const [gift] = await maskRandomGiftOptions([outcome.gift], client);
    revalidatePath('/gifts'); return { ...outcome, gift };
  } catch (error) { unstable_rethrow(error); return giftError(); }
}
export async function createGiftAction(id: string, selection: unknown, message: string, operationId: string, expectedActorId: string): Promise<GiftResult> {
  const identity = await actor(expectedActorId, false); if (typeof identity !== 'string') return identity;
  const parsed = parseGoodsTransactionSelection(selection);
  if (!isUuid(id) || !isUuid(operationId) || !parsed || parsed.length > 100 || typeof message !== 'string'
    || [...message].length > GIFT_MESSAGE_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) return invalid();
  return mutate('create_my_gift', { p_id: id, p_selection: parsed, p_message: message, p_operation_id: operationId, p_expected_actor_id: identity }, id);
}
export async function issueGiftLinkAction(id: string, revision: number, token: string, operationId: string, expectedActorId: string): Promise<({ gift: GiftDetail; receipt: GiftReceipt; generation: number } | GiftFailure)> {
  const identity = await actor(expectedActorId, false); if (typeof identity !== 'string') return identity;
  const tokenHash = typeof token === 'string' ? giftSecretHash(token) : null;
  if (!isUuid(id) || !isUuid(operationId) || !tokenHash || !Number.isSafeInteger(revision) || revision < 1) return invalid();
  try {
    const client = await createClient(), { data, error } = await client.rpc('issue_my_gift_link', { p_id: id, p_expected_revision: revision, p_token_hash: tokenHash, p_operation_id: operationId, p_expected_actor_id: identity });
    if (error) return giftError(error);
    const outcome = parseGiftOutcome(data && { gift: data.gift, receipt: data.receipt });
    if (!outcome || outcome.gift.id !== id || outcome.gift.party !== 'sender' || outcome.receipt.operationId !== operationId || outcome.receipt.kind !== 'link_issued'
      || !Number.isSafeInteger(data.generation) || data.generation < 1) return giftError();
    const [gift] = await maskRandomGiftOptions([outcome.gift], client);
    revalidatePath('/gifts'); return { ...outcome, gift, generation: data.generation };
  } catch (error) { unstable_rethrow(error); return giftError(); }
}
export async function respondGiftAction(id: string, revision: number, accept: boolean, inputAddress: unknown, operationId: string, expectedActorId: string): Promise<GiftResult> {
  const identity = await actor(expectedActorId, false); if (typeof identity !== 'string') return identity;
  if (!isUuid(id) || !isUuid(operationId) || !Number.isSafeInteger(revision) || revision < 1 || typeof accept !== 'boolean') return invalid();
  const address = accept ? normalizeCheckoutAddress(inputAddress) : null;
  if (accept && !address || !accept && inputAddress !== null) return invalid();
  const sessionHash = await giftClaimSessionHash(); if (!sessionHash) return { error: '선물 링크를 다시 열어주세요.' };
  return mutate('respond_to_gift', { p_id: id, p_session_hash: sessionHash, p_accept: accept, p_address: address, p_expected_revision: revision, p_operation_id: operationId, p_expected_actor_id: identity }, id);
}
export async function updateGiftAddressAction(id: string, revision: number, inputAddress: unknown, operationId: string, expectedActorId: string): Promise<GiftResult> {
  const identity = await actor(expectedActorId, false); if (typeof identity !== 'string') return identity;
  const address = normalizeCheckoutAddress(inputAddress);
  if (!isUuid(id) || !isUuid(operationId) || !address || !Number.isSafeInteger(revision) || revision < 1) return invalid();
  return mutate('update_my_gift_address', { p_id: id, p_address: address, p_expected_revision: revision, p_operation_id: operationId, p_expected_actor_id: identity }, id);
}
export async function closeGiftAction(id: string, revision: number, operationId: string, expectedActorId: string): Promise<GiftResult> {
  const identity = await actor(expectedActorId, false); if (typeof identity !== 'string') return identity;
  if (!isUuid(id) || !isUuid(operationId) || !Number.isSafeInteger(revision) || revision < 1) return invalid();
  return mutate('close_my_gift', { p_id: id, p_expected_revision: revision, p_operation_id: operationId, p_expected_actor_id: identity }, id);
}
export async function reloadGiftAction(id: string, expectedActorId: string): Promise<GiftResult> {
  const identity = await actor(expectedActorId, false); if (typeof identity !== 'string') return identity;
  if (!isUuid(id)) return invalid();
  try { const gift = await loadGift(id); return gift ? { gift } : { error: '이 선물을 확인할 수 없습니다.' }; }
  catch (error) { unstable_rethrow(error); return { error: '최신 선물 상태를 불러오지 못했습니다. 입력은 유지됩니다.' }; }
}
export async function quoteGiftAction(id: string, revision: number, userCouponId: string | null, storeCreditAmount: number, expectedActorId: string): Promise<{ quote: GoodsTransactionQuote } | GiftFailure> {
  const identity = await actor(expectedActorId); if (typeof identity !== 'string') return identity;
  if (!isUuid(id) || !Number.isSafeInteger(revision) || revision < 1 || userCouponId !== null && !isUuid(userCouponId)
    || !Number.isSafeInteger(storeCreditAmount) || storeCreditAmount < 0) return invalid();
  try {
    const client = await createClient(), { data, error } = await client.rpc('quote_my_gift', { p_id: id, p_expected_revision: revision, p_user_coupon_id: userCouponId, p_store_credit_amount: storeCreditAmount, p_expected_actor_id: identity });
    if (error) return { ...giftError(error), uncertain: false };
    const quote = parseGoodsTransactionQuote(data); return quote ? { quote } : { error: '선물 금액을 확인하지 못했습니다. 다시 확인해주세요.' };
  } catch (error) { unstable_rethrow(error); return { error: '선물 금액을 확인하지 못했습니다. 다시 확인해주세요.' }; }
}
export async function placeGiftAction(id: string, quoteId: string, checkoutKey: string, methodValue: string, expectedActorId: string): Promise<{ orderId: string } | GiftFailure> {
  const identity = await actor(expectedActorId, false); if (typeof identity !== 'string') return identity;
  const method = normalizeCheckoutPaymentMethod(methodValue);
  if (!isUuid(id) || !isUuid(quoteId) || !isUuid(checkoutKey) || !method) return invalid();
  try {
    const client = await createClient();
    const args = { p_id: id, p_quote_id: quoteId, p_checkout_key: checkoutKey, p_payment_method: method, p_expected_actor_id: identity };
    const replay = await client.rpc('replay_my_gift_order', args);
    if (replay.error) return giftError(replay.error);
    if (replay.data !== null) return typeof replay.data === 'string' && isUuid(replay.data) ? { orderId: replay.data } : giftError();
    const qualified = await actor(expectedActorId); if (typeof qualified !== 'string') return qualified;
    const available = method === 'bank_transfer' ? await bankTransferCheckoutEnabled() : goodsCheckoutPaymentsEnabled(identity);
    if (!available) return { error: '현재 선택한 결제수단을 사용할 수 없습니다.' };
    const { data, error } = await client.rpc('place_my_gift', { p_id: id, p_quote_id: quoteId, p_checkout_key: checkoutKey, p_payment_method: method, p_expected_actor_id: identity });
    if (error) return giftError(error);
    if (typeof data !== 'string' || !isUuid(data)) return giftError();
    revalidatePath('/gifts'); return { orderId: data };
  } catch (error) { unstable_rethrow(error); return giftError(); }
}
