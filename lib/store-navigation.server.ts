import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import { STORE_SETTINGS_CACHE_TAG } from '@/lib/admin/store-settings';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { DEFAULT_STOREFRONT_NAVIGATION, parseStorefrontNavigation, type StorefrontNavigation } from './store-navigation';

/** Cookie-free public projection keeps the root shell compatible with static pages. */
export async function loadStorefrontNavigation(): Promise<StorefrontNavigation> {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return DEFAULT_STOREFRONT_NAVIGATION;
  try {
    const client = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
    const { data, error } = await client.rpc('get_storefront_navigation');
    return error ? DEFAULT_STOREFRONT_NAVIGATION : parseStorefrontNavigation(data) ?? DEFAULT_STOREFRONT_NAVIGATION;
  } catch { return DEFAULT_STOREFRONT_NAVIGATION; }
}
export const getStorefrontNavigation = unstable_cache(loadStorefrontNavigation, ['storefront-navigation'], {
  revalidate: 300, tags: [STORE_SETTINGS_CACHE_TAG],
});
