import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseStoreCreditConsoleData, type StoreCreditConsoleFilters } from './store-credit-console';
export async function getStoreCreditConsole(filters: StoreCreditConsoleFilters) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_search_store_credit_console', { p_mode: filters.mode, p_query: filters.query, p_from: filters.from || null, p_to: filters.to || null, p_kind: filters.kind, p_page: filters.page, p_page_size: filters.pageSize });
  const parsed = error ? null : parseStoreCreditConsoleData(data,filters);
  if (!parsed) throw new Error('적립금 운영 내역을 불러오지 못했습니다.');
  return parsed;
}
