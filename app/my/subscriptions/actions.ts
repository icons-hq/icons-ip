'use server';

import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { normalizeCheckoutAddress, type CheckoutAddress } from '@/lib/checkout';
import { parseGoodsTransactionSelection, type GoodsTransactionSelection } from '@/lib/goods-transaction';
import { parseSubscriptionSchedule, type SubscriptionSchedule } from '@/lib/subscriptions/schedule';
import { parseGoodsSubscription, parseSubscriptionProposal, subscriptionError, type GoodsSubscription, type SubscriptionChangeCommand,
  type SubscriptionProposal, type SubscriptionResult } from '@/lib/subscriptions/customer';
import { loadMyGoodsSubscription } from '@/lib/subscriptions/customer.server';
import { runtimeGoodsSubscriptionWorker } from '@/lib/subscriptions/worker.server';
import { revokeBillingCredential } from '@/lib/subscriptions/credential-revocation.server';

type Client = Awaited<ReturnType<typeof createClient>>;
type Context = { expectedActorId: string; operationId: string };
const invalid = <T,>(): SubscriptionResult<T> => ({ ok: false, error: '계정과 신청 내용을 다시 확인해주세요.' });
const uncertain = <T,>(): SubscriptionResult<T> => ({ ok: false, uncertain: true, error: '처리 결과가 불명확합니다. 입력을 바꾸지 말고 같은 요청으로 다시 확인해주세요.' });
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function validContext(value: Context) { return value && isUuid(value.expectedActorId) && isUuid(value.operationId); }
async function sameActor(client: Client, actor: string) { const { data, error } = await client.auth.getUser(); return !error && data.user?.id === actor; }
function rpcFailure<T>(error: { code?: string; message?: string }): SubscriptionResult<T> {
  return { ok: false, uncertain: !['22023', '42501', '28000', '23514', '23503', 'P0002', 'PT409', '23505', '55000'].includes(error.code ?? ''), error: subscriptionError(error.code, error.message) };
}
function validChoices(value: unknown) { return record(value) && Object.entries(value).length <= 100 && Object.entries(value).every(([key, mode]) => key.length <= 200 && ['prepaid', 'collect'].includes(mode as string)); }

