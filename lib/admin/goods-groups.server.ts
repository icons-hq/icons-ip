import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { GOODS_GROUP_PAGE_SIZE, parseGoodsGroupPage, parseGoodsGroupSnapshot, parseGoodsGroupSource,
  type GoodsGroupCandidates, type GoodsGroupPage, type GoodsGroupSnapshot, type GoodsGroupSource } from './goods-groups';

export async function loadGoodsGroups(query = '', page = 1): Promise<GoodsGroupPage> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_search_goods_groups', { p_query: query, p_page: page, p_page_size: GOODS_GROUP_PAGE_SIZE });
  const result = error ? null : parseGoodsGroupPage(data);
  if (!result || result.page !== page || result.pageSize !== GOODS_GROUP_PAGE_SIZE) throw new Error('그룹상품 목록을 불러오지 못했습니다.');
  return result;
}
export async function loadGoodsGroup(groupId: string): Promise<GoodsGroupSnapshot | null> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_get_goods_group', { p_group_id: groupId });
  if (error) throw new Error('그룹상품을 불러오지 못했습니다.');
  if (data === null) return null;
  const result = parseGoodsGroupSnapshot(data);
  if (!result || result.id !== groupId) throw new Error('그룹상품의 저장 상태를 확인하지 못했습니다.');
  return result;
}
export async function loadGoodsGroupSource(goodId: string): Promise<GoodsGroupSource | null> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_get_goods_group_source', { p_good_id: goodId });
  if (error) throw new Error('상품과 옵션을 불러오지 못했습니다.');
  if (data === null) return null;
  const result = parseGoodsGroupSource(data);
  if (!result || result.goodId !== goodId) throw new Error('상품과 옵션의 현재 상태를 확인하지 못했습니다.');
  return result;
}
/** Existing catalog search owns escaping and row visibility. Project only picker fields. */
export async function searchGoodsGroupCandidates(query: string, page: number): Promise<GoodsGroupCandidates> {
  const client = await createClient();
  const { data, error, count } = await client.rpc('admin_search_goods', { search_text: query }, { count: 'exact' })
    .select('id,code,name,archived_at').is('archived_at', null).order('code').order('id').range((page - 1) * 20, page * 20 - 1);
  if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || Number(count) < data.length
    || data.some(row => typeof row.id !== 'string' || typeof row.name !== 'string' || row.code !== null && typeof row.code !== 'string' || row.archived_at !== null)) throw new Error('상품 검색 결과를 불러오지 못했습니다.');
  return { rows: data.map(row => ({ id: row.id, code: row.code, name: row.name })), total: count!, page, pageSize: 20 };
}
