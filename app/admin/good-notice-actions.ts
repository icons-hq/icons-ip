'use server';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { loadGoodsNoticePresets } from '@/lib/admin/goods-notice-presets.server';
import { normalizeGoodsNoticePresetFilters } from '@/lib/admin/goods-notice-presets';
import type { GoodsNoticeInfo } from '@/lib/goods-notice';
export async function findGoodNoticePresets(query: string, page: number) {
  const auth = await getCurrentAdminAuthState();
  if (!auth.user || !auth.isStaff) return { error: '관리자 권한이 필요합니다.' };
  try { return await loadGoodsNoticePresets(normalizeGoodsNoticePresetFilters({ q: query, page: String(page) })); }
  catch { return { error: '프리셋을 불러오지 못했습니다. 다시 시도해주세요.' }; }
}
export async function loadLastSavedGoodNotice(): Promise<{ notice?: GoodsNoticeInfo; name?: string; error?: string }> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.user || !auth.isStaff) return { error: '관리자 권한이 필요합니다.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_last_good_notice');
    if (error || !data) return { error: '최근 저장한 상품이 없습니다.' };
    return data as { name: string; notice: GoodsNoticeInfo };
  } catch { return { error: '최근 값을 불러오지 못했습니다. 다시 시도해주세요.' }; }
}
