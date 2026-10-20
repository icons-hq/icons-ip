import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import { STORE_SETTINGS_CACHE_TAG } from '@/lib/admin/store-settings';
import { normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from '@/lib/media';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { DEFAULT_STOREFRONT_BRANDING, parseStorefrontBranding, type StorefrontBranding } from './store-branding';

/** Cookie-free like business-info/notice-strip so the public shell keeps SSG support. */
export async function loadStorefrontBranding(): Promise<StorefrontBranding> {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return DEFAULT_STOREFRONT_BRANDING;
  try {
    const client = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
    const { data, error } = await client.rpc('get_storefront_branding_v2');
    if (error) return DEFAULT_STOREFRONT_BRANDING;
    return parseStorefrontBranding(data, path => client.storage.from(PUBLIC_MEDIA_BUCKET)
      .getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl) ?? DEFAULT_STOREFRONT_BRANDING;
  } catch { return DEFAULT_STOREFRONT_BRANDING; }
}
export const getStorefrontBranding = unstable_cache(loadStorefrontBranding, ['storefront-branding-v2'], {
  revalidate: 300, tags: [STORE_SETTINGS_CACHE_TAG],
});
