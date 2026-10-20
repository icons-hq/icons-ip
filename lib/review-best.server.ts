import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { loadReviewEventDisclosures } from '@/lib/review-events.server';
import { parseReviewBestSettings, parseTypedSelectedReviewCards, type PublicSelectedReviewCard, type ReviewBestSettings } from './review-best';

export async function loadReviewBestSettings(): Promise<ReviewBestSettings> {
  try {
    const { data, error } = await (await createClient()).rpc('admin_get_review_best_settings');
    const settings = parseReviewBestSettings(data);
    if (error || !settings) throw new Error('Unavailable BEST review settings');
    return settings;
  } catch { return { enabled: false, revision: 0, unavailable: true }; }
}
export async function loadSelectedReviewCards(goodId: string): Promise<PublicSelectedReviewCard[]> {
  if (!getSupabaseConfig().isConfigured) return [];
  try {
    const client = await createClient(), { data, error } = await client.rpc('get_good_selected_reviews_v2', { p_good_id: goodId });
    const cards = parseTypedSelectedReviewCards(data);
    if (error || !cards?.length) return [];
    const paths = [...new Set(cards.flatMap(card => card.imagePaths))];
    const [signed, disclosures] = await Promise.all([
      Promise.all(paths.map(async path => {
        try {
          const { data, error } = await client.storage.from('user-uploads').createSignedUrl(path, 3600);
          return [path, error ? null : data?.signedUrl ?? null] as const;
        } catch { return [path, null] as const; }
      })),
      loadReviewEventDisclosures(cards.map(card => card.id)),
    ]);
    const urls = new Map(signed);
    return cards.map(({ imagePaths, ...card }) => ({ ...card, imageUrls: imagePaths.flatMap(path => urls.get(path) ? [urls.get(path)!] : []), eventDisclosure: disclosures.get(card.id) }));
  } catch { return []; }
}
