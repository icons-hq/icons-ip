import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { getCatalogGoodsByIds } from '@/lib/catalog';
import { parseGoodOtherCompositionReferences, resolveGoodOtherCompositions, type PublicGoodOtherCompositions } from './good-other-compositions';

export async function loadGoodOtherCompositions(goodId: string): Promise<PublicGoodOtherCompositions> {
  if (!getSupabaseConfig().isConfigured) return { groups: [], nextChangeAt: null };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('get_good_other_compositions', { p_good_id: goodId });
    const references = parseGoodOtherCompositionReferences(data, goodId);
    if (error || !references) throw new Error('Other compositions unavailable');
    if (!references.groups.length) return { groups: [], nextChangeAt: references.nextChangeAt };

    // Include the current card so a publication change between reads hides the groups too.
    const ids = [...new Set([goodId, ...references.groups.flatMap(group => group.goods.map(member => member.goodId))])];
    const reads = [];
    for (let offset = 0; offset < ids.length; offset += 1000) reads.push(getCatalogGoodsByIds(ids.slice(offset, offset + 1000)));
    const goods = (await Promise.all(reads)).flat();
    return resolveGoodOtherCompositions(references, goods, goodId);
  } catch {
    return { groups: [], nextChangeAt: null, unavailable: true };
  }
}
