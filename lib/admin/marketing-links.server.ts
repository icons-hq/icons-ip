import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseMarketingLinkRows, type MarketingLinkFilters, type MarketingLinksData } from './marketing-links';
export async function loadMarketingLinks(filters: MarketingLinkFilters): Promise<MarketingLinksData> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_list_marketing_links', { p_source: filters.source, p_query: filters.query, p_status: filters.status, p_page: filters.page, p_page_size: filters.pageSize });
  const rows = parseMarketingLinkRows(data?.rows);
  if (error || !rows || !Number.isSafeInteger(data?.total) || data.total < 0) throw new Error('마케팅 링크를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  return { filters, rows, total: data.total };
}
