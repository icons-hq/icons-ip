import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseReviewEvent, parseReviewEventWorkspace, type ReviewEventFilters, type ReviewEventList, type ReviewEventWorkspace } from '@/lib/review-events';

export async function loadAdminReviewEvents(filters: ReviewEventFilters): Promise<ReviewEventList> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_list_review_events', { p_query: filters.query, p_state: filters.state, p_date_field: filters.dateField,
    p_from: filters.from || null, p_to: filters.to || null, p_page: filters.page, p_page_size: filters.pageSize });
  if (error || !data || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.rows) || data.rows.length > filters.pageSize
    || data.rows.some((row: unknown) => !parseReviewEvent(row))) throw new Error('리뷰이벤트 목록을 불러오지 못했습니다.');
  const lastPage = Math.max(1, Math.ceil(data.total / filters.pageSize));
  if (filters.page > lastPage) return loadAdminReviewEvents({ ...filters, page: lastPage });
  return { total: data.total, rows: data.rows, filters };
}
export async function loadAdminReviewEvent(id: string, page = 1, query = '', filter = 'all'): Promise<ReviewEventWorkspace | null> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_get_review_event', { p_id: id, p_page: page, p_query: query, p_filter: filter });
  if (error) throw new Error('리뷰이벤트를 불러오지 못했습니다.');
  if (data === null) return null;
  const workspace = parseReviewEventWorkspace(data);
  if (!workspace) throw new Error('리뷰이벤트 응답을 확인하지 못했습니다.');
  const lastPage = Math.max(1, Math.ceil(workspace.total / 50));
  if (page > lastPage) return loadAdminReviewEvent(id, lastPage, query, filter);
  const paths = [...new Set(workspace.rows.flatMap(row => row.imagePaths))];
  const urls = new Map(await Promise.all(paths.map(async path => {
    const { data, error } = await client.storage.from('user-uploads').createSignedUrl(path, 3600);
    return [path, error ? null : data?.signedUrl ?? null] as const;
  })));
  return { ...workspace, rows: workspace.rows.map(row => ({ ...row, imageUrls: row.imagePaths.flatMap(path => urls.get(path) ? [urls.get(path)!] : []) })) };
}
