import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { isUuid } from '@/lib/uuid';
import { parsePublicReviewEvent, type PublicReviewEventList, type PublicReviewEventDetail, type GoodsReviewEvents, type ReviewEventDisclosure, type MyReviewEventEntry } from '@/lib/review-events';

const instant = (value: unknown) => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
export async function loadPublicReviewEvents(page = 1): Promise<PublicReviewEventList> {
  if (!getSupabaseConfig().isConfigured) return { total: 0, rows: [], nextChangeAt: null };
  try {
    const { data, error } = await (await createClient()).rpc('get_review_events', { p_page: page });
    if (error || !data || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.rows) || data.rows.length > 20
      || data.rows.some((row: unknown) => !parsePublicReviewEvent(row)) || !instant(data.nextChangeAt)) throw new Error('Invalid review events');
    return data as PublicReviewEventList;
  } catch { return { total: 0, rows: [], nextChangeAt: null, unavailable: true }; }
}
export async function loadPublicReviewEvent(id: string, page = 1): Promise<PublicReviewEventDetail | null> {
  if (!getSupabaseConfig().isConfigured) return null;
  const { data, error } = await (await createClient()).rpc('get_review_event', { p_id: id, p_winner_page: page });
  if (error) throw new Error('리뷰이벤트를 불러오지 못했습니다.');
  if (data === null) return null;
  if (!parsePublicReviewEvent(data.event) || !Number.isSafeInteger(data.winnerTotal) || data.winnerTotal < 0 || data.winnerPage !== page || !Array.isArray(data.winners) || data.winners.length > 50
    || data.winners.some((row: Record<string, unknown>) => !row || !isUuid(row.reviewId) || typeof row.goodId !== 'string' || typeof row.goodName !== 'string' || typeof row.nickname !== 'string' || typeof row.body !== 'string')) throw new Error('리뷰이벤트 응답을 확인하지 못했습니다.');
  return data as PublicReviewEventDetail;
}
export async function loadGoodsReviewEvents(goodIds: readonly string[]): Promise<GoodsReviewEvents> {
  const ids = [...new Set(goodIds)];
  if (!ids.length || !getSupabaseConfig().isConfigured) return { rows: [], nextChangeAt: null };
  if (ids.length > 500) {
    const chunks = Array.from({ length: Math.ceil(ids.length / 500) }, (_, index) => ids.slice(index * 500, (index + 1) * 500));
    const results = await Promise.all(chunks.map(loadGoodsReviewEvents));
    return { rows: results.flatMap(result => result.rows), nextChangeAt: results.flatMap(result => result.nextChangeAt ? [result.nextChangeAt] : []).sort()[0] ?? null, ...(results.some(result => result.unavailable) ? { unavailable: true } : {}) };
  }
  try {
    const { data, error } = await (await createClient()).rpc('get_goods_review_events', { p_good_ids: ids });
    if (error || !data || !Array.isArray(data.rows) || !instant(data.nextChangeAt) || data.rows.some((row: Record<string, unknown>) => !row || typeof row.goodId !== 'string' || !ids.includes(row.goodId) || !parsePublicReviewEvent(row.event))) throw new Error('Invalid review event banners');
    return data as GoodsReviewEvents;
  } catch { return { rows: [], nextChangeAt: null, unavailable: true }; }
}
export async function loadReviewEventDisclosures(reviewIds: readonly string[]): Promise<Map<string, ReviewEventDisclosure>> {
  const ids = [...new Set(reviewIds)];
  if (!ids.length || !getSupabaseConfig().isConfigured) return new Map();
  try {
    const { data, error } = await (await createClient()).rpc('get_review_event_disclosures', { p_review_ids: ids });
    if (error || !Array.isArray(data) || data.some(row => !row || !isUuid(row.reviewId) || !ids.includes(row.reviewId) || typeof row.eventTitle !== 'string' || typeof row.revoked !== 'boolean')) throw new Error('Invalid reward disclosures');
    return new Map(data.map(row => [row.reviewId, { eventTitle: row.eventTitle, revoked: row.revoked }]));
  } catch { return new Map(ids.map(id => [id, { eventTitle: '', revoked: false, unavailable: true }])); }
}
export async function loadMyReviewEventEntries(reviewIds: readonly string[]): Promise<{ entries: MyReviewEventEntry[]; unavailable?: boolean }> {
  const ids = [...new Set(reviewIds)];
  if (!ids.length || !getSupabaseConfig().isConfigured) return { entries: [] };
  if (ids.length > 500) {
    const chunks = Array.from({ length: Math.ceil(ids.length / 500) }, (_, index) => ids.slice(index * 500, (index + 1) * 500));
    const results = await Promise.all(chunks.map(loadMyReviewEventEntries));
    return { entries: results.flatMap(result => result.entries), ...(results.some(result => result.unavailable) ? { unavailable: true } : {}) };
  }
  try {
    const { data, error } = await (await createClient()).rpc('get_my_review_event_entries', { p_review_ids: ids });
    if (error || !Array.isArray(data) || data.some(row => !row || !isUuid(row.reviewId) || !ids.includes(row.reviewId) || !isUuid(row.eventId) || typeof row.title !== 'string'
      || !Number.isSafeInteger(row.creditAmount) || row.creditAmount <= 0 || !['scheduled', 'active', 'closed', 'ready', 'announced', 'archived'].includes(row.state)
      || typeof row.announcesOn !== 'string' || ![row.grantedAt, row.revokedAt, row.expiresAt].every(instant) || row.revokeReason !== null && typeof row.revokeReason !== 'string')) throw new Error('Invalid my event entries');
    return { entries: data as MyReviewEventEntry[] };
  } catch { return { entries: [], unavailable: true }; }
}
