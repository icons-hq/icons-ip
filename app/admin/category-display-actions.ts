'use server';
import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { CATEGORY_DISPLAY_ADMIN_PATH, categoryDisplayRecord, parseCategoryDisplayDirectory, parseCategoryDisplayTreeChange, parseCategoryDisplayValues, parseCategoryDisplaySnapshot, type CategoryDisplayDirectory, type CategoryDisplaySnapshot, type CategoryDisplayPage } from '@/lib/category-display';
import { categoryDisplaySqlQuery, parseCategoryDisplayPage, hydrateCategoryDisplayPage } from '@/lib/category-display.server';
import { loadAdminCategoryDisplay, loadAdminCategoryDisplays } from '@/lib/admin/category-display.server';
import type { ShopListQuery } from '@/lib/shop-catalog';
import { STOREFRONT_MEGA_MENU_CACHE_TAG } from '@/lib/storefront-mega-menu';
import { searchShoppingStoryGoods } from '@/lib/admin/shopping-stories.server';
import { DEFAULT_STORY_GOOD_FILTERS, type StoryGoodCandidates } from '@/lib/admin/shopping-story-picker';

export type CategoryDisplayFailure = { error: string; uncertain?: boolean; conflict?: boolean };
export type CategoryDisplaySaveResult = { snapshot: CategoryDisplaySnapshot } | CategoryDisplayFailure;
export type CategoryDisplayTreeResult = { nodeId: string; directory: CategoryDisplayDirectory } | CategoryDisplayFailure;
function treeFailure(error?: { code?: string; message?: string }): CategoryDisplayFailure {
  const messages: Record<string, string> = {
    display_node_name_limit: '새 전시분류 이름은 20자 이내로 입력해주세요. 기존 이름은 그대로 유지할 수 있습니다.',
    display_tree_depth_limit: '하위 전시분류를 포함해 3단계 이내로 옮겨주세요.',
    display_tree_sibling_limit: '최상위는 19개, 같은 상위 분류 아래에는 15개까지 사용할 수 있습니다. 보관할 분류를 먼저 정리해주세요.',
    display_parent_unavailable: '자기 자신·하위 분류·보관된 분류를 상위 분류로 선택할 수 없습니다.',
    display_tree_cycle: '자기 자신을 상위 분류로 선택할 수 없습니다.',
    display_tree_position_out_of_range: '전시분류 순서가 바뀌었습니다. 최신 분류를 불러온 뒤 다시 정해주세요.',
  };
  const message = error?.message && Object.hasOwn(messages, error.message) ? messages[error.message] : undefined;
  return message ? { error: message } : fail(error);
}
/* 전역 셸의 카테고리 메가메뉴·모바일 카테고리 시트는 쿠키 없는 캐시로 읽는다(lib/storefront-mega-menu.server.ts).
   전시분류 트리·구성·아이콘 저장이 공개 메뉴를 바꾸므로 저장 직후 태그를 즉시 만료한다(서버 액션 전용 updateTag —
   revalidateTag('max')는 stale-while-revalidate 라 저장한 운영자가 옛 메뉴를 한 번 더 본다). */
