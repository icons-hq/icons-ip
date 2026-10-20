import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsBenefitValues, type GoodsBenefitValues } from './goods-benefits';

export async function loadPublicGoodsBenefits(goodId: string): Promise<GoodsBenefitValues | null> {
  try {
    const client = await createClient(), { data, error } = await client.rpc('get_good_benefit_content', { p_good_id: goodId });
    return error ? null : parseGoodsBenefitValues(data);
  } catch { return null; }
}
