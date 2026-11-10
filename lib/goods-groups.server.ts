import 'server-only';
import { createClient } from './supabase/server';
import { parsePublicGoodsGroup } from './goods-groups';

export async function loadPublicGoodsGroupReference(goodId: string) {
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('get_good_group', { p_good_id: goodId });
    return error || data === null ? null : parsePublicGoodsGroup(data, goodId);
  } catch { return null; }
}