export async function prepareGoodsSubscriptionAction(input: Context & { selection: GoodsTransactionSelection[]; address: CheckoutAddress; schedule: SubscriptionSchedule;
  deliveryChoices: Record<string, 'prepaid' | 'collect'>; userCouponId: string | null; storeCreditAmount: number }): Promise<SubscriptionResult<GoodsSubscription>> {
  const selection = parseGoodsTransactionSelection(input?.selection), address = normalizeCheckoutAddress(input?.address), schedule = parseSubscriptionSchedule(input?.schedule);
  if (!validContext(input) || !selection || selection.length > 100 || !address || !schedule || !validChoices(input.deliveryChoices)
    || input.userCouponId !== null && !isUuid(input.userCouponId) || !Number.isSafeInteger(input.storeCreditAmount) || input.storeCreditAmount < 0) return invalid();
  try {
    const client = await createClient(); if (!await sameActor(client, input.expectedActorId)) return invalid();
    const { data, error } = await client.rpc('prepare_my_goods_subscription', { p_expected_actor_id: input.expectedActorId, p_operation_id: input.operationId,
      p_selection: selection, p_address: address, p_schedule: schedule, p_delivery_choices: input.deliveryChoices, p_user_coupon_id: input.userCouponId, p_store_credit_amount: input.storeCreditAmount });
    if (error) return rpcFailure(error);
    if (record(data) && data.state === 'blocked') return { ok: false, error: '굿즈·수량·배송 방법 또는 할인 조건을 확인할 수 없습니다. 굿즈와 입력을 다시 확인해주세요.' };
    const plan = record(data) ? parseGoodsSubscription(data.subscription) : null;
    if (!plan || plan.firstCycleId !== input.operationId || !await sameActor(client, input.expectedActorId)) return uncertain();
    return { ok: true, value: plan };
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function readGoodsSubscriptionAction(expectedActorId: string, planId: string): Promise<SubscriptionResult<GoodsSubscription>> {
  if (!isUuid(expectedActorId) || !isUuid(planId)) return invalid();
  try {
    const client = await createClient(); if (!await sameActor(client, expectedActorId)) return invalid();
    const plan = await loadMyGoodsSubscription(expectedActorId, planId); if (!await sameActor(client, expectedActorId)) return invalid();
    return { ok: true, value: plan };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '현재 신청 내역을 읽지 못했습니다. 다시 확인해주세요.' }; }
}
export async function confirmGoodsSubscriptionAction(input: Context & { planId: string; cycleId: string; expectedRevision: number; quoteId: string;
  termsId: string; credentialId: string; consent: boolean }): Promise<SubscriptionResult<GoodsSubscription>> {
  if (!validContext(input) || ![input.planId, input.cycleId, input.quoteId, input.termsId, input.credentialId].every(isUuid)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.consent !== true) return invalid();
  let committed = false;
  try {
    const client = await createClient(); if (!await sameActor(client, input.expectedActorId)) return invalid();
    const { data, error } = await client.rpc('confirm_my_goods_subscription', { p_expected_actor_id: input.expectedActorId, p_plan_id: input.planId,
      p_cycle_id: input.cycleId, p_expected_revision: input.expectedRevision, p_quote_id: input.quoteId, p_terms_id: input.termsId,
      p_credential_id: input.credentialId, p_operation_id: input.operationId, p_consent: input.consent });
    if (error) return rpcFailure(error);
    if (!record(data) || data.operationId !== input.operationId || data.planId !== input.planId || data.cycleId !== input.cycleId || !isUuid(data.orderId)) return uncertain();
    committed = true;
    // A confirmed UUID selects one DB-owned cycle; no browser amount or provider key is forwarded.
    await runtimeGoodsSubscriptionWorker().run(input.cycleId).catch(() => undefined);
    const current = await readGoodsSubscriptionAction(input.expectedActorId, input.planId);
    if (!current.ok) return { ...current, committed: true };
    revalidatePath('/my/subscriptions'); revalidatePath(`/my/subscriptions/${input.planId}`);
    return current;
  } catch (error) { unstable_rethrow(error); return committed ? { ok: false, committed: true, error: '신청은 저장됐습니다. 현재 결제 결과를 다시 확인해주세요.' } : uncertain(); }
}
export async function changeGoodsSubscriptionStateAction(input: Context & { planId: string; expectedRevision: number; command: 'pause' | 'cancel' }): Promise<SubscriptionResult<GoodsSubscription>> {
  if (!validContext(input) || !isUuid(input.planId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !['pause', 'cancel'].includes(input.command)) return invalid();
  let committed = false;
  try {
    const client = await createClient(); if (!await sameActor(client, input.expectedActorId)) return invalid();
    const { data, error } = await client.rpc('change_my_goods_subscription_state', { p_expected_actor_id: input.expectedActorId, p_plan_id: input.planId,
      p_expected_revision: input.expectedRevision, p_operation_id: input.operationId, p_command: input.command });
    if (error) return rpcFailure(error);
    if (!record(data) || data.operationId !== input.operationId || data.planId !== input.planId) return uncertain(); committed = true;
    const current = await readGoodsSubscriptionAction(input.expectedActorId, input.planId);
    return current.ok ? current : { ...current, committed: true };
  } catch (error) { unstable_rethrow(error); return committed ? { ok: false, committed: true, error: '변경은 저장됐습니다. 최신 내역을 다시 확인해주세요.' } : uncertain(); }
}
export async function prepareGoodsSubscriptionChangeAction(input: Context & { planId: string; expectedRevision: number; command: SubscriptionChangeCommand;
  payload: { schedule: SubscriptionSchedule; address?: CheckoutAddress; deliveryChoices?: Record<string, 'prepaid' | 'collect'> } }): Promise<SubscriptionResult<SubscriptionProposal>> {
  if (!validContext(input) || !isUuid(input.planId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1
    || !['resume', 'change_schedule', 'change_destination', 'replace_card', 'accept_terms'].includes(input.command) || !parseSubscriptionSchedule(input.payload?.schedule)
    || input.command === 'change_destination' && (!normalizeCheckoutAddress(input.payload.address) || !validChoices(input.payload.deliveryChoices))) return invalid();
  try {
    const client = await createClient(); if (!await sameActor(client, input.expectedActorId)) return invalid();
    const { data, error } = await client.rpc('prepare_my_goods_subscription_change', { p_expected_actor_id: input.expectedActorId, p_plan_id: input.planId,
      p_expected_revision: input.expectedRevision, p_operation_id: input.operationId, p_command: input.command, p_payload: input.payload });
    if (error) return rpcFailure(error);
    if (record(data) && data.state === 'blocked') return { ok: false, error: '굿즈 또는 배송 조건을 확인할 수 없습니다. 입력을 다시 확인해주세요.' };
    const proposal = parseSubscriptionProposal(data);
    if (!proposal || proposal.id !== input.operationId || proposal.planId !== input.planId || !await sameActor(client, input.expectedActorId)) return uncertain();
    return { ok: true, value: proposal };
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function confirmGoodsSubscriptionChangeAction(input: Context & { planId: string; expectedRevision: number; proposalId: string; termsId: string; quoteId: string;
  credentialId: string; consent: boolean }): Promise<SubscriptionResult<GoodsSubscription>> {
  if (!validContext(input) || ![input.planId, input.proposalId, input.termsId, input.quoteId, input.credentialId].every(isUuid)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.consent !== true) return invalid();
  let committed = false;
  try {
    const client = await createClient(); if (!await sameActor(client, input.expectedActorId)) return invalid();
    const { data, error } = await client.rpc('confirm_my_goods_subscription_change', { p_expected_actor_id: input.expectedActorId, p_plan_id: input.planId,
      p_expected_revision: input.expectedRevision, p_proposal_id: input.proposalId, p_terms_id: input.termsId, p_quote_id: input.quoteId,
      p_credential_id: input.credentialId, p_operation_id: input.operationId, p_consent: input.consent });
    if (error) return rpcFailure(error);
    if (!record(data) || data.operationId !== input.operationId || data.planId !== input.planId || data.cycleId !== input.proposalId) return uncertain(); committed = true;
    const current = await readGoodsSubscriptionAction(input.expectedActorId, input.planId); return current.ok ? current : { ...current, committed: true };
  } catch (error) { unstable_rethrow(error); return committed ? { ok: false, committed: true, error: '변경은 저장됐습니다. 최신 내역을 다시 확인해주세요.' } : uncertain(); }
}
export async function revokeSubscriptionCardAction(input: Context & { credentialId: string; expectedRevision: number }): Promise<SubscriptionResult<{ state: string }>> {
  if (!validContext(input) || !isUuid(input.credentialId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) return invalid();
  let committed = false;
  try {
    const client = await createClient(); if (!await sameActor(client, input.expectedActorId)) return invalid();
    const { data, error } = await client.rpc('request_my_billing_credential_revocation', { p_expected_actor_id: input.expectedActorId, p_credential_id: input.credentialId,
      p_expected_revision: input.expectedRevision, p_operation_id: input.operationId });
    if (error) return rpcFailure(error);
    if (!record(data) || data.operationId !== input.operationId || data.credentialId !== input.credentialId) return uncertain(); committed = true;
    const current = await revokeBillingCredential(input.expectedActorId, input.credentialId);
    if (!await sameActor(client, input.expectedActorId)) return invalid(); revalidatePath('/my/subscriptions'); return { ok: true, value: current };
  } catch (error) { unstable_rethrow(error); return committed ? { ok: false, committed: true, error: '카드 삭제를 요청했습니다. 완료 여부를 다시 확인해주세요.' } : uncertain(); }
}
