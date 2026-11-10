import 'server-only';
import { createClient } from '../supabase/server';
import { parseAdminGiftData, type AdminGiftFilters } from './gifts';

export async function loadAdminGifts(actorId: string, filters: AdminGiftFilters) {
  const client = await createClient(), { data, error } = await client.rpc('admin_list_gifts', { p_expected_actor_id: actorId,
    p_state: filters.state, p_search: filters.query, p_page: filters.page, p_page_size: filters.pageSize });
  const result = error ? null : parseAdminGiftData(data, filters);
  if (!result) throw new Error('선물 목록을 불러오지 못했습니다.');
  return result;
}
