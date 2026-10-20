import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseOperatorDirectory, type OperatorFilters, type OperatorDirectoryData } from './operator-directory';

export async function loadOperatorDirectory(filters: OperatorFilters): Promise<OperatorDirectoryData> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_search_operators', {
    p_query: filters.query, p_role: filters.role, p_status: filters.status, p_page: filters.page, p_page_size: filters.pageSize,
  });
  const result = parseOperatorDirectory(data, filters);
  if (error || !result) throw new Error('운영자 목록을 불러오지 못했습니다. 잠시 후 다시 조회해주세요.');
  if (!result.rows.length && filters.page > 1 && result.total > 0) return loadOperatorDirectory({ ...filters, page: Math.ceil(result.total / filters.pageSize) });
  return result;
}
