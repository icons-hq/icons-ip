import 'server-only';
import { createClient } from '../supabase/server';
import { createServiceClient } from '../supabase/service';
import { isUuid } from '../uuid';
import { createSubscriptionBillingRuntime, localFakeBillingEnabled } from './runtime.server';
import { parseGoodsSubscription, parseSubscriptionCard, parseSubscriptionOffers, parseSubscriptionPlanPage, parseSubscriptionCyclePage } from './customer';

export async function loadMyGoodsSubscriptions(actorId: string, cursor?: { updatedAt: string; id: string }) {
  const client = await createClient(), { data, error } = await client.rpc('get_my_goods_subscriptions_page', { p_expected_actor_id: actorId,
    p_before_at: cursor?.updatedAt ?? null, p_before_id: cursor?.id ?? null, p_limit: 50 });
  const page = error ? null : parseSubscriptionPlanPage(data); if (!page) throw new Error('subscriptions_read_unavailable'); return page;
}
export async function loadMySubscriptionCycles(actorId: string, planId: string, beforeNumber?: number) {
  const client = await createClient(), { data, error } = await client.rpc('get_my_goods_subscription_cycles', { p_expected_actor_id: actorId,
    p_plan_id: planId, p_before_number: beforeNumber ?? null, p_limit: 50 });
  const page = error ? null : parseSubscriptionCyclePage(data); if (!page) throw new Error('subscription_cycles_unavailable'); return page;
}
export async function loadMyGoodsSubscription(actorId: string, planId: string) {
  const client = await createClient(), { data, error } = await client.rpc('get_my_goods_subscription', { p_expected_actor_id: actorId, p_plan_id: planId });
  const plan = error ? null : parseGoodsSubscription(data); if (!plan || plan.id !== planId || !plan.address || !plan.cycles) throw new Error('subscription_read_unavailable'); return plan;
}
export async function loadMyBillingCards(actorId: string) {
  const client = await createClient(), { data, error } = await client.rpc('get_my_billing_credentials', { p_expected_actor_id: actorId });
  if (error || !Array.isArray(data)) throw new Error('billing_cards_unavailable');
  const cards = data.map(parseSubscriptionCard); if (cards.some(card => card === null)) throw new Error('billing_cards_unavailable'); return cards.filter(card => card !== null);
}
export async function loadSubscriptionOffers(goodIds: readonly string[]) {
  if (!goodIds.length) return [];
  const profileId = localFakeBillingEnabled() ? process.env.BILLING_FAKE_PROFILE_ID : process.env.BILLING_PRIMARY_PROFILE_ID;
  if (!isUuid(profileId) || !createSubscriptionBillingRuntime(createServiceClient(), profileId)) return [];
  const client = await createClient(), batches = [];
  for (let i = 0; i < goodIds.length; i += 100) batches.push(goodIds.slice(i, i + 100));
  const results = await Promise.all(batches.map(async ids => {
    const { data, error } = await client.rpc('get_goods_subscription_offers', { p_good_ids: ids });
    const offers = error ? null : parseSubscriptionOffers(data); if (!offers) throw new Error('subscription_offers_unavailable'); return offers;
  }));
  return results.flat();
}
