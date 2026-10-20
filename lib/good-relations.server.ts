import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseGoodRelationReferences, type GoodRelationReferences } from './good-relations';

export async function loadGoodRelationReferences(goodId: string): Promise<GoodRelationReferences> {
  try {
    const client = await createClient(); const { data, error } = await client.rpc('get_good_relation_compositions', { p_good_id: goodId });
    const parsed = parseGoodRelationReferences(data);
    if (error || !parsed) throw new Error('invalid related goods');
    return parsed;
  } catch { return { groups: [], nextChangeAt: null, unavailable: true }; }
}
