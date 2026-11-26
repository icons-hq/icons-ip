import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadGoodsFulfillmentOptions } from './fulfillment-origins.server';
import type { GoodsExportFilterNames } from './goods-export-summary';
import type { GoodsListFilters } from './goods-list';

/**
 * 엑셀 내보내기 화면이 걸린 조건을 이름으로 되읽는 데 쓰는 IP·카테고리·출고지 이름.
 * 조건에 걸리지 않은 것은 읽지 않는다. 이름은 되읽기용일 뿐이라 못 읽으면 그 이름만 비우고 내려받기는 막지 않는다.
 */
export async function loadGoodsExportNames(filters: GoodsListFilters): Promise<GoodsExportFilterNames> {
  const attempt = async <T>(read: () => Promise<T | null>): Promise<T | null> => {
    try { return await read(); } catch (error) { unstable_rethrow(error); return null; }
  };
  const [ip, category, origin] = await Promise.all([
    filters.ipId ? attempt(async () => {
      const { data } = await (await createClient()).from('ips').select('title').eq('id', filters.ipId).maybeSingle();
      return typeof data?.title === 'string' ? data.title : null;
    }) : null,
    filters.categoryId ? attempt(async () => {
      const { data } = await (await createClient()).from('catalog_categories').select('name').eq('id', filters.categoryId).maybeSingle();
      return typeof data?.name === 'string' ? data.name : null;
    }) : null,
    filters.originId ? attempt(async () => (await loadGoodsFulfillmentOptions()).find((option) => option.id === filters.originId)?.name ?? null) : null,
  ]);
  return { ip, category, origin };
}
