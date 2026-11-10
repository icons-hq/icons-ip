import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { isUuid } from '@/lib/uuid';
import { GOODS_ANNOUNCEMENT_CATEGORIES, GOODS_ANNOUNCEMENT_DEVICES, type GoodAnnouncementsData } from './admin/goods-announcements';

export async function loadGoodAnnouncements(goodId: string): Promise<GoodAnnouncementsData> {
  if (!getSupabaseConfig().isConfigured) return { items: [], nextChangeAt: null };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('get_good_announcements', { p_good_id: goodId });
    if (error || !data || !Array.isArray(data.items) || data.items.some((item: Record<string, unknown>) => !item || !isUuid(item.id)
      || typeof item.title !== 'string' || typeof item.body !== 'string' || !['plain', 'html'].includes(String(item.format))
      || !GOODS_ANNOUNCEMENT_CATEGORIES.some(category => category.value === item.category)
      || !GOODS_ANNOUNCEMENT_DEVICES.some(device => device.value === item.device) || typeof item.important !== 'boolean')
      || (data.nextChangeAt !== null && (typeof data.nextChangeAt !== 'string' || !Number.isFinite(Date.parse(data.nextChangeAt))))) throw new Error('invalid announcement data');
    return { items: data.items, nextChangeAt: data.nextChangeAt };
  } catch { return { items: [], nextChangeAt: null, unavailable: true }; }
}
