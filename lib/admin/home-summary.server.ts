import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { normalizeGoodsListFilters } from './goods-list';
import { goodsWorkspaceQuery } from './goods-list.server';
import type { AdminHomeSummary } from './home-summary';

const safeCount = (value: unknown): number | null => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
};

/** Read each summary through the same staff-only query as its destination list. */
export async function loadAdminHomeSummary(): Promise<AdminHomeSummary> {
  const client = await createClient();
  const results = await Promise.allSettled([
    ...(['cancel', 'return', 'exchange'] as const).map((claimType) => client.rpc('admin_order_claim_stage_counts', { p_claim_type: claimType })),
    client.rpc('admin_search_goods_workspace', { ...goodsWorkspaceQuery(normalizeGoodsListFilters({ status: 'published' })), p_limit: 0, p_offset: 0 }),
    client.rpc('admin_search_goods_workspace', { ...goodsWorkspaceQuery(normalizeGoodsListFilters({ stock: 'soldout' })), p_limit: 0, p_offset: 0 }),
    client.rpc('admin_review_console_counts'),
  ]);
  const result = (index: number): unknown => {
    const value = results[index];
    return value.status === 'fulfilled' && !value.value.error ? value.value.data : null;
  };
  const requested = (index: number) => {
    const rows = result(index);
    if (!Array.isArray(rows)) return null;
    const row = rows.find((entry) => entry.stage === 'requested');
    return row ? safeCount(row.total) : 0;
  };
  const goodsCount = (index: number) => safeCount((result(index) as { total?: unknown } | null)?.total);
  const reviews = result(5);
  const review = Array.isArray(reviews) && reviews.length === 1 ? reviews[0] : null;
  return {
    claims: { cancel: requested(0), return: requested(1), exchange: requested(2) },
    goods: { published: goodsCount(3), soldout: goodsCount(4) },
    reviews: { total: safeCount(review?.total_reviews), lowRating: safeCount(review?.low_rating_reviews), awaitingReply: safeCount(review?.awaiting_reply_reviews) },
  };
}