function refreshStorefrontMenus() {
  updateTag(STOREFRONT_MEGA_MENU_CACHE_TAG);
}
const NODE_IMAGE_PATH = /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
function fail(error?: { code?: string }): CategoryDisplayFailure {
  if (error?.code === 'PT409') return { error: '다른 작업에서 전시 구성이 바뀌었습니다. 입력을 보관한 뒤 최신 저장본을 불러와주세요.', conflict: true };
  if (['22023', '42501', '28000', '23514', '23503', '23505', 'P0002'].includes(error?.code ?? '')) return { error: '현재 권한·카테고리·상품·업로드한 이미지를 확인해주세요. 입력은 유지됩니다.' };
  return { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 결과를 다시 확인해주세요.', uncertain: true };
}
export async function updateCategoryDisplayTreeAction(input: unknown, expectedRevision: number, operationId: string, expectedActorId: string): Promise<CategoryDisplayTreeResult> {
  try {
    const auth = await requireAdminActionAccess(CATEGORY_DISPLAY_ADMIN_PATH, { capability: 'store.manage' });
    if (!auth || auth.user.id !== expectedActorId) return { error: '로그인 상태가 바뀌었습니다. 이 화면을 새로 열어주세요.' };
    const change = parseCategoryDisplayTreeChange(input);
    if (!change || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !isUuid(operationId)) return { error: '전시분류 이름·상위 분류·순서를 확인해주세요.' };
    const client = await createClient(), { data, error } = await client.rpc('admin_update_category_display_tree', { p_change: change, p_expected_revision: expectedRevision, p_operation_id: operationId });
    if (error) return treeFailure(error);
    const directory = categoryDisplayRecord(data) ? parseCategoryDisplayDirectory(data.directory) : null;
    if (!directory || !categoryDisplayRecord(data) || data.nodeId !== change.id || directory.revision !== expectedRevision + 1) return fail();
    const node = directory.categories.find(item => item.id === change.id);
    if (!node || (change.action === 'create' || change.action === 'update') && (node.name !== change.name || node.parentId !== change.parentId || node.sortOrder !== change.position)
      || change.action === 'archive' && !node.archivedAt || change.action === 'restore' && node.archivedAt) return fail();
    revalidatePath(CATEGORY_DISPLAY_ADMIN_PATH); revalidatePath('/shop'); refreshStorefrontMenus();
    return { nodeId: change.id, directory };
  } catch (error) { unstable_rethrow(error); return fail(); }
}
/** 전시분류 아이콘 적용·해제(L5). 트리와 같은 revision CAS·요청 UUID·감사이고, 새 이미지는 본인이 검증한 업로드만 받는다. */
export async function updateCategoryDisplayNodeImageAction(nodeId: string, imagePath: string | null, expectedRevision: number, operationId: string, expectedActorId: string): Promise<CategoryDisplayTreeResult> {
  try {
    const auth = await requireAdminActionAccess(CATEGORY_DISPLAY_ADMIN_PATH, { capability: 'store.manage' });
    if (!auth || auth.user.id !== expectedActorId) return { error: '로그인 상태가 바뀌었습니다. 이 화면을 새로 열어주세요.' };
    if (!isUuid(nodeId) || !isUuid(operationId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || imagePath !== null && (typeof imagePath !== 'string' || !NODE_IMAGE_PATH.test(imagePath))) return { error: '아이콘 이미지와 저장 기준을 확인해주세요.' };
    const client = await createClient(), { data, error } = await client.rpc('admin_set_category_display_node_image', {
      p_node_id: nodeId, p_image_path: imagePath, p_expected_revision: expectedRevision, p_operation_id: operationId,
    });
    if (error?.message === 'unverified_artwork') return { error: '업로드를 확인하지 못한 이미지입니다. 이미지를 다시 올려주세요.' };
    if (error) return treeFailure(error);
    const directory = categoryDisplayRecord(data) ? parseCategoryDisplayDirectory(data.directory) : null;
    const node = directory?.categories.find(item => item.id === nodeId);
    if (!directory || !categoryDisplayRecord(data) || data.nodeId !== nodeId || directory.revision !== expectedRevision + 1 || !node || node.imagePath !== imagePath) return fail();
    revalidatePath(CATEGORY_DISPLAY_ADMIN_PATH); refreshStorefrontMenus();
    return { nodeId, directory };
  } catch (error) { unstable_rethrow(error); return fail(); }
}
export async function reloadCategoryDisplayTreeAction(expectedActorId: string): Promise<{ directory: CategoryDisplayDirectory } | CategoryDisplayFailure> {
  try {
    const auth = await requireAdminActionAccess(CATEGORY_DISPLAY_ADMIN_PATH, { capability: 'store.manage' });
    if (!auth || auth.user.id !== expectedActorId) return { error: '로그인 상태가 바뀌었습니다. 이 화면을 새로 열어주세요.' };
    const directory = await loadAdminCategoryDisplays();
    revalidatePath(CATEGORY_DISPLAY_ADMIN_PATH);
    return { directory };
  } catch (error) { unstable_rethrow(error); return { error: '전시분류를 다시 불러오지 못했습니다. 입력은 유지됩니다.' }; }
}
export async function saveCategoryDisplayAction(categoryId: string, input: unknown, expectedRevision: number, operationId: string, expectedActorId: string): Promise<CategoryDisplaySaveResult> {
  try {
    const auth = await requireAdminActionAccess(CATEGORY_DISPLAY_ADMIN_PATH, { capability: 'store.manage' });
    if (!auth || auth.user.id !== expectedActorId) return { error: '로그인 상태가 바뀌었습니다. 이 화면을 새로 열어주세요.' };
    const values = parseCategoryDisplayValues(input);
    if (!values || !isUuid(categoryId) || !isUuid(operationId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return { error: '전시 설정과 저장 기준을 확인해주세요.' };
    const client = await createClient(), { data, error } = await client.rpc('admin_save_category_display', { p_category_id: categoryId, p_values: values, p_expected_revision: expectedRevision, p_operation_id: operationId });
    if (error) return fail(error);
    const snapshot = parseCategoryDisplaySnapshot(data);
    if (!snapshot || snapshot.category.id !== categoryId || snapshot.revision !== expectedRevision + 1 || JSON.stringify(snapshot.values) !== JSON.stringify(values)) return fail();
    revalidatePath(CATEGORY_DISPLAY_ADMIN_PATH); revalidatePath('/shop'); refreshStorefrontMenus();
    return { snapshot };
  } catch (error) { unstable_rethrow(error); return fail(); }
}
export async function reloadCategoryDisplayAction(categoryId: string): Promise<CategoryDisplaySaveResult> {
  try {
    if (!await requireAdminActionAccess(CATEGORY_DISPLAY_ADMIN_PATH, { capability: 'store.manage' }) || !isUuid(categoryId)) return { error: '스토어 관리 권한이 필요합니다.' };
    const snapshot = await loadAdminCategoryDisplay(categoryId);
    if (snapshot) revalidatePath(CATEGORY_DISPLAY_ADMIN_PATH);
    return snapshot ? { snapshot } : { error: '현재 카테고리를 확인할 수 없습니다.' };
  } catch (error) { unstable_rethrow(error); return { error: '최신 저장본을 불러오지 못했습니다. 입력은 유지됩니다.' }; }
}
export async function previewCategoryDisplayAction(categoryId: string, input: unknown, query: ShopListQuery, expectedActorId: string): Promise<{ page: CategoryDisplayPage | null } | CategoryDisplayFailure> {
  try {
    const auth = await requireAdminActionAccess(CATEGORY_DISPLAY_ADMIN_PATH, { capability: 'store.manage' });
    if (!auth || auth.user.id !== expectedActorId) return { error: '로그인 상태가 바뀌었습니다. 이 화면을 새로 열어주세요.' };
    const values = parseCategoryDisplayValues(input);
    if (!values || !isUuid(categoryId)) return { error: '미리볼 입력값을 확인해주세요.' };
    const client = await createClient(), { data, error } = await client.rpc('admin_preview_category_display', { p_category_id: categoryId, p_values: values, p_query: categoryDisplaySqlQuery(query) });
    if (error) return { error: '미리보기를 불러오지 못했습니다. 입력은 유지됩니다.' };
    const page = data === null ? null : parseCategoryDisplayPage(data, query);
    if (data !== null && (!page || page.category.id !== categoryId || page.offset !== 0)) return { error: '미리보기 결과를 확인하지 못했습니다.' };
    return { page: page ? await hydrateCategoryDisplayPage(page, client) : null };
  } catch (error) { unstable_rethrow(error); return { error: '미리보기를 불러오지 못했습니다. 입력은 유지됩니다.' }; }
}
export async function searchCategoryDisplayGoodsAction(query: string, page: number, categoryId: string | null, onlyPublished = false): Promise<{ data: StoryGoodCandidates } | CategoryDisplayFailure> {
  try {
    if (!await requireAdminActionAccess(CATEGORY_DISPLAY_ADMIN_PATH, { capability: 'store.manage' })) return { error: '스토어 관리 권한이 필요합니다.' };
    if (typeof query !== 'string' || query.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || categoryId !== null && !isUuid(categoryId)) return { error: '검색 조건을 확인해주세요.' };
    return { data: await searchShoppingStoryGoods(query, page, { ...DEFAULT_STORY_GOOD_FILTERS, categoryId, visibility: onlyPublished ? 'published' : 'all' }) };
  } catch (error) { unstable_rethrow(error); return { error: '상품을 불러오지 못했습니다. 선택은 유지됩니다.' }; }
}
