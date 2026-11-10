'use server';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { GOODS_AFTER_SALES_TEMPLATES_PATH, goodsAfterSalesError, parseGoodsAfterSalesSnapshot, parseGoodsAfterSalesValues, parseGoodsAfterSalesTemplate, parseGoodsAfterSalesTemplatePage, type GoodsAfterSalesSnapshot, type GoodsAfterSalesValues, type GoodsAfterSalesTemplate, type GoodsAfterSalesTemplatePage } from '@/lib/goods-after-sales';

export type GoodsAfterSalesResult<T> = { ok: true; value: T } | { ok: false; error: string; uncertain?: boolean; conflict?: boolean };
const unread = <T,>(): GoodsAfterSalesResult<T> => ({ ok: false, error: '저장된 내용을 불러오지 못했습니다. 다시 조회해주세요.' });
const unknown = <T,>(): GoodsAfterSalesResult<T> => ({ ok: false, error: '저장 결과를 확인하지 못했습니다. 같은 요청의 결과부터 확인해주세요.', uncertain: true });
const validGoodId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,199}$/.test(value);
export async function loadGoodsAfterSalesAction(goodId: string): Promise<GoodsAfterSalesResult<GoodsAfterSalesSnapshot>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  if (!validGoodId(goodId)) return unread();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_get_goods_after_sales_content', { p_good_id: goodId });
    const value = error ? null : parseGoodsAfterSalesSnapshot(data);
    return value?.goodId === goodId ? { ok: true, value } : unread();
  } catch { return unread(); }
}
export async function saveGoodsAfterSalesAction(goodId: string, values: GoodsAfterSalesValues, revision: number, operationId: string): Promise<GoodsAfterSalesResult<GoodsAfterSalesSnapshot>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  const parsed = parseGoodsAfterSalesValues(values, true);
  if (!validGoodId(goodId) || !parsed || !isUuid(operationId) || !Number.isSafeInteger(revision) || revision < 0) return { ok: false, error: '전화번호는 1~20자, A/S 안내는 1~1,300자, 판매자 특이사항은 1,300자까지 입력해주세요.' };
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_save_goods_after_sales_content', { p_good_id: goodId, p_values: parsed, p_expected_revision: revision, p_operation_id: operationId });
    if (error) return ['PT409', '23505', '23514', '22023', '42501', 'P0002'].includes(error.code ?? '') ? { ok: false, error: goodsAfterSalesError(error.message), conflict: error.code === 'PT409' || error.code === '23505' } : unknown();
    const value = parseGoodsAfterSalesSnapshot(data);
    if (!value || value.goodId !== goodId || value.revision !== revision + 1 || value.phone !== parsed.phone || value.guide !== parsed.guide || value.sellerSpecialNotes !== parsed.sellerSpecialNotes) return unknown();
    revalidatePath(`/shop/${goodId}`); revalidatePath('/admin/catalog/goods');
    return { ok: true, value };
  } catch { return unknown(); }
}
export async function listGoodsAfterSalesTemplatesAction(query: string, archived: boolean, page: number): Promise<GoodsAfterSalesResult<GoodsAfterSalesTemplatePage>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.length > 100 || typeof archived !== 'boolean' || !Number.isSafeInteger(page) || page < 1 || page > 100000) return unread();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_list_goods_after_sales_templates', { p_query: query.trim(), p_archived: archived, p_page: page });
    const value = error ? null : parseGoodsAfterSalesTemplatePage(data);
    return value && value.page === page ? { ok: true, value } : unread();
  } catch { return unread(); }
}
export async function saveGoodsAfterSalesTemplateAction(id: string, values: GoodsAfterSalesValues, archived: boolean, revision: number, operationId: string): Promise<GoodsAfterSalesResult<GoodsAfterSalesTemplate>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  const parsed = parseGoodsAfterSalesValues(values);
  if (!isUuid(id) || !isUuid(operationId) || !parsed || typeof archived !== 'boolean' || !Number.isSafeInteger(revision) || revision < 0) return { ok: false, error: '전화번호와 A/S 안내를 입력하고 글자 수를 확인해주세요.' };
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_save_goods_after_sales_template', { p_id: id, p_values: parsed, p_archived: archived, p_expected_revision: revision, p_operation_id: operationId });
    if (error) return ['PT409', '23505', '23514', '22023', '42501'].includes(error.code ?? '') ? { ok: false, error: goodsAfterSalesError(error.message), conflict: error.code === 'PT409' || error.code === '23505' } : unknown();
    const value = parseGoodsAfterSalesTemplate(data); if (!value || value.id !== id || value.revision !== revision + 1 || value.phone !== parsed.phone || value.guide !== parsed.guide || value.sellerSpecialNotes !== parsed.sellerSpecialNotes || value.archived !== archived) return unknown();
    revalidatePath(GOODS_AFTER_SALES_TEMPLATES_PATH);
    return { ok: true, value };
  } catch { return unknown(); }
}
