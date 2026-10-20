import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsAfterSalesValues, type GoodsAfterSalesValues } from './goods-after-sales';

export async function loadPublicGoodsAfterSales(goodId: string): Promise<GoodsAfterSalesValues | null> {
  try {
    const client = await createClient(), { data, error } = await client.rpc('get_good_after_sales_content', { p_good_id: goodId });
    return error ? null : parseGoodsAfterSalesValues(data);
  } catch { return null; }
}
