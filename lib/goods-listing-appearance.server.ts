import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseAdminArtworkPath } from '@/lib/admin/artwork';
import { imageBg, publicMediaUrl, normalizePublicMediaPath } from '@/lib/media';
import { parseGoodsColorChips, type GoodsListingAppearance } from './store-presentation';
/** Metadata is bounded in SQL and joined only to the caller's already-public IDs. */
export async function loadGoodsListingAppearance(client: SupabaseClient, ids: string[]): Promise<Map<string, GoodsListingAppearance>> {
  if (!ids.length) return new Map();
  const groups: string[][] = [];
  for (let index = 0; index < ids.length; index += 1000) groups.push(ids.slice(index, index + 1000));
  const results = await Promise.all(groups.map(group => client.rpc('get_goods_listing_appearance', { p_good_ids: group })));
  const allowed = new Set(ids), output = new Map<string, GoodsListingAppearance>();
  for (const result of results) {
    if (result.error || !Array.isArray(result.data)) continue;
    for (const raw of result.data) {
      if (!raw || typeof raw.id !== 'string' || !allowed.has(raw.id) || typeof raw.description !== 'string'
        || !['plain', 'html'].includes(raw.descriptionFormat) || [...raw.description].length > 240 || !Array.isArray(raw.galleryPaths) || raw.galleryPaths.length > 9) continue;
      const colors = parseGoodsColorChips(raw.colors);
      if (!colors) continue;
      const gallery: string[] = (raw.galleryPaths as unknown[]).flatMap((path: unknown) => {
        if (typeof path !== 'string' || parseAdminArtworkPath(normalizePublicMediaPath(path))?.kind !== 'good') return [];
        const url = publicMediaUrl(path); return url ? [imageBg(url)] : [];
      });
      output.set(raw.id, { colors, gallery: [...new Set(gallery)], description: raw.descriptionFormat === 'html' ? decodeListingEntities(raw.description) : raw.description });
    }
  }
  return output;
}
/** Text is rendered as React text, never injected as HTML. Decode common entities
 * once so a saved literal '&amp;lt;' does not turn into markup. */
export function decodeListingEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const number = parseInt(entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1), entity[1]?.toLowerCase() === 'x' ? 16 : 10);
    return Number.isSafeInteger(number) && number >= 32 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
  });
}
