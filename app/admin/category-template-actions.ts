'use server';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { CATEGORY_TEMPLATES_PATH, categoryTemplateError, parseCategoryTemplateChanges, parseCategoryTemplatePage, parseCategoryTemplateRows, type CategoryTemplate, type CategoryTemplateChange, type CategoryTemplatePage } from '@/lib/admin/category-templates';

export type CategoryTemplateResult<T> = { ok: true; value: T } | { ok: false; error: string; uncertain?: boolean; conflict?: boolean };
const unknown = <T,>(): CategoryTemplateResult<T> => ({ ok: false, error: '저장 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.', uncertain: true });
export async function listCategoryTemplatesAction(query: string, archived: boolean, page: number): Promise<CategoryTemplateResult<CategoryTemplatePage>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  const failure = { ok: false as const, error: '카테고리 템플릿을 불러오지 못했습니다. 다시 조회해주세요.' };
  if (typeof query !== 'string' || Array.from(query).length > 120 || typeof archived !== 'boolean' || !Number.isSafeInteger(page) || page < 1 || page > 10000) return failure;
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_list_catalog_category_templates', { p_query: query.trim(), p_archived: archived, p_page: page });
    const value = error ? null : parseCategoryTemplatePage(data);
    return value?.page === page && value.rows.every(row => row.archived === archived) ? { ok: true, value } : failure;
  } catch { return failure; }
}
export async function saveCategoryTemplatesAction(changes: CategoryTemplateChange[], archived: boolean, operationId: string): Promise<CategoryTemplateResult<CategoryTemplate[]>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  const items = parseCategoryTemplateChanges(changes);
  if (!items || typeof archived !== 'boolean' || !isUuid(operationId)) return { ok: false, error: '카테고리와 저장 버전을 확인해주세요. 한 번에 100개까지 처리할 수 있습니다.' };
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_save_catalog_category_templates', { p_items: items, p_archived: archived, p_operation_id: operationId });
    if (error) return ['PT409', '23505', '23514', '22023', '42501', 'P0002'].includes(error.code ?? '') ? { ok: false, error: categoryTemplateError(error.message), conflict: error.code === 'PT409' || error.code === '23505' } : unknown();
    const rows = parseCategoryTemplateRows(data?.rows);
    if (!rows || rows.length !== items.length || items.some(item => !rows.some(row => row.categoryId === item.categoryId && row.revision === item.revision + 1 && row.archived === archived))) return unknown();
    revalidatePath(CATEGORY_TEMPLATES_PATH); return { ok: true, value: rows };
  } catch { return unknown(); }
}
