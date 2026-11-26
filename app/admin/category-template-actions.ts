'use server';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { CATEGORY_TEMPLATES_PATH, CATEGORY_TEMPLATE_LIST_FAILED, CATEGORY_TEMPLATE_UNCERTAIN, categoryTemplateError, parseCategoryTemplateChanges, parseCategoryTemplatePage, parseCategoryTemplateRows, type CategoryTemplate, type CategoryTemplateChange, type CategoryTemplatePage } from '@/lib/admin/category-templates';
import { readCategoryTemplates } from '@/lib/admin/category-templates.server';

export type CategoryTemplateResult<T> = { ok: true; value: T } | { ok: false; error: string; uncertain?: boolean; conflict?: boolean };
const unknown = <T,>(): CategoryTemplateResult<T> => ({ ok: false, error: CATEGORY_TEMPLATE_UNCERTAIN, uncertain: true });
const TOO_MANY = '자주 쓰는 카테고리가 너무 많아 목록을 만들지 못했습니다.';
/** 한 번에 읽지 못한 이유를 오류 문구로 바꾼다. 읽은 것 중 하나라도 너무 많으면 그 이유를 먼저 말한다. */
const readFailure = (...reads: { ok: boolean; reason?: string }[]) => ({ ok: false as const, error: reads.some(read => read.reason === 'too_many') ? TOO_MANY : CATEGORY_TEMPLATE_LIST_FAILED });
export async function listCategoryTemplatesAction(query: string, archived: boolean, page: number): Promise<CategoryTemplateResult<CategoryTemplatePage>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  const failure = { ok: false as const, error: CATEGORY_TEMPLATE_LIST_FAILED };
  if (typeof query !== 'string' || Array.from(query).length > 120 || typeof archived !== 'boolean' || !Number.isSafeInteger(page) || page < 1 || page > 10000) return failure;
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_list_catalog_category_templates', { p_query: query.trim(), p_archived: archived, p_page: page });
    const value = error ? null : parseCategoryTemplatePage(data);
    return value?.page === page && value.rows.every(row => row.archived === archived) ? { ok: true, value } : failure;
  } catch { return failure; }
}
/**
 * 상품 화면의 '자주 쓰는 카테고리 고르기' 창이 쓸 목록. 지금 고를 수 없는 줄(카테고리를 보관했거나 하위 카테고리가 생긴 것)은
 * 여기서 빼고 전부 돌려준다 — 창이 이 목록을 20개씩 자르므로 개수와 쪽 수가 고를 수 있는 것만 센다.
 */
export async function loadUsableCategoryTemplatesAction(): Promise<CategoryTemplateResult<CategoryTemplate[]>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  const read = await readCategoryTemplates(false);
  return read.ok ? { ok: true, value: read.rows.filter(row => row.usable) } : readFailure(read);
}
/** 등록 창이 목록에서 뺄 카테고리 번호: 이미 등록한 것 전부(보관한 것 포함). */
export async function loadRegisteredCategoryTemplateIdsAction(): Promise<CategoryTemplateResult<string[]>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  const [active, archived] = await Promise.all([readCategoryTemplates(false), readCategoryTemplates(true)]);
  return active.ok && archived.ok ? { ok: true, value: [...active.rows, ...archived.rows].map(row => row.categoryId) } : readFailure(active, archived);
}
export async function saveCategoryTemplatesAction(changes: CategoryTemplateChange[], archived: boolean, operationId: string): Promise<CategoryTemplateResult<CategoryTemplate[]>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  const items = parseCategoryTemplateChanges(changes);
  if (!items || typeof archived !== 'boolean' || !isUuid(operationId)) return { ok: false, error: '저장할 카테고리를 다시 골라주세요. 한 번에 100개까지 처리할 수 있습니다.' };
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_save_catalog_category_templates', { p_items: items, p_archived: archived, p_operation_id: operationId });
    if (error) return ['PT409', '23505', '23514', '22023', '42501', 'P0002'].includes(error.code ?? '') ? { ok: false, error: categoryTemplateError(error.message), conflict: error.code === 'PT409' || error.code === '23505' } : unknown();
    const rows = parseCategoryTemplateRows(data?.rows);
    if (!rows || rows.length !== items.length || items.some(item => !rows.some(row => row.categoryId === item.categoryId && row.revision === item.revision + 1 && row.archived === archived))) return unknown();
    revalidatePath(CATEGORY_TEMPLATES_PATH); return { ok: true, value: rows };
  } catch { return unknown(); }
}
