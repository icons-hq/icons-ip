import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsGroupConsole, type GoodsGroupFilters, type GoodsGroupConsole } from './goods-group-console';

export async function loadGoodsGroupConsole(filters: GoodsGroupFilters): Promise<GoodsGroupConsole> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_search_goods_group_console', { p_filters: filters });
  const result = error ? null : parseGoodsGroupConsole(data);
  if (!result || result.page !== filters.page || result.pageSize !== filters.pageSize) throw new Error('그룹상품 검색 결과를 확인하지 못했습니다.');
  return result;
}
