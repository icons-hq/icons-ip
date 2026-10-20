import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_GOODS_MEDIA_SETTINGS, parseGoodsMediaAsset, parseGoodsMediaSettings, type PublicGoodMedia } from './goods-media';

export async function loadPublicGoodMedia(goodId: string): Promise<PublicGoodMedia | null> {
  try {
    const client = await createClient(), { data, error } = await client.rpc('get_good_media', { p_good_id: goodId });
    if (error || !data) return null;
    const settings = parseGoodsMediaSettings(data.settings) ?? DEFAULT_GOODS_MEDIA_SETTINGS;
    return { settings, video: parseGoodsMediaAsset(data.video), shortclip: parseGoodsMediaAsset(data.shortclip) };
  } catch { return null; }
}
