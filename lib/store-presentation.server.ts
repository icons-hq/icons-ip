import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { DEFAULT_STORE_PRESENTATION, parseStorePresentation, STORE_PRESENTATION_CACHE_TAG } from './store-presentation';
export async function loadStorefrontPresentation() {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return DEFAULT_STORE_PRESENTATION;
  try {
    const client = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
    const { data, error } = await client.rpc('get_storefront_presentation');
    return error ? DEFAULT_STORE_PRESENTATION : parseStorePresentation(data) ?? DEFAULT_STORE_PRESENTATION;
  } catch { return DEFAULT_STORE_PRESENTATION; }
}
export const getStorefrontPresentation = unstable_cache(loadStorefrontPresentation, ['storefront-presentation'], { revalidate: 300, tags: [STORE_PRESENTATION_CACHE_TAG] });
