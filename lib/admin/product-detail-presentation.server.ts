import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseDetailSnapshot } from '@/lib/product-detail-presentation';
export async function loadAdminDetailPresentation() {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_get_product_detail_presentation');
  const snapshot = parseDetailSnapshot(data);
  if (error || !snapshot) throw new Error('상품상세 표시 설정을 불러오지 못했습니다.');
  return snapshot;
}
