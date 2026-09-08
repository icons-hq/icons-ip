import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { AdminGoodsVariant } from './goods-variants';

export async function loadAdminGoodsVariants(): Promise<AdminGoodsVariant[]> {
  const supabase = await createClient();
  const variants: AdminGoodsVariant[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('goods_variants')
      .select('id,good_id,name,price,stock_qty,is_default,archived_at')
      .order('good_id').order('sort_order').order('id').range(offset, offset + pageSize - 1);
    if (error) throw new Error('옵션 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    variants.push(...(data ?? []).map((row) => ({
      id: row.id, goodId: row.good_id, name: row.name, price: row.price,
      stockQty: row.stock_qty, isDefault: row.is_default, archivedAt: row.archived_at,
    })));
    if (!data || data.length < pageSize) return variants;
  }
}
