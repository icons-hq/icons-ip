'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { ADMIN_SHOPPING_STORIES_PATH, normalizeShoppingStoryInput, shoppingStoryError, type AdminShoppingStory, type ShoppingStorySaveRequest } from '@/lib/admin/shopping-stories';
import { loadAdminShoppingStory, searchShoppingStoryGoods } from '@/lib/admin/shopping-stories.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { shoppingStoryHref } from '@/lib/shopping-stories';
import { DEFAULT_STORY_GOOD_FILTERS, validStoryGoodFilters, type StoryGoodFilters } from '@/lib/admin/shopping-story-picker';

export type ShoppingStorySaveResult = { ok: true; story: AdminShoppingStory; warnings: string[] } | { ok: false; error: string; conflict?: boolean; latestStory?: AdminShoppingStory; savedId?: string; retrySameOperation?: boolean };
function refreshStories(ids: string[]) {
  revalidatePath('/'); revalidatePath('/stories'); revalidatePath(ADMIN_SHOPPING_STORIES_PATH);
  for (const id of ids) { revalidatePath(shoppingStoryHref(id)); revalidatePath(`${ADMIN_SHOPPING_STORIES_PATH}/${id}`); }
}
export async function saveShoppingStoryAction(request: ShoppingStorySaveRequest): Promise<ShoppingStorySaveResult> {
  if (!await requireAdminActionAccess(ADMIN_SHOPPING_STORIES_PATH, { capability: 'store.manage' })) return { ok: false, error: '쇼핑스토리 관리 권한이 필요합니다.' };
  if (!request || !isUuid(request.id) || !isUuid(request.operationId) || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) return { ok: false, error: '저장 요청을 다시 확인해주세요.' };
  const normalized = normalizeShoppingStoryInput(request.values);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  let result;
  try {
    const client = await createClient();
    result = await client.rpc('admin_save_shopping_story', { p_id: request.id, p_expected_revision: request.expectedRevision, p_operation_id: request.operationId, p_values: normalized.value });
  } catch { return { ok: false, error: '저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인하거나 목록에서 저장 여부를 확인해주세요.', retrySameOperation: true }; }
  if (result.error) {
    let latestStory: AdminShoppingStory | undefined;
    if (result.error.code === 'PT409') { try { latestStory = await loadAdminShoppingStory(request.id) ?? undefined; } catch {} }
    return { ok: false, error: shoppingStoryError(result.error.message), conflict: result.error.code === 'PT409', latestStory };
  }
  refreshStories([request.id]);
  try {
    const story = await loadAdminShoppingStory(request.id);
    if (story) return { ok: true, story, warnings: normalized.warnings };
  } catch { /* The committed write must not be mistaken for an unsaved draft. */ }
  return { ok: false, error: '저장은 완료됐지만 저장 내용을 다시 읽지 못했습니다. 목록에서 스토리를 열어 확인해주세요.', savedId: request.id };
}
export async function deleteShoppingStoriesAction(operationId: string, entries: { id: string; revision: number }[]): Promise<{ ok: boolean; error?: string; retrySameOperation?: boolean }> {
  if (!await requireAdminActionAccess(ADMIN_SHOPPING_STORIES_PATH, { capability: 'store.manage' })) return { ok: false, error: '쇼핑스토리 관리 권한이 필요합니다.' };
  if (!isUuid(operationId) || !Array.isArray(entries) || !entries.length || entries.length > 100 || entries.some(entry => !entry || typeof entry !== 'object' || !isUuid(entry.id) || !Number.isSafeInteger(entry.revision) || entry.revision < 1)
    || new Set(entries.map(entry => entry.id.toLowerCase())).size !== entries.length) return { ok: false, error: '삭제할 스토리를 다시 선택해주세요.' };
  try {
    const client = await createClient(); const { error } = await client.rpc('admin_delete_shopping_stories', { p_operation_id: operationId, p_entries: entries });
    if (error) return { ok: false, error: shoppingStoryError(error.message) };
    refreshStories(entries.map(entry => entry.id)); return { ok: true };
  } catch { return { ok: false, error: '삭제 결과를 확인하지 못했습니다. 같은 선택으로 다시 확인해주세요.', retrySameOperation: true }; }
}
export async function searchShoppingStoryGoodsAction(query: string, page: number, filters: StoryGoodFilters = DEFAULT_STORY_GOOD_FILTERS) {
  if (!await requireAdminActionAccess(ADMIN_SHOPPING_STORIES_PATH, { capability: 'store.manage' })) return { ok: false as const, error: '쇼핑스토리 관리 권한이 필요합니다.' };
  if (typeof query !== 'string' || Array.from(query).length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !validStoryGoodFilters(filters)) return { ok: false as const, error: '검색 조건을 다시 확인해주세요.' };
  try { return { ok: true as const, data: await searchShoppingStoryGoods(query.trim(), page, filters) }; }
  catch { return { ok: false as const, error: '관련상품을 불러오지 못했습니다. 다시 시도해주세요.' }; }
}
