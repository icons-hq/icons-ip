import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsSizeChart, type GoodsSizeChart } from './goods-size-chart';

export async function loadPublicGoodsSizeChart(goodId: string): Promise<GoodsSizeChart | null> {
  try {
    const client = await createClient(), { data, error } = await client.rpc('get_good_size_chart', { p_good_id: goodId });
    return error ? null : parseGoodsSizeChart(data);
  } catch { return null; }
}
