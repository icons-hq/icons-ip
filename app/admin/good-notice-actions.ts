'use server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { loadGoodNoticeOfGood, loadGoodsNoticePresets } from '@/lib/admin/goods-notice-presets.server';
import { normalizeGoodsNoticePresetFilters } from '@/lib/admin/goods-notice-presets';
import { validOptionImportGoodId } from '@/lib/admin/goods-option-import';
import type { GoodsNoticeInfo } from '@/lib/goods-notice';
export async function findGoodNoticePresets(query: string, page: number) {
  const auth = await requireAdminActionAccess('/admin/catalog/goods');
  if (!auth) return { error: '관리자 권한이 필요합니다.' };
  try { return await loadGoodsNoticePresets(normalizeGoodsNoticePresetFilters({ q: query, page: String(page) })); }
  catch { return { error: '템플릿을 불러오지 못했습니다. 다시 시도해주세요.' }; }
}
/** 화면은 쓰지 않는다(다른 상품에서 복사는 `loadGoodNoticeOf`). 기존 호출을 위해 남겨 둔다. */
export async function loadLastSavedGoodNotice(): Promise<{ notice?: GoodsNoticeInfo; name?: string; error?: string }> {
  const auth = await requireAdminActionAccess('/admin/catalog/goods');
  if (!auth) return { error: '관리자 권한이 필요합니다.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_last_good_notice');
    if (error || !data) return { error: '최근 저장한 상품이 없습니다.' };
    return data as { name: string; notice: GoodsNoticeInfo };
  } catch { return { error: '최근 값을 불러오지 못했습니다. 다시 시도해주세요.' }; }
}
/** 상품 선택창에서 고른 다른 상품의 고시정보 7칸. 7칸이 모두 비어 있는지는 부르는 쪽이 본다. */
export async function loadGoodNoticeOf(goodId: unknown): Promise<{ notice?: GoodsNoticeInfo; name?: string; error?: string }> {
  const auth = await requireAdminActionAccess('/admin/catalog/goods');
  if (!auth) return { error: '관리자 권한이 필요합니다.' };
  if (!validOptionImportGoodId(goodId)) return { error: '복사할 상품을 다시 골라주세요.' };
  try {
    return await loadGoodNoticeOfGood(goodId) ?? { error: '상품을 찾을 수 없습니다. 목록을 다시 열어 골라주세요.' };
  } catch { return { error: '상품정보제공고시를 불러오지 못했습니다. 다시 시도해주세요.' }; }
}
