import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isCount, isInstant, isRecord, parseCustomerSegment, parseSegmentOptions, SEGMENT_GROUPS, type CustomerSegment, type SegmentDetail, type SegmentFilters, type SegmentList, type SegmentObservation, type SegmentOptionKind, type SegmentOptions, type SegmentOverview } from './customer-segments';
const LOAD_ERROR = '타겟 세그먼트를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
export async function loadCustomerSegments(filters: SegmentFilters): Promise<SegmentList> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_list_customer_segments', { p_query: filters.query, p_group: filters.group, p_target: filters.target, p_kind: filters.kind, p_favorite_only: filters.favoriteOnly, p_page: filters.page, p_page_size: filters.pageSize });
  if (error || !isRecord(data) || !isCount(data.total) || !Array.isArray(data.rows) || !Array.isArray(data.favorites) || data.favorites.length > 3 || data.page !== filters.page || data.pageSize !== filters.pageSize) throw new Error(LOAD_ERROR);
  const rows = data.rows.map(parseCustomerSegment), favorites = data.favorites.map(parseCustomerSegment);
  if (rows.some(r => !r) || favorites.some(r => !r) || new Set(rows.map(r => r?.id)).size !== rows.length || new Set(favorites.map(r => r?.id)).size !== favorites.length) throw new Error(LOAD_ERROR);
  const lastPage = Math.max(1, Math.ceil(data.total / filters.pageSize)); if (filters.page > lastPage) return loadCustomerSegments({ ...filters, page: lastPage });
  return { rows: rows as CustomerSegment[], favorites: favorites as CustomerSegment[], total: data.total, filters };
}
export async function loadCustomerSegmentOverview(): Promise<SegmentOverview> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_customer_segment_overview');
  if (error || !isRecord(data) || !isRecord(data.groups)) throw new Error(LOAD_ERROR);
  const groups = data.groups;
  if (!isInstant(data.checkedAt) || !isCount(data.firstPurchaseMembers) || !isCount(data.memberCount)
    || SEGMENT_GROUPS.some(g => groups[g] !== null && !isCount(groups[g]))) throw new Error(LOAD_ERROR);
  return data as unknown as SegmentOverview;
}
export async function loadCustomerSegment(id: string): Promise<SegmentDetail | null> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_get_customer_segment', { p_id: id });
  if (error) throw new Error(LOAD_ERROR); if (data === null) return null; if (!isRecord(data)) throw new Error(LOAD_ERROR);
  const segment = parseCustomerSegment(data.segment), selectedOptions = parseSegmentOptions(data.selectedOptions);
  if (!segment || !selectedOptions || !Array.isArray(data.history) || data.history.length !== 13) throw new Error(LOAD_ERROR);
  for (const month of data.history) if (!isRecord(month) || typeof month.month !== 'string' || !/^\d{4}-\d{2}$/.test(month.month)
    || (month.evaluatedAt === null ? month.matchedCount !== null || month.consentedCount !== null : !isInstant(month.evaluatedAt) || !isCount(month.matchedCount) || !isCount(month.consentedCount) || month.consentedCount > month.matchedCount)) throw new Error(LOAD_ERROR);
  if (new Set(data.history.map(m => m.month)).size !== 13 || data.history.some((m,i,all) => i > 0 && m.month <= all[i-1].month)) throw new Error(LOAD_ERROR);
  return { segment, selectedOptions, history: data.history as SegmentObservation[] };
}
export async function loadCustomerSegmentOptions(kind: SegmentOptionKind, query: string, page: number): Promise<SegmentOptions> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_customer_segment_options', { p_kind: kind, p_query: query, p_page: page });
  const rows = isRecord(data) ? parseSegmentOptions(data.rows) : null;
  if (error || !isRecord(data) || !rows || rows.some(r => r.kind !== kind) || rows.length > 20 || !isCount(data.total) || data.page !== page || data.pageSize !== 20) throw new Error(LOAD_ERROR);
  return { rows, total: data.total, page, pageSize: 20 };
}
