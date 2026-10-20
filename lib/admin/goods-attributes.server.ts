import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsAttributeDocument, parseGoodsAttributeSchema, type GoodsAttributeDocument, type GoodsAttributeSchema } from '@/lib/goods-attributes';
export type GoodsAttributeWorkspace = { schema: GoodsAttributeSchema | null; document: GoodsAttributeDocument };
export async function loadGoodsAttributeWorkspace(categoryId: string | null, goodId: string | null = null): Promise<GoodsAttributeWorkspace> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_get_goods_attributes', { p_category_id: categoryId, p_good_id: goodId });
  const document = parseGoodsAttributeDocument(data?.document);
  const schema = data?.schema === null ? null : parseGoodsAttributeSchema(data?.schema);
  if (error || !document || (categoryId ? !schema || schema.categoryId !== categoryId : data?.schema !== null)) throw new Error('상품속성 정의와 저장값을 불러오지 못했습니다.');
  return { schema, document };
}
