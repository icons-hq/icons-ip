import 'server-only';
import { createClient } from '../supabase/server';
import { parseAdminSubscriptionData, parseAdminSubscriptionDetail, type AdminSubscriptionFilters } from './subscriptions';
export async function loadAdminSubscriptions(actorId: string, filters: AdminSubscriptionFilters) {
  const client = await createClient(), { data, error } = await client.rpc('admin_list_goods_subscriptions', { p_expected_actor_id: actorId,
    p_state: filters.state, p_search: filters.query, p_page: filters.page, p_page_size: 50 });
  const result = error ? null : parseAdminSubscriptionData(data, filters); if (!result) throw new Error('정기구매 목록을 불러오지 못했습니다.'); return result;
}
export async function loadAdminSubscription(actorId: string, planId: string, beforeNumber?: number) {
  const client = await createClient(), { data, error } = await client.rpc('admin_get_goods_subscription', { p_expected_actor_id: actorId,
    p_plan_id: planId, p_before_number: beforeNumber ?? null });
  const result = error ? null : parseAdminSubscriptionDetail(data); if (!result || result.subscription.id !== planId) throw new Error('정기구매 내역을 불러오지 못했습니다.'); return result;
}
