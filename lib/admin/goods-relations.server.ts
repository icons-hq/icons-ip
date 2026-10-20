import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isObject, parseGoodsRelation, parseRelationGoods, type GoodsRelation, type GoodsRelationCandidates, type GoodsRelationFilters, type GoodsRelationList } from './goods-relations';

export async function loadGoodsRelation(id: string): Promise<GoodsRelation | null> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_get_goods_relation', { p_id: id });
  if (error) throw new Error('연관상품 편성을 불러오지 못했습니다. 다시 시도해주세요.');
  if (data === null) return null;
  const parsed = parseGoodsRelation(data);
  if (!parsed) throw new Error('연관상품 응답을 확인하지 못했습니다.');
  return parsed;
}
export async function loadGoodsRelations(filters: GoodsRelationFilters): Promise<GoodsRelationList> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_list_goods_relations', {
    p_query: filters.query, p_kind: filters.kind, p_state: filters.state, p_page: filters.page, p_page_size: filters.pageSize,
  });
  if (error || !isObject(data) || !Array.isArray(data.rows) || !Number.isSafeInteger(data.total) || Number(data.total) < 0) throw new Error('연관상품 목록을 불러오지 못했습니다.');
  const rows = data.rows.map(parseGoodsRelation);
  if (rows.some(row => row === null)) throw new Error('연관상품 목록 응답을 확인하지 못했습니다.');
  const lastPage = Math.max(1, Math.ceil(Number(data.total) / filters.pageSize));
  if (filters.page > lastPage) return loadGoodsRelations({ ...filters, page: lastPage });
  return { rows: rows as GoodsRelation[], total: Number(data.total), filters };
}
export async function searchGoodsForRelation(query: string, page: number): Promise<GoodsRelationCandidates> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_search_goods_for_relation', { p_query: query, p_page: page });
  const rows = isObject(data) ? parseRelationGoods(data.rows) : null;
  if (error || !isObject(data) || !rows || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || !Number.isSafeInteger(data.page) || Number(data.page) < 1 || data.pageSize !== 20) throw new Error('상품 검색 결과를 불러오지 못했습니다.');
  return { rows, total: Number(data.total), page: Number(data.page), pageSize: 20 };
}
