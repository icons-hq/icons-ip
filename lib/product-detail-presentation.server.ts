import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { getCatalogGoodsByIds } from '@/lib/catalog';
import { parsePublicDetailPresentation, type PublicDetailPresentation } from '@/lib/product-detail-presentation';
import { loadReviewEventDisclosures } from '@/lib/review-events.server';

export async function loadPublicDetailPresentation(goodId: string): Promise<PublicDetailPresentation | null> {
  if (!getSupabaseConfig().isConfigured) return null;
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('get_product_detail_presentation', { p_good_id: goodId });
    if (error) throw new Error('Detail presentation unavailable');
    if (data === null) return null;
    const parsed = parsePublicDetailPresentation(data);
    if (!parsed) throw new Error('Invalid detail presentation');
    const paths = [...new Set(parsed.reviews?.cards.flatMap(card => card.imagePaths) ?? [])];
    const [goods, signed, disclosures] = await Promise.all([
      getCatalogGoodsByIds(Object.values(parsed.recommendations).flat()).catch(() => null),
      Promise.all(paths.map(async path => {
        try {
          const { data, error } = await client.storage.from('user-uploads').createSignedUrl(path, 3600);
          return [path, error ? null : data?.signedUrl ?? null] as const;
        } catch { return [path, null] as const; }
      })),
      loadReviewEventDisclosures(parsed.reviews?.cards.map(card => card.id) ?? []),
    ]);
    const byId = new Map((goods ?? []).map(good => [good.id, good]));
    const urls = new Map(signed);
    const selected = (key: keyof typeof parsed.recommendations) => {
      const cards = parsed.recommendations[key].flatMap(id => id !== goodId && byId.has(id) ? [byId.get(id)!] : []);
      return (key === 'similar' || key === 'together') && cards.length < 5 ? [] : cards;
    };
    return {
      ...parsed,
      ...(goods === null ? { recommendationsUnavailable: true } : {}),
      reviews: parsed.reviews && { ...parsed.reviews, cards: parsed.reviews.cards.map(({ imagePaths, ...card }) => ({ ...card, eventDisclosure: disclosures.get(card.id), imageUrls: imagePaths.flatMap(path => urls.get(path) ? [urls.get(path)!] : []) })) },
      recommendations: { similar: selected('similar'), together: selected('together'), categoryPopular: selected('categoryPopular'), storePopular: selected('storePopular') },
    };
  } catch {
    return { banner: null, reviews: null, nextChangeAt: null, recommendations: { similar: [], together: [], categoryPopular: [], storePopular: [] }, unavailable: true };
  }
}
