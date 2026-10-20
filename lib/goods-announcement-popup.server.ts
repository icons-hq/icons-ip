import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { parseHomeAnnouncementPopup, type HomeAnnouncementPopupData } from './goods-announcement-popup';

/** Public, cookie-free and uncached: time boundaries must be read on refresh. */
export async function loadHomeAnnouncementPopup(): Promise<HomeAnnouncementPopupData> {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return { item: null, nextChangeAt: null };
  try {
    const client = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) } });
    const { data, error } = await client.rpc('get_home_announcement_popup');
    const parsed = parseHomeAnnouncementPopup(data);
    if (error || !parsed) throw new Error('invalid popup response');
    return parsed;
  } catch { return { item: null, nextChangeAt: null, unavailable: true }; }
}
