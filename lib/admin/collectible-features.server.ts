import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseAdminCollectibleFeatures, type AdminCollectibleFeaturesState } from './collectible-features';

/** 읽지 못하면 null — 화면이 안내하고 저장을 막는다(값을 모른 채 덮어쓰지 않는다). */
export async function loadAdminCollectibleFeatures(): Promise<AdminCollectibleFeaturesState | null> {
  try {
    const { data, error } = await (await createClient()).rpc('admin_get_collectible_features');
    return error ? null : parseAdminCollectibleFeatures(data);
  } catch { return null; }
}
