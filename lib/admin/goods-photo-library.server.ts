import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsPhotoPage } from './goods-photo-library';

export async function loadGoodsPhotos(query = '', archived = false, page = 1) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_list_goods_photos', { p_query: query, p_archived: archived, p_page: page });
  const result = parseGoodsPhotoPage(data);
  if (error || !result) throw new Error('사진 보관함을 불러오지 못했습니다. 다시 조회해주세요.');
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (page > lastPage) return loadGoodsPhotos(query, archived, lastPage);
  return result;
}
